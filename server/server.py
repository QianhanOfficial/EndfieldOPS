#!/usr/bin/env python3
"""EOPS local-only API. Python standard library, SQLite, no network services."""
from __future__ import annotations

import argparse
import copy
from contextlib import closing
import datetime as dt
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import signal
import sqlite3
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo

VERSION = "0.2.0"
ROOT = Path(__file__).resolve().parents[1]
COLLECTIONS = {"project": "projects", "task": "tasks", "requirement": "requirements", "batch": "batches", "milestone": "milestones"}
COMMON = {"title", "description"}
FIELDS = {
    "project": COMMON | {"startDate", "endDate", "deadline", "members", "color", "status"},
    "task": COMMON | {"projectId", "requirementId", "date", "difficulty", "done", "workers", "subtasks", "dependencies"},
    "requirement": COMMON | {"projectId", "batchId", "kind", "done", "difficulty", "subtasks"},
    "batch": {"projectId", "date"},
    "milestone": COMMON | {"projectId", "date", "done"},
}
SETTINGS = {"theme": "light", "fontSize": 14, "dateFormat": "YYYY.MM.DD", "sidebarPinned": False, "calendarHeatmap": "rate", "selfName": "自己", "calendarOverrides": {}, "reducedMotion": False, "calendarShowOpen": False}
MAX_BODY = 8 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_input"):
        super().__init__(message)
        self.status, self.code = status, code


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def today() -> dt.date:
    return dt.datetime.now(ZoneInfo("Asia/Shanghai")).date()


def new_id() -> str:
    return uuid.uuid4().hex


def require(condition: bool, message: str):
    if not condition:
        raise ApiError(message)


def obj(value, label: str):
    require(type(value) is dict, f"{label} 必须是对象")
    return value


def text_value(value, label: str, required=False, maximum=100000):
    require(type(value) is str and len(value) <= maximum, f"{label} 必须是有效文本，最多 {maximum} 字符")
    require(not required or bool(value.strip()), f"{label} 不能为空")
    return value


def date_value(value, label: str, optional=False):
    if optional and value == "":
        return
    require(type(value) is str and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)), f"{label} 日期格式应为 YYYY-MM-DD")
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        raise ApiError(f"{label} 不是有效日期")
    require("1900-01-01" <= value <= "2099-12-31", f"{label} 必须在 1900-01-01 至 2099-12-31 之间")


def boolean(value, label: str):
    require(type(value) is bool, f"{label} 必须为 true 或 false")


def number(value, label: str, minimum=0, maximum=1000000000):
    require(type(value) in (int, float) and minimum <= value <= maximum, f"{label} 数值超出范围")


def id_value(value, label: str):
    require(type(value) is str and bool(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)), f"{label} 不是有效 ID")


def string_list(value, label: str, maximum=100):
    require(type(value) is list and len(value) <= maximum, f"{label} 必须是最多 {maximum} 项的数组")
    for item in value:
        text_value(item, label, True, 128)
    require(len(value) == len(set(value)), f"{label} 不能重复")


def timestamp(value, label):
    require(type(value) is str and len(value) <= 64, f"{label} 不是有效时间")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None, f"{label} 必须包含时区")
    except ValueError:
        raise ApiError(f"{label} 不是有效时间")


def validate_settings(settings):
    obj(settings, "系统配置")
    require(set(settings) == set(SETTINGS), "系统配置字段不完整或含未知字段")
    require(settings["theme"] in ("dark", "light"), "主题无效")
    number(settings["fontSize"], "字体大小", 12, 24)
    require(settings["dateFormat"] in ("YYYY.MM.DD", "YYYY-MM-DD", "MM/DD"), "日期格式无效")
    require(settings["calendarHeatmap"] in ("off", "rate", "count"), "日历热力模式无效")
    boolean(settings["sidebarPinned"], "固定侧栏")
    boolean(settings["reducedMotion"], "减少动态效果")
    boolean(settings["calendarShowOpen"], "日历显示无 DDL 项目")
    text_value(settings["selfName"], "自己的姓名", True, 128)
    overrides = obj(settings["calendarOverrides"], "工作日调整")
    require(len(overrides) <= 10000, "工作日调整数量过多")
    for day, setting in overrides.items():
        date_value(day, "工作日调整")
        obj(setting, "工作日调整项")
        require(set(setting) == {"workday", "note"}, "工作日调整项字段无效")
        boolean(setting["workday"], "工作日")
        text_value(setting["note"], "工作日备注", maximum=1000)


SCHEMA_VERSION = 2


def empty_state():
    return {"schemaVersion": SCHEMA_VERSION, "revision": 0, **{name: [] for name in COLLECTIONS.values()}, "settings": copy.deepcopy(SETTINGS)}


def upgrade_state(state):
    """Bring version 1 data (EOPS 0.1.x) up to the current schema; other input is returned untouched."""
    if type(state) is not dict or state.get("schemaVersion") != 1:
        return state
    state = copy.deepcopy(state)
    # 0.1.x projects all had fixed end dates; open-ended projects arrived in schema 2.
    for project in state.get("projects") if type(state.get("projects")) is list else []:
        if type(project) is dict:
            project.setdefault("deadline", True)
    if type(state.get("settings")) is dict:
        state["settings"].setdefault("calendarShowOpen", False)
    state["schemaVersion"] = SCHEMA_VERSION
    return state


def validate_state(state):
    obj(state, "数据")
    require(set(state) == set(empty_state()), "数据结构不完整或含未知字段")
    require(type(state["schemaVersion"]) is int and state["schemaVersion"] == SCHEMA_VERSION, "不支持此备份版本")
    require(type(state["revision"]) is int and state["revision"] >= 0, "数据版本无效")
    validate_settings(state["settings"])
    maps = {}
    for kind, collection in COLLECTIONS.items():
        items = state[collection]
        require(type(items) is list and len(items) <= 50000, f"{collection} 必须是有效数组")
        maps[kind] = {}
        for item in items:
            obj(item, collection)
            allowed = FIELDS[kind] | {"id", "createdAt", "updatedAt"}
            if kind != "batch":
                allowed |= {"order"}
            else:
                allowed |= {"sequence"}
            if kind == "task":
                allowed |= {"completedAt"}
            required = allowed - ({"requirementId", "completedAt"} if kind == "task" else set())
            require(set(item) <= allowed and required <= set(item), f"{collection} 条目字段不完整或含未知字段")
            id_value(item["id"], "条目 ID")
            require(item["id"] not in maps[kind], f"{collection} 含重复 ID")
            maps[kind][item["id"]] = item
            timestamp(item["createdAt"], "创建时间")
            timestamp(item["updatedAt"], "更新时间")
            if kind != "batch":
                text_value(item["title"], "标题", True, 500)
                text_value(item["description"], "描述")
                number(item["order"], "排序", -1000000000)
            if kind == "project":
                date_value(item["startDate"], "开始日期")
                date_value(item["endDate"], "结束日期")
                require(item["startDate"] <= item["endDate"], "开始日期不能晚于结束日期")
                boolean(item["deadline"], "是否有明确截止日期")
                string_list(item["members"], "项目成员")
                require(state["settings"]["selfName"] in item["members"], "项目成员必须包含自己")
                require(item["status"] in ("active", "completed", "archived"), "项目状态无效")
                require(type(item["color"]) is str and bool(re.fullmatch(r"#[0-9a-fA-F]{6}", item["color"])), "项目颜色需为六位十六进制颜色")
            else:
                id_value(item["projectId"], "所属项目")
            if kind in ("task", "milestone", "requirement"):
                boolean(item["done"], "完成状态")
            if kind in ("task", "milestone", "batch"):
                date_value(item["date"], "安排日期", optional=kind == "task")
            if kind == "batch":
                require(type(item["sequence"]) is int and item["sequence"] > 0, "目标批次序号必须为正整数")
            if kind in ("task", "requirement"):
                require(item["difficulty"] in ("normal", "medium", "hard"), "工作量无效")
                require(type(item["subtasks"]) is list and len(item["subtasks"]) <= 20, "最多允许 20 个子任务")
                subids = set()
                for sub in item["subtasks"]:
                    obj(sub, "子任务")
                    require(set(sub) == {"id", "title", "done"}, "子任务字段无效")
                    id_value(sub["id"], "子任务 ID")
                    require(sub["id"] not in subids, "子任务 ID 不能重复")
                    subids.add(sub["id"])
                    text_value(sub["title"], "子任务标题", True, 500)
                    boolean(sub["done"], "子任务完成状态")
            if kind == "task":
                string_list(item["workers"], "工作者")
                require(bool(item["workers"]), "至少选择一位工作者")
                string_list(item["dependencies"], "依赖任务", 1000)
                if "requirementId" in item:
                    id_value(item["requirementId"], "关联目标")
                if "completedAt" in item:
                    timestamp(item["completedAt"], "完成时间")
                    require(item["done"], "未完成任务不能含完成时间")
                require(not item["done"] or "completedAt" in item, "完成任务缺少完成时间")
            if kind == "requirement":
                id_value(item["batchId"], "目标批次")
                require(item["kind"] in ("new", "improve", "retire"), "目标分类无效")
    for kind in ("task", "requirement", "batch", "milestone"):
        for item in maps[kind].values():
            project = maps["project"].get(item["projectId"])
            require(project is not None, "所属项目不存在")
            if kind == "task":
                # A removed member may still be named on historical work. New
                # assignments are checked at mutation time, without rewriting history.
                if "requirementId" in item:
                    requirement = maps["requirement"].get(item["requirementId"])
                    require(requirement is not None and requirement["projectId"] == item["projectId"], "关联目标必须属于同一项目")
                for dep_id in item["dependencies"]:
                    dep = maps["task"].get(dep_id)
                    require(dep is not None and dep["projectId"] == item["projectId"] and dep_id != item["id"], "依赖任务必须属于同一项目且不能为自己")
            if kind == "requirement":
                batch = maps["batch"].get(item["batchId"])
                require(batch is not None and batch["projectId"] == item["projectId"], "目标批次必须属于同一项目")
    batch_sequences = [(x["projectId"], x["sequence"]) for x in state["batches"]]
    require(len(batch_sequences) == len(set(batch_sequences)), "同一项目的目标批次序号不能重复")
    # Kahn traversal avoids recursion limits on long imported dependency chains.
    inbound = {key: len(value["dependencies"]) for key, value in maps["task"].items()}
    outgoing = {key: [] for key in inbound}
    for key, task in maps["task"].items():
        for dependency in task["dependencies"]:
            outgoing[dependency].append(key)
    queue = [key for key, count in inbound.items() if count == 0]
    visited = 0
    while queue:
        key = queue.pop()
        visited += 1
        for following in outgoing[key]:
            inbound[following] -= 1
            if inbound[following] == 0:
                queue.append(following)
    require(visited == len(inbound), "任务依赖不能形成循环")


def find_item(state, kind, identifier):
    id_value(identifier, "条目 ID")
    for item in state[COLLECTIONS[kind]]:
        if item["id"] == identifier:
            return item
    raise ApiError("条目不存在，可能已被删除，请刷新", 404, "not_found")


def create_item(state, kind, payload):
    require(set(payload) <= FIELDS[kind], "创建内容含未知字段")
    stamp = now()
    item = {"id": new_id(), "createdAt": stamp, "updatedAt": stamp}
    if kind != "batch":
        item.update(title="", description="", order=0)
        # New projects at the front; task and requirement toggles never move items.
        orders = [x["order"] for x in state[COLLECTIONS[kind]]]
        item["order"] = min(orders, default=1) - 1 if kind == "project" else max(orders, default=-1) + 1
    if kind == "project":
        item.update(startDate=today().isoformat(), endDate=(today() + dt.timedelta(days=14)).isoformat(), deadline=True, members=[state["settings"]["selfName"]], color="#e8dc42", status="active")
    elif kind == "task":
        item.update(projectId="", date="", difficulty="normal", done=False, workers=[state["settings"]["selfName"]], subtasks=[], dependencies=[])
    elif kind == "requirement":
        item.update(projectId="", batchId="", kind="new", done=False, difficulty="normal", subtasks=[])
    elif kind == "batch":
        item.update(projectId="", date="", sequence=max([b["sequence"] for b in state["batches"] if b["projectId"] == payload.get("projectId")], default=0) + 1)
    elif kind == "milestone":
        item.update(projectId="", date="", done=False)
    item.update(copy.deepcopy(payload))
    normalize_item(state, kind, item)
    if kind == "task":
        validate_assignment(state, item)
    state[COLLECTIONS[kind]].append(item)
    return item


def normalize_item(state, kind, item):
    if kind == "project" and type(item["members"]) is list:
        name = state["settings"]["selfName"]
        if name not in item["members"]:
            item["members"].insert(0, name)
    if kind == "task":
        if item.get("requirementId") in (None, ""):
            item.pop("requirementId", None)
        if item.get("done") is True:
            item.setdefault("completedAt", now())
        else:
            item.pop("completedAt", None)


def validate_assignment(state, item, retained=()):
    project = find_item(state, "project", item["projectId"])
    string_list(item["workers"], "工作者")
    require(bool(item["workers"]), "至少选择一位工作者")
    require(set(item["workers"]) <= set(project["members"]) | set(retained), "新指定的工作者请先添加为项目成员")


def delete_item(state, kind, identifier):
    find_item(state, kind, identifier)
    if kind == "project":
        for descendant in ("tasks", "requirements", "batches", "milestones"):
            state[descendant] = [x for x in state[descendant] if x["projectId"] != identifier]
    if kind == "batch":
        removed = {x["id"] for x in state["requirements"] if x["batchId"] == identifier}
        state["requirements"] = [x for x in state["requirements"] if x["id"] not in removed]
        for task in state["tasks"]:
            if task.get("requirementId") in removed:
                task.pop("requirementId")
                task["updatedAt"] = now()
    if kind == "requirement":
        for task in state["tasks"]:
            if task.get("requirementId") == identifier:
                task.pop("requirementId")
                task["updatedAt"] = now()
    if kind == "task":
        for task in state["tasks"]:
            if identifier in task["dependencies"]:
                task["dependencies"].remove(identifier)
                task["updatedAt"] = now()
    state[COLLECTIONS[kind]] = [x for x in state[COLLECTIONS[kind]] if x["id"] != identifier]


def mutate(state, action_type, payload):
    obj(payload, "操作内容")
    if action_type == "settings.update":
        require(set(payload) <= set(SETTINGS), "设置含未知字段")
        old_name = state["settings"]["selfName"]
        state["settings"].update(copy.deepcopy(payload))
        validate_settings(state["settings"])
        new_name = state["settings"]["selfName"]
        if new_name != old_name:
            occupied_names = {
                name
                for collection, field in (("projects", "members"), ("tasks", "workers"))
                for item in state[collection]
                for name in item[field]
                if name != old_name
            }
            require(new_name not in occupied_names, "这个名称已被项目成员或历史工作者使用，请为自己选择另一个显示名称")
            for collection, field in (("projects", "members"), ("tasks", "workers")):
                for item in state[collection]:
                    item[field] = list(dict.fromkeys(new_name if x == old_name else x for x in item[field]))
                    item["updatedAt"] = now()
        return
    if action_type == "demo.load":
        require(not any(state[x] for x in COLLECTIONS.values()), "示例仅可载入空数据库，现有内容不会被覆盖")
        require(not payload, "载入示例无需额外字段")
        load_demo(state)
        return
    pieces = action_type.split(".")
    require(len(pieces) == 2 and pieces[0] in COLLECTIONS, "未知操作")
    kind, operation = pieces
    if operation == "create":
        create_item(state, kind, payload)
    elif operation == "update":
        require(set(payload) <= FIELDS[kind] | {"id"} and "id" in payload, "更新内容含未知字段或缺少 ID")
        item = find_item(state, kind, payload["id"])
        if kind == "task" and "workers" in payload:
            validate_assignment(state, {**item, **payload}, retained=item["workers"])
        if kind != "project" and "projectId" in payload:
            require(payload["projectId"] == item["projectId"], "条目不能直接移到另一项目")
        item.update(copy.deepcopy(payload))
        item["updatedAt"] = now()
        normalize_item(state, kind, item)
    elif operation == "delete":
        require(set(payload) == {"id"}, "删除需且仅需 ID")
        delete_item(state, kind, payload["id"])
    elif operation == "reorder" and kind != "batch":
        require(set(payload) == {"ids"}, "排序需且仅需 ids")
        string_list(payload["ids"], "排序 ID", 50000)
        items = [find_item(state, kind, identifier) for identifier in payload["ids"]]
        # Preserve the surrounding slots when only a date/batch subgroup is sent.
        slots = sorted(x["order"] for x in items)
        for item, order in zip(items, slots):
            item["order"], item["updatedAt"] = order, now()
    else:
        raise ApiError("未知操作")


SELF = object()  # Placeholder for the user's display name (settings.selfName).

# Fiction for the demo: courses, people and dates are invented.
# Two kinds of projects: fixed deadline (work / exam review) and open-ended (learning / R&D).
DEMO_PROJECTS = [
    {
        "title": "源石工程学导论 · 期末复习",
        "start": "2026-10-12", "end": "2027-01-08", "deadline": True, "color": "#e8dc42", "members": [SELF],
        "description": (
            "# 源石工程学导论 · 期末复习\n\n"
            "**课程：** 源石工程学导论（4 学分，必修）\n"
            "**考试：** 2027-01-08，闭卷，120 分钟\n"
            "**成绩构成：** 平时 30% + 期末 70%\n\n"
            "## 复习思路\n\n"
            "- 第 1–6 章按教材顺序过一遍，每章配一套课后习题。\n"
            "- 10 月 19 日老师通知：第 7 章「源石能量回路」改为必考计算题，单独加练。\n"
            "- 第 9 章拓展阅读不再考，不安排复习。\n"
            "- 12 月起限时刷历年卷，最后两周只做错题和查漏补缺。\n\n"
            "## 资料\n\n"
            "- 教材第 1–8 章、课堂 PPT、往年真题 3 套\n"
            "- 错题本按章节整理"
        ),
        "goals": [
            ("2026-10-12", [
                ("A", "期末 85 分以上", "平时 30% + 期末 70%，平时分已拿到 27 分。"),
                ("A1", "第 1–8 章知识点全部过一遍", "每章笔记一份、课后习题一套，错题进错题本。"),
            ]),
            ("2026-10-19", [
                ("A7", "第 7 章计算题拿满 20 分", "老师课上通知：第 7 章源石能量回路改为必考计算题。"),
            ]),
        ],
        "tasks": [
            ("A01", "第 1–2 章笔记梳理", "2026-10-12", "2026-10-16", "已完成", [], [SELF], "normal", "A1",
             [("1.1 源石的基本性质", True), ("1.2 能量释放模型", True), ("2.1 材料分类", True)]),
            ("A02", "第 1–2 章课后习题", "2026-10-19", "2026-10-20", "已完成", ["A01"], [SELF], "normal", "A1", []),
            ("A03", "第 3–4 章笔记与公式推导", "2026-10-19", "2026-10-21", "已完成", ["A01"], [SELF], "medium", "A1", []),
            ("A04", "第 3–4 章习题", "2026-10-22", "2026-10-22", "进行中", ["A03"], [SELF], "medium", "A1",
             [("习题 3.2–3.8", True), ("习题 4.1–4.6", False), ("错题誊到错题本", False)]),
            ("A05", "第 5–6 章笔记与例题", "2026-10-26", "2026-11-06", "未开始", ["A04"], [SELF], "medium", "A1", []),
            ("A06", "第 7 章能量回路计算专项", "2026-11-09", "2026-11-20", "未开始", ["A05"], [SELF], "hard", "A7",
             [("串联回路", False), ("并联回路", False), ("损耗估算", False)]),
            ("A07", "第 8 章与全书知识框架", "2026-11-23", "2026-12-04", "未开始", ["A06"], [SELF], "normal", "A1", []),
            ("A08", "历年真题限时训练", "2026-12-07", "2026-12-25", "未开始", ["A07"], [SELF], "hard", "A",
             [("2023 年卷", False), ("2024 年卷", False), ("2025 年卷", False)]),
            ("A09", "错题回顾与查漏补缺", "2026-12-28", "2027-01-06", "未开始", ["A08"], [SELF], "normal", "A", []),
        ],
        "milestones": [("期中作业提交", "2026-10-16", True), ("第 7 章随堂小测", "2026-11-20", False), ("期末考试", "2027-01-08", False)],
    },
    {
        "title": "集成工业产线仿真 · 课程设计",
        "start": "2026-09-21", "end": "2026-12-18", "deadline": True, "color": "#5dd8cf", "members": [SELF, "阿岚", "小周"],
        "description": (
            "# 集成工业产线仿真 · 课程设计\n\n"
            "**小组：** 3 人（自己、阿岚、小周）\n"
            "**选题：** 用仿真软件搭一条「原料输送 → 加工 → 装配」产线，找出产能瓶颈并给出改进方案。\n"
            "**提交物：** 仿真模型、设计报告（不少于 8000 字）、答辩 PPT 与演示视频\n"
            "**答辩：** 2026-12-18\n\n"
            "## 分工\n\n"
            "| 成员 | 负责 |\n"
            "| --- | --- |\n"
            "| 自己 | 模型主体、报告统稿、答辩 |\n"
            "| 阿岚 | 流程调研、报告第 2–3 章、格式 |\n"
            "| 小周 | 参数设置、敏感性分析 |\n\n"
            "## 备注\n\n"
            "- 10 月 20 日助教反馈：开题报告缺少参数敏感性分析，最终报告需要补上。\n"
            "- 每周日晚上组会，进度以任务完成情况为准。"
        ),
        "goals": [
            ("2026-09-21", [
                ("B", "按时完成课程设计并通过答辩", "提交仿真模型、设计报告与答辩材料，12 月 18 日答辩。"),
            ]),
            ("2026-10-20", [
                ("B4", "报告讲清产能瓶颈的敏感性", "助教反馈：需要说明关键参数变化对产能的影响。"),
            ]),
        ],
        "tasks": [
            ("B01", "选题与开题报告", "2026-09-21", "2026-09-30", "已完成", [], [SELF], "normal", "B", []),
            ("B02", "产线流程调研与数据整理", "2026-10-08", "2026-10-16", "已完成", ["B01"], ["阿岚"], "normal", "B", []),
            ("B03", "仿真模型搭建", "2026-10-19", "2026-10-30", "进行中", ["B02"], [SELF, "小周"], "hard", "B",
             [("原料输送段", True), ("加工段", True), ("装配段", False), ("参数表", False)]),
            ("B04", "敏感性分析", "2026-11-02", "2026-11-11", "未开始", ["B03"], ["小周"], "medium", "B4", []),
            ("B05", "设计报告撰写", "2026-11-09", "2026-11-27", "未开始", ["B03"], [SELF, "阿岚"], "hard", "B", []),
            ("B06", "报告互审与格式修改", "2026-11-30", "2026-12-04", "未开始", ["B04", "B05"], ["阿岚"], "normal", "B", []),
            ("B07", "答辩 PPT 与演示视频", "2026-12-07", "2026-12-14", "未开始", ["B06"], [SELF], "medium", "B", []),
            ("B08", "答辩彩排", "2026-12-15", "2026-12-17", "未开始", ["B07"], [SELF, "阿岚", "小周"], "normal", "B", []),
        ],
        "milestones": [("开题报告通过", "2026-09-30", True), ("中期检查", "2026-11-13", False), ("课程设计答辩", "2026-12-18", False)],
    },
    {
        "title": "同人游戏原型 · 自学与研发",
        "start": "2026-09-14", "end": "2026-09-14", "deadline": False, "color": "#ff1aac", "members": [SELF],
        "description": (
            "# 同人游戏原型 · 自学与研发\n\n"
            "**类型：** 学习／研发，没有明确截止日期，按自己的节奏推进。\n"
            "**方向：** 一个工业基建题材的小型关卡原型，边做边学。\n\n"
            "## 怎么推进\n\n"
            "- 每周挑一两个能做完的小任务，做完再排下一批。\n"
            "- 学到的东西马上用进原型里，不单独攒教程。\n"
            "- 第一关能玩就先给朋友试，根据反馈再决定下一步。"
        ),
        "goals": [
            ("2026-09-14", [
                ("C", "做出一个能玩的关卡原型", "角色能移动、能放置设备，有一个完整的小关卡。"),
                ("C1", "学会基础的着色器", "能自己写出描边和扫描线效果。"),
            ]),
        ],
        "tasks": [
            ("C01", "搭建开发环境与版本管理", "2026-09-14", "2026-09-18", "已完成", [], [SELF], "normal", "C", []),
            ("C02", "跟着教程做出角色移动", "2026-10-12", "2026-10-21", "已完成", ["C01"], [SELF], "medium", "C", []),
            ("C03", "读完《游戏编程模式》前 6 章", "2026-10-22", "2026-10-22", "进行中", [], [SELF], "normal", "C",
             [("命令模式", True), ("享元模式", True), ("观察者模式", False), ("状态模式", False)]),
            ("C04", "关卡编辑器原型", "2026-10-26", "2026-11-13", "未开始", ["C02"], [SELF], "hard", "C", []),
            ("C05", "基础着色器：描边与扫描线", "2026-11-02", "2026-11-20", "未开始", [], [SELF], "medium", "C1", []),
            ("C06", "第一关灰盒", "2026-11-16", "2026-11-27", "未开始", ["C02", "C04"], [SELF], "medium", "C", []),
            ("C07", "美术占位与 UI", "2026-11-30", "2026-12-09", "未开始", ["C06"], [SELF], "normal", "C", []),
            ("C08", "找朋友试玩并收集反馈", "2026-12-10", "2026-12-11", "未开始", ["C05", "C06", "C07"], [SELF], "normal", "C",
             [("试玩 3 人", False), ("整理反馈", False)]),
        ],
        "milestones": [("角色能跑起来", "2026-10-21", True), ("第一关可试玩", "2026-12-11", False)],
    },
]


def load_demo(state):
    # A fixed snapshot, not a schedule relative to the load date.
    snapshot = "2026-10-22"
    me = state["settings"]["selfName"]
    note = (
        "\n\n## 示例说明\n"
        "快照固定为 2026-10-22（周四），日期不随载入日期平移。课程、人物和考试安排均为虚构。"
        "任务日期取计划截止日，计划区间和状态写在任务描述中；已完成任务的完成时间按快照登记。"
        "示例不修改你的日历和个人设置，可随时删除。"
    )
    names = lambda people: [me if p is SELF else p for p in people]
    for order, definition in enumerate(DEMO_PROJECTS):
        project = create_item(state, "project", {
            "title": "示例 · " + definition["title"],
            "description": definition["description"] + note,
            "startDate": definition["start"], "endDate": definition["end"], "deadline": definition["deadline"],
            "members": list(dict.fromkeys(names(definition["members"]))),
            "color": definition["color"],
        })
        project["order"] = order
        requirements = {}
        for date, items in definition["goals"]:
            batch = create_item(state, "batch", {"projectId": project["id"], "date": date})
            for key, title, description in items:
                requirements[key] = create_item(state, "requirement", {
                    "projectId": project["id"], "batchId": batch["id"], "title": title, "description": description,
                })
        tasks = {}
        for code, title, start, end, status, predecessors, workers, difficulty, requirement, subtasks in definition["tasks"]:
            condition = "、".join(predecessors) or "—"
            task = create_item(state, "task", {
                "projectId": project["id"], "requirementId": requirements[requirement]["id"],
                "title": f"{code} · {title}",
                "description": f"计划区间：{start} 至 {end}。\n{snapshot}状态：{status}；前置：{condition}。",
                "date": end, "workers": names(workers), "done": status == "已完成",
                "difficulty": difficulty, "dependencies": [tasks[key]["id"] for key in predecessors],
                "subtasks": [{"id": new_id(), "title": t, "done": d} for t, d in subtasks],
            })
            if task["done"]:
                # Only the snapshot date is known, not an actual completion time.
                task["completedAt"] = snapshot + "T00:00:00+08:00"
            tasks[code] = task
        for title, date, done in definition["milestones"]:
            create_item(state, "milestone", {
                "projectId": project["id"], "title": title, "date": date, "done": done,
                "description": f"完成状态按 {snapshot} 快照登记。",
            })


class Store:
    def __init__(self, database: Path, backups: Path):
        self.database, self.backups = Path(database), Path(backups)
        self.lock = threading.RLock()
        self.database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
        with closing(self.connect()) as conn, conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, state_json TEXT NOT NULL)")
            conn.execute("INSERT OR IGNORE INTO app_state VALUES (1,0,?)", (json.dumps(empty_state(), ensure_ascii=False),))
            stored_revision, encoded = conn.execute("SELECT revision,state_json FROM app_state WHERE id=1").fetchone()
            stored = json.loads(encoded)
            existing = upgrade_state(stored)
            validate_state(existing)
            require(stored_revision == existing["revision"], "数据库版本不一致，请从备份恢复")
            upgraded = existing is not stored
        if upgraded:
            # Keep a copy of the pre-upgrade data before rewriting it in the new schema.
            self.save_backup(stored, "before-upgrade")
            with closing(self.connect()) as conn, conn:
                conn.execute("UPDATE app_state SET state_json=? WHERE id=1", (json.dumps(existing, ensure_ascii=False, separators=(",", ":")),))
        os.chmod(self.database, 0o600)

    def connect(self):
        conn = sqlite3.connect(self.database, timeout=15)
        conn.execute("PRAGMA busy_timeout=15000")
        return conn

    def read(self):
        with self.lock, closing(self.connect()) as conn:
            return json.loads(conn.execute("SELECT state_json FROM app_state WHERE id=1").fetchone()[0])

    def save_backup(self, state, reason="manual"):
        # JSON is the portable restore format; SQLite is a direct local snapshot.
        stamp = dt.datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d-%H%M%S-%f")
        stem = f"eops-{stamp}-{reason}-r{state['revision']}"
        target = self.backups / (stem + ".json")
        with target.open("x", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(target, 0o600)
        snapshot = self.backups / (stem + ".sqlite3")
        source = self.connect()
        dest = sqlite3.connect(snapshot)
        try:
            source.backup(dest)
        finally:
            dest.close()
            source.close()
        os.chmod(snapshot, 0o600)
        return target

    def list_backups(self):
        # Include existing backups under the legacy prefix after the EOPS rename.
        paths = [*self.backups.glob("eops-*.json"), *self.backups.glob("dayline-*.json")]
        return [{"name": path.name, "bytes": path.stat().st_size} for path in sorted(paths, key=lambda path: path.name.split("-", 1)[1], reverse=True)]

    def action(self, action):
        obj(action, "请求")
        require(set(action) <= {"type", "payload", "expectedRevision"}, "请求含未知字段")
        action_type = action.get("type")
        require(type(action_type) is str and len(action_type) <= 80, "操作类型无效")
        payload = obj(action.get("payload", {}), "操作内容")
        if "expectedRevision" in action:
            require(type(action["expectedRevision"]) is int and action["expectedRevision"] >= 0, "预期版本无效")
        with self.lock:
            conn = self.connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                current = json.loads(conn.execute("SELECT state_json FROM app_state WHERE id=1").fetchone()[0])
                revision = current["revision"]
                if "expectedRevision" in action and action["expectedRevision"] != revision:
                    raise ApiError("数据已被其他页面或工具修改，请刷新后重试", 409, "revision_conflict")
                state = copy.deepcopy(current)
                if action_type == "state.import":
                    require(set(payload) == {"state"}, "导入需且仅需 state")
                    imported = upgrade_state(payload["state"])
                    validate_state(imported)
                    self.save_backup(current, "before-import")
                    state = copy.deepcopy(imported)
                elif action_type == "backup.create":
                    require(not payload, "备份无需额外字段")
                    self.save_backup(current)
                else:
                    mutate(state, action_type, payload)
                state["revision"] = revision + 1
                validate_state(state)
                encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                require(len(encoded.encode("utf-8")) <= MAX_BODY, "数据总量超过当前版本的 8 MiB 限制")
                conn.execute("UPDATE app_state SET revision=?,state_json=? WHERE id=1", (state["revision"], encoded))
                conn.commit()
                return state
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "EOPS/" + VERSION

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, format, *args):
        # Deliberately excludes payloads, user data and credentials.
        print(f"[{now()}] {format % args}", flush=True)

    def trusted(self):
        host = self.headers.get("Host", "")
        port = self.server.server_port
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            allowed |= {"127.0.0.1", "localhost"}
        if host not in allowed:
            raise ApiError("仅允许本机地址访问", 403, "untrusted_host")
        origin = self.headers.get("Origin")
        if origin is not None and origin != "http://" + host:
            raise ApiError("仅允许同源网页请求", 403, "untrusted_origin")
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise ApiError("拒绝跨站请求", 403, "cross_site")

    def send_bytes(self, data, content_type="application/json; charset=utf-8", status=200, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def send_json(self, data, status=200, filename=None):
        self.send_bytes(json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8"), status=status, filename=filename)

    def handle_error(self, error):
        if isinstance(error, ApiError):
            self.send_json({"error": str(error), "code": error.code}, error.status)
        elif isinstance(error, (json.JSONDecodeError, UnicodeDecodeError)):
            self.send_json({"error": "JSON 格式无效", "code": "invalid_json"}, 400)
        else:
            print(f"[{now()}] Internal error: {type(error).__name__}", flush=True)
            self.send_json({"error": "本机服务暂时无法处理请求", "code": "internal_error"}, 500)

    def do_GET(self):
        try:
            self.trusted()
            path = unquote(urlsplit(self.path).path)
            if path == "/api/health":
                instance = hashlib.sha256(str(self.server.store.database.resolve()).encode("utf-8")).hexdigest()[:16]
                self.send_json({"ok": True, "version": VERSION, "revision": self.server.store.read()["revision"], "instance": instance})
            elif path == "/api/state":
                self.send_json(self.server.store.read())
            elif path == "/api/export":
                self.send_json(self.server.store.read(), filename="eops-export-" + today().isoformat() + ".json")
            elif path == "/api/backups":
                self.send_json({"backups": self.server.store.list_backups()})
            elif path.startswith("/api/"):
                raise ApiError("接口不存在", 404, "not_found")
            else:
                dist = self.server.dist.resolve()
                candidate = (dist / path.lstrip("/")).resolve()
                if not candidate.is_relative_to(dist) or any(p.startswith(".") for p in Path(path).parts if p != "/"):
                    raise ApiError("资源不存在", 404, "not_found")
                if not candidate.is_file():
                    if Path(path).suffix:
                        raise ApiError("资源不存在", 404, "not_found")
                    candidate = dist / "index.html"
                if not candidate.is_file():
                    raise ApiError("前端尚未构建，请先运行 npm run build", 503, "build_required")
                mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
                self.send_bytes(candidate.read_bytes(), mime)
        except Exception as error:
            self.handle_error(error)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        try:
            self.trusted()
            if urlsplit(self.path).path != "/api/action":
                raise ApiError("接口不存在", 404, "not_found")
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                raise ApiError("请求必须使用 application/json", 415, "unsupported_media_type")
            require(not self.headers.get("Transfer-Encoding"), "不支持分块上传")
            raw_length = self.headers.get("Content-Length", "")
            require(raw_length.isdigit(), "缺少有效 Content-Length")
            length = int(raw_length)
            if length > MAX_BODY:
                raise ApiError("请求超过 8 MiB", 413, "payload_too_large")
            data = json.loads(self.rfile.read(length).decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ApiError("JSON 不允许非有限数值")))
            self.send_json(self.server.store.action(data))
        except Exception as error:
            self.handle_error(error)

    def do_OPTIONS(self):
        self.send_json({"error": "跨源访问未启用", "code": "method_not_allowed"}, 405)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, store, dist):
        super().__init__(address, Handler)
        self.store, self.dist = store, Path(dist)


def main():
    parser = argparse.ArgumentParser(description="EOPS local project manager")
    parser.add_argument("--port", type=int, default=11325)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--backup", action="store_true", help="Create a local JSON and SQLite backup and exit")
    args = parser.parse_args()
    os.umask(0o077)
    # Preserve the database filename so existing personal records remain available.
    store = Store(args.data_dir / "dayline.sqlite3", ROOT / "backups")
    if args.backup:
        store.action({"type": "backup.create", "payload": {}})
        print(store.backups / store.list_backups()[0]["name"])
        return
    server = Server(("127.0.0.1", args.port), store, args.dist)
    # A short socket timeout prevents idle HTTP clients from occupying threads indefinitely.
    server.timeout = 1
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    print(f"EOPS {VERSION} · http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
