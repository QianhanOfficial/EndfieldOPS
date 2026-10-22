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

VERSION = "0.1.0"
ROOT = Path(__file__).resolve().parents[1]
COLLECTIONS = {"project": "projects", "task": "tasks", "requirement": "requirements", "batch": "batches", "milestone": "milestones"}
COMMON = {"title", "description"}
FIELDS = {
    "project": COMMON | {"startDate", "endDate", "members", "color", "status"},
    "task": COMMON | {"projectId", "requirementId", "date", "difficulty", "done", "workers", "subtasks", "dependencies"},
    "requirement": COMMON | {"projectId", "batchId", "kind", "done", "difficulty", "subtasks"},
    "batch": {"projectId", "date"},
    "milestone": COMMON | {"projectId", "date", "done"},
}
SETTINGS = {"theme": "light", "fontSize": 14, "dateFormat": "YYYY.MM.DD", "sidebarPinned": False, "calendarHeatmap": "rate", "selfName": "自己", "calendarOverrides": {}, "reducedMotion": False}
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
    text_value(settings["selfName"], "自己的姓名", True, 128)
    overrides = obj(settings["calendarOverrides"], "工作日调整")
    require(len(overrides) <= 10000, "工作日调整数量过多")
    for day, setting in overrides.items():
        date_value(day, "工作日调整")
        obj(setting, "工作日调整项")
        require(set(setting) == {"workday", "note"}, "工作日调整项字段无效")
        boolean(setting["workday"], "工作日")
        text_value(setting["note"], "工作日备注", maximum=1000)


def empty_state():
    return {"schemaVersion": 1, "revision": 0, **{name: [] for name in COLLECTIONS.values()}, "settings": copy.deepcopy(SETTINGS)}


def validate_state(state):
    obj(state, "数据")
    require(set(state) == set(empty_state()), "数据结构不完整或含未知字段")
    require(type(state["schemaVersion"]) is int and state["schemaVersion"] == 1, "不支持此备份版本")
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
                require(type(item["sequence"]) is int and item["sequence"] > 0, "需求批次序号必须为正整数")
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
                    id_value(item["requirementId"], "客户需求")
                if "completedAt" in item:
                    timestamp(item["completedAt"], "完成时间")
                    require(item["done"], "未完成任务不能含完成时间")
                require(not item["done"] or "completedAt" in item, "完成任务缺少完成时间")
            if kind == "requirement":
                id_value(item["batchId"], "需求批次")
                require(item["kind"] in ("new", "improve", "retire"), "需求分类无效")
    for kind in ("task", "requirement", "batch", "milestone"):
        for item in maps[kind].values():
            project = maps["project"].get(item["projectId"])
            require(project is not None, "所属项目不存在")
            if kind == "task":
                # A removed member may still be named on historical work. New
                # assignments are checked at mutation time, without rewriting history.
                if "requirementId" in item:
                    requirement = maps["requirement"].get(item["requirementId"])
                    require(requirement is not None and requirement["projectId"] == item["projectId"], "关联需求必须属于同一项目")
                for dep_id in item["dependencies"]:
                    dep = maps["task"].get(dep_id)
                    require(dep is not None and dep["projectId"] == item["projectId"] and dep_id != item["id"], "依赖任务必须属于同一项目且不能为自己")
            if kind == "requirement":
                batch = maps["batch"].get(item["batchId"])
                require(batch is not None and batch["projectId"] == item["projectId"], "需求批次必须属于同一项目")
    batch_sequences = [(x["projectId"], x["sequence"]) for x in state["batches"]]
    require(len(batch_sequences) == len(set(batch_sequences)), "同一项目的需求批次序号不能重复")
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
        item.update(startDate=today().isoformat(), endDate=(today() + dt.timedelta(days=14)).isoformat(), members=[state["settings"]["selfName"]], color="#e8dc42", status="active")
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


def load_demo(state):
    # This is a fixed historical fiction snapshot, not a relative schedule.
    snapshot = "2026-10-22"
    mapping = (
        "\n\n## 示例数据映射\n"
        "快照固定为2026-10-22，不随载入日期平移。项目均映射为现有的进行中状态。"
        "填报进度为设定手工值，不等于系统按任务完成数计算的进度。"
        "WBS安排日期取计划截止日；原计划区间、状态和前置条件保留在任务描述中。"
        "进行中、未开始、阻塞均映射为未完成；阻塞原因以文字记录。"
        "已完成任务的完成时间仅以快照时间登记，不代表实际完工时刻。"
        "原排期中的重叠和前置条件照录，不据此推算工时或自动调整计划。"
        "原设定采用周一至周五基础工作日历，当前软件的中国调休及个人工作日设置仍按原有规则显示；示例不修改用户日历。"
        "金额、审批、风险、交付物及跨项目联系仅为描述资料，不代表系统具备相应自动化功能。"
    )
    definitions = [{'title': '宏山科学院科研治理与智能决策平台建设项目',
      'start': '2026-09-14',
      'end': '2026-12-18',
      'members': ['安塔尔', '佩丽卡', '技术支持组'],
      'color': '#e8dc42',
      'description': '# EOPS-PJ-2026-001\n'
                     '\n'
                     '# 宏山科学院科研治理与智能决策平台建设项目\n'
                     '\n'
                     '**文档版本：** V1.3\n'
                     '**保密等级：** 内部 / 合作方受限\n'
                     '**项目负责人：** 安塔尔\n'
                     '**项目监督：** 佩丽卡\n'
                     '**合作机构：** 大炎天师府附属宏山科学院\n'
                     '**项目身份：** FDE / 驻场咨询与技术交付\n'
                     '**项目周期：** 2026-09-14 至 2026-12-18\n'
                     '**合同金额：** 1,200,000 折金票（测试金额）\n'
                     '**优先级：** P1 / 高\n'
                     '**项目状态：** 执行中\n'
                     '**总体健康度：** 正常\n'
                     '**填报进度：** 38%\n'
                     '**状态更新时间：** 2026-10-22\n'
                     '\n'
                     '---\n'
                     '\n'
                     '## 1. 项目背景\n'
                     '\n'
                     '宏山科学院承担文明环带的重要科研任务，其跨院所研究计划涉及源石技术、复杂工业装置、实验资料和成果转化。\n'
                     '\n'
                     '由于研究项目的执行部门众多，现有管理流程存在以下问题：\n'
                     '\n'
                     '- 各研究部门使用独立的项目台账，进度汇总耗时较长。\n'
                     '- 项目预算、采购、实验记录和成果验收缺少统一关联。\n'
                     '- 科研设备与系统的权限、变更和操作记录尚未形成标准化审查流程。\n'
                     '- 院方管理层难以实时掌握项目延期、资源冲突和预算偏差。\n'
                     '\n'
                     '终末地工业受邀派遣驻场技术人员，提供管理流程梳理、信息系统设计、风险控制评估及智能决策能力建设。\n'
                     '\n'
                     '## 2. 项目负责人陈述\n'
                     '\n'
                     '**安塔尔：**\n'
                     '\n'
                     '我负责本项目的现场技术交付及问题协调。\n'
                     '\n'
                     '本项目的重点不是替宏山科学院建设另一套孤立系统，而是让现有科研数据能够被统一管理、正确解释，并在关键风险出现时提供可靠预警。\n'
                     '\n'
                     '我将负责需求调研、技术方案、系统验证和交付质量。涉及跨组织协议技术使用、重要权限或重大范围变更的事项，须提交佩丽卡监督审批。\n'
                     '\n'
                     '## 3. 项目目标与验收标准\n'
                     '\n'
                     '| 目标        | 验收标准             |\n'
                     '| --------- | ---------------- |\n'
                     '| 科研项目统一管理  | 至少接入5个试点研究项目     |\n'
                     '| 研发治理流程标准化 | 梳理并确认不少于3条端到端流程  |\n'
                     '| 系统权限治理    | 建立角色权限矩阵及变更审计机制  |\n'
                     '| 智能问数试点    | 完成30条预设管理查询      |\n'
                     '| 结果准确性     | 测试集关键数值准确率达到100% |\n'
                     '| 项目交付      | 取得院方正式签字的验收记录    |\n'
                     '\n'
                     '关键数字必须与源系统记录一致；对于证据不足的问题，系统应明确拒绝生成未经核实的结论。\n'
                     '\n'
                     '## 4. 项目范围\n'
                     '\n'
                     '**范围内：**\n'
                     '\n'
                     '- 科研项目生命周期管理流程设计。\n'
                     '- 研发预算、设备、人员和进度的数据映射。\n'
                     '- 研发管理风险与控制矩阵（RCM）编制。\n'
                     '- AI 辅助查询原型及证据追溯设计。\n'
                     '- 权限、变更管理、日志留存及测试。\n'
                     '- 用户培训、试运行及验收。\n'
                     '\n'
                     '**范围外：**\n'
                     '\n'
                     '- 科研设备硬件改造。\n'
                     '- 涉密核心研究数据的直接模型训练。\n'
                     '- 替代宏山科学院的正式科研决策。\n'
                     '\n'
                     '## 5. WBS 工作分解与任务排期\n'
                     '\n'
                     '| ID  | 任务           | 负责人   | 计划日期        | 状态  | 前置任务    |\n'
                     '| --- | ------------ | ----- | ----------- | --- | ------- |\n'
                     '| A01 | 项目启动及访谈计划    | 安塔尔   | 09-14～09-18 | 已完成 | —       |\n'
                     '| A02 | 现状流程与系统调研    | 安塔尔   | 09-21～10-09 | 已完成 | A01     |\n'
                     '| A03 | 研发治理流程及RCM设计 | 安塔尔   | 10-12～10-30 | 进行中 | A02     |\n'
                     '| A04 | 数据接口及权限方案设计  | 技术支持组 | 10-19～11-06 | 进行中 | A02     |\n'
                     '| A05 | AI问数原型开发     | 技术支持组 | 11-02～11-20 | 未开始 | A03、A04 |\n'
                     '| A06 | 联合测试及用户验收测试  | 安塔尔   | 11-23～12-04 | 未开始 | A05     |\n'
                     '| A07 | 缺陷修复、知识转移及最终验收 | 安塔尔   | 12-07～12-18 | 未开始 | A06     |\n'
                     '\n'
                     '表格日期年份：2026年。\n'
                     '\n'
                     '## 6. 关键里程碑\n'
                     '\n'
                     '- M1：2026-09-18，项目正式启动。\n'
                     '- M2：2026-10-09，现状调研报告确认。\n'
                     '- M3：2026-11-06，流程及技术设计评审完成。\n'
                     '- M4：2026-11-20，智能决策原型交付。\n'
                     '- M5：2026-12-04，用户验收测试结束。\n'
                     '- M6：2026-12-18，项目关闭与知识归档。\n'
                     '\n'
                     '## 7. 交付成果\n'
                     '\n'
                     '| 编号  | 成果名称              | 验收人     |\n'
                     '| --- | ----------------- | ------- |\n'
                     '| D01 | 业务需求说明书 V1.0      | 院方项目代表  |\n'
                     '| D02 | 研发业务流程图及Narrative | 院方流程负责人 |\n'
                     '| D03 | 风险与控制矩阵（RCM）      | 双方合规代表  |\n'
                     '| D04 | 数据字典、权限矩阵及接口说明    | 技术负责人   |\n'
                     '| D05 | AI智能查询验证报告        | 院方技术代表  |\n'
                     '| D06 | 最终验收报告与移交清单       | 双方项目负责人 |\n'
                     '\n'
                     '## 8. 项目风险\n'
                     '\n'
                     '**R-A01：科研数据敏感性风险**\n'
                     '\n'
                     '- 等级：中\n'
                     '- 风险：院方部分科研数据不得离开指定环境。\n'
                     '- 应对：采用驻场部署、合成测试数据及最小权限原则。\n'
                     '- 责任人：安塔尔\n'
                     '- 状态：控制措施执行中\n'
                     '\n'
                     '**R-A02：跨部门口径不一致**\n'
                     '\n'
                     '- 等级：中\n'
                     '- 风险：研究进度与预算数据缺乏一致定义。\n'
                     '- 应对：建立数据字典和指标口径审批流程。\n'
                     '- 责任人：安塔尔\n'
                     '- 状态：处理中\n'
                     '\n'
                     '## 9. 项目管理机制\n'
                     '\n'
                     '- 每周一开展项目计划会议。\n'
                     '- 每周五向佩丽卡提交状态报告。\n'
                     '- 每次需求变更必须形成正式变更记录。\n'
                     '- 影响合同金额、交付周期或核心技术方案的变更，应由项目监督审批。\n'
                     '- 院方验收后，所有成果统一归入EOPS项目档案。\n'
                     '\n'
                     '## 10. 当前工作记录（2026-10-22）\n'
                     '\n'
                     '**已完成：** 试点部门访谈、系统清单确认、主要流程梳理。\n'
                     '\n'
                     '**正在进行：** RCM设计、系统接口设计、智能问数场景定义。\n'
                     '\n'
                     '**未来七日任务：**\n'
                     '\n'
                     '- 完成研发预算控制设计。\n'
                     '- 核对科研项目及人员主数据。\n'
                     '- 向院方提交第一版风险清单。\n'
                     '\n'
                     '**项目负责人备注：**\n'
                     '\n'
                     '第一阶段的数据比我预想的更加复杂，但主要问题并非缺少技术，而是缺乏能够得到各部门共同认可的标准。我会优先解决数据口径和控制责任问题，再推进原型开发。\n'
                     '\n'
                     '—— 安塔尔',
      'requirement': ('科研治理与智能查询试点交付', '至少5个试点项目、3条流程、30条管理查询；关键数值准确率100%，取得签字验收。'),
      'tasks': [('A01', '项目启动及访谈计划', '安塔尔', '2026-09-14', '2026-09-18', '已完成', '—', []),
                ('A02', '现状流程与系统调研', '安塔尔', '2026-09-21', '2026-10-09', '已完成', 'A01', ['A01']),
                ('A03', '研发治理流程及RCM设计', '安塔尔', '2026-10-12', '2026-10-30', '进行中', 'A02', ['A02']),
                ('A04', '数据接口及权限方案设计', '技术支持组', '2026-10-19', '2026-11-06', '进行中', 'A02', ['A02']),
                ('A05', 'AI问数原型开发', '技术支持组', '2026-11-02', '2026-11-20', '未开始', 'A03、A04', ['A03', 'A04']),
                ('A06', '联合测试及用户验收测试', '安塔尔', '2026-11-23', '2026-12-04', '未开始', 'A05', ['A05']),
                ('A07', '缺陷修复、知识转移及最终验收', '安塔尔', '2026-12-07', '2026-12-18', '未开始', 'A06', ['A06'])],
      'milestones': [('项目正式启动', '2026-09-18', True),
                     ('现状调研报告确认', '2026-10-09', True),
                     ('流程及技术设计评审完成', '2026-11-06', False),
                     ('智能决策原型交付', '2026-11-20', False),
                     ('用户验收测试结束', '2026-12-04', False),
                     ('项目关闭与知识归档', '2026-12-18', False)]},
     {'title': '环塔商会跨区域战略物流服务采购项目',
      'start': '2026-10-12',
      'end': '2027-01-15',
      'members': ['艾维文娜', '佩丽卡', '采购支持组', '商务支持组', '物流支持组'],
      'color': '#5dd8cf',
      'description': '# EOPS-PJ-2026-002\n'
                     '\n'
                     '# 环塔商会跨区域战略物流服务采购项目\n'
                     '\n'
                     '**文档版本：** V1.1\n'
                     '**保密等级：** 商务机密\n'
                     '**项目负责人：** 艾维文娜\n'
                     '**项目监督：** 佩丽卡\n'
                     '**合作机构：** 环塔卫二企业联合商会（环塔商会）\n'
                     '**项目身份：** 甲方 / 服务采购及供应商管理\n'
                     '**项目周期：** 2026-10-12 至 2027-01-15\n'
                     '**框架合同上限：** 3,200,000 折金票（测试金额）\n'
                     '**优先级：** P1 / 高\n'
                     '**项目状态：** 采购实施中\n'
                     '**总体健康度：** 重点关注\n'
                     '**填报进度：** 14%\n'
                     '**状态更新时间：** 2026-10-22\n'
                     '\n'
                     '---\n'
                     '\n'
                     '## 1. 项目背景\n'
                     '\n'
                     '终末地工业在四号谷地及其他开拓区的建设项目持续增长。\n'
                     '\n'
                     '跨区域物资运输目前存在路线分散、价格不透明、异常事故响应不一致等问题。\n'
                     '\n'
                     '为降低物资交付的不确定性，终末地工业拟通过环塔商会组织统一采购跨区域物流服务，并建立长期运输合作机制。\n'
                     '\n'
                     '本项目采用框架协议及分批采购订单相结合的交易模式。环塔商会负责协调符合要求的成员企业，具体承运商须通过后续技术、商务及安全审查。\n'
                     '\n'
                     '## 2. 项目负责人陈述\n'
                     '\n'
                     '**艾维文娜：**\n'
                     '\n'
                     '我负责代表终末地工业组织本次采购。\n'
                     '\n'
                     '以前在商会做事的时候，我很清楚合同上的报价并不能说明全部问题。一条运输路线究竟是否可靠，要看承运人、保险、事故处理以及最糟糕的情况下谁来承担责任。\n'
                     '\n'
                     '所以，这次采购不只比价格。\n'
                     '\n'
                     '我需要把服务质量、供应商履约能力和风险分担机制写进合同，并确保那些条款真的能够执行。\n'
                     '\n'
                     '## 3. 采购目标\n'
                     '\n'
                     '| 指标     | 目标            |\n'
                     '| ------ | ------------- |\n'
                     '| 服务覆盖   | 覆盖4条主要物流线路    |\n'
                     '| 交付准时率  | ≥ 98%         |\n'
                     '| 关键物资运输 | 全程记录与交接追踪     |\n'
                     '| 事故响应时间 | 不超过2小时        |\n'
                     '| 物流成本   | 相比模拟基准下降8%    |\n'
                     '| 合规要求   | 所有入围承运商通过尽职调查 |\n'
                     '\n'
                     '\n'
                     '## 4. 采购范围\n'
                     '\n'
                     '**范围内：**\n'
                     '\n'
                     '- 商会成员企业询价及资质审查。\n'
                     '- 运输路线、仓储节点及中转方案设计。\n'
                     '- 框架合同、费率表、服务水平协议（SLA）。\n'
                     '- 运输安全与保险条款。\n'
                     '- 承运商绩效考核机制。\n'
                     '- 运输单据数字化及系统对接。\n'
                     '- 试点运输与全面服务推广。\n'
                     '\n'
                     '**范围外：**\n'
                     '\n'
                     '- 终末地工业自有工业设备制造。\n'
                     '- 开拓区固定设施的长期运行维护。\n'
                     '- 武装冲突地区的非授权运输。\n'
                     '\n'
                     '## 5. WBS 工作分解与任务排期\n'
                     '\n'
                     '| ID  | 任务         | 负责人   | 计划日期        | 状态  | 前置任务  |\n'
                     '| --- | ---------- | ----- | ----------- | --- | ----- |\n'
                     '| B01 | 采购立项及框架授权  | 艾维文娜  | 10-12～10-16 | 已完成 | —     |\n'
                     '| B02 | 需求征询及路线调研  | 艾维文娜  | 10-19～10-30 | 进行中 | B01   |\n'
                     '| B03 | 供应商尽职调查    | 采购支持组 | 10-26～11-06 | 未开始 | B02初稿 |\n'
                     '| B04 | 技术及商务综合评标  | 艾维文娜  | 11-02～11-13 | 未开始 | B03   |\n'
                     '| B05 | 服务费率及SLA确认 | 商务支持组 | 11-16～11-27 | 未开始 | B04   |\n'
                     '| B06 | 物流试运行      | 艾维文娜  | 11-30～12-11 | 未开始 | B05   |\n'
                     '| B07 | 分阶段运输服务上线  | 物流支持组 | 12-14～01-08 | 未开始 | B06   |\n'
                     '| B08 | 阶段验收及供应商评级 | 艾维文娜  | 01-11～01-15 | 未开始 | B07   |\n'
                     '\n'
                     '日期覆盖2026年至2027年。\n'
                     '\n'
                     '## 6. 采购及付款机制\n'
                     '\n'
                     '采购采取分阶段执行方式，框架合同金额为支出上限，不代表全部金额已支付或已形成采购订单。\n'
                     '\n'
                     '| 项目        | 金额（折金票）   |\n'
                     '| --------- | --------- |\n'
                     '| 框架合同上限    | 3,200,000 |\n'
                     '| 首批试运行采购订单 | 320,000   |\n'
                     '| 后续可执行额度   | 2,880,000 |\n'
                     '\n'
                     '付款与实际采购订单及验收记录绑定，不得仅凭框架协议直接确认全部应付款。\n'
                     '\n'
                     '## 7. 关键交付物\n'
                     '\n'
                     '- D01：采购需求说明书\n'
                     '- D02：承运商资质与尽职调查报告\n'
                     '- D03：技术及商务评标评分表\n'
                     '- D04：服务费率及SLA协议\n'
                     '- D05：运输事故与保险责任分配矩阵\n'
                     '- D06：试运行报告\n'
                     '- D07：阶段性供应商绩效评价报告\n'
                     '\n'
                     '## 8. 核心风险\n'
                     '\n'
                     '**R-B01：高风险路线服务覆盖不足**\n'
                     '\n'
                     '- 等级：高\n'
                     '- 风险：部分开拓区运输路线缺乏符合要求的承运商。\n'
                     '- 应对：对关键路线设置候补供应商和临时运输方案。\n'
                     '- 责任人：艾维文娜\n'
                     '- 截止日期：2026-11-06\n'
                     '- 状态：待解决\n'
                     '\n'
                     '**R-B02：供应商关联关系风险**\n'
                     '\n'
                     '- 等级：中\n'
                     '- 风险：商会成员间可能存在关联关系，影响报价独立性。\n'
                     '- 应对：开展关联方申报与利益冲突审查。\n'
                     '- 责任人：采购支持组\n'
                     '- 状态：进行中\n'
                     '\n'
                     '## 9. 采购决策和审批\n'
                     '\n'
                     '- 项目负责人：艾维文娜，负责采购计划和商务协调。\n'
                     '- 采购评审组：负责技术及商务评分。\n'
                     '- 合规审核人：负责供应商背景审查。\n'
                     '- 项目监督：佩丽卡，审批重大合同及采购例外。\n'
                     '- 最终批准：管理员，审批超授权额度及重大风险接受事项。\n'
                     '\n'
                     '供应商评标记录不得由单一人员单独批准。\n'
                     '\n'
                     '## 10. 当前工作记录（2026-10-22）\n'
                     '\n'
                     '**本周工作：**\n'
                     '\n'
                     '- 已完成框架合作授权。\n'
                     '- 已启动物流路线数据收集。\n'
                     '- 已向环塔商会发出第一批资料需求。\n'
                     '- 当前正在核查重点路线的真实运力。\n'
                     '\n'
                     '**待办：**\n'
                     '\n'
                     '- 整理候选服务商名单。\n'
                     '- 识别高风险路线及候补方案。\n'
                     '- 确认首批试运行线路。\n'
                     '- 完成供应商利益冲突申报。\n'
                     '\n'
                     '**项目负责人备注：**\n'
                     '\n'
                     '我们需要的是能够稳定履约的合作伙伴，而不是一份看起来漂亮的报价。我会把重点放在最难保障的线路上；只要它们仍然存在无法明确分担的风险，就不能进入最终采购确认阶段。\n'
                     '\n'
                     '—— 艾维文娜',
      'requirement': ('战略物流服务采购与供应商准入', '4条线路、准时率≥98%、事故响应≤2小时、模拟降本8%；框架上限与实际订单、付款分别记录。'),
      'tasks': [('B01', '采购立项及框架授权', '艾维文娜', '2026-10-12', '2026-10-16', '已完成', '—', []),
                ('B02', '需求征询及路线调研', '艾维文娜', '2026-10-19', '2026-10-30', '进行中', 'B01', ['B01']),
                ('B03', '供应商尽职调查', '采购支持组', '2026-10-26', '2026-11-06', '未开始', 'B02初稿', []),
                ('B04', '技术及商务综合评标', '艾维文娜', '2026-11-02', '2026-11-13', '未开始', 'B03', ['B03']),
                ('B05', '服务费率及SLA确认', '商务支持组', '2026-11-16', '2026-11-27', '未开始', 'B04', ['B04']),
                ('B06', '物流试运行', '艾维文娜', '2026-11-30', '2026-12-11', '未开始', 'B05', ['B05']),
                ('B07', '分阶段运输服务上线', '物流支持组', '2026-12-14', '2027-01-08', '未开始', 'B06', ['B06']),
                ('B08', '阶段验收及供应商评级', '艾维文娜', '2027-01-11', '2027-01-15', '未开始', 'B07', ['B07'])],
      'milestones': [('WBS节点 · 采购立项及框架授权完成', '2026-10-16', True),
                     ('WBS节点 · 物流试运行完成', '2026-12-11', False),
                     ('WBS节点 · 阶段验收及供应商评级完成', '2027-01-15', False)]},
     {'title': '联盟工团四号谷地供能与地质探针建设项目',
      'start': '2026-08-31',
      'end': '2027-02-12',
      'members': ['秋栗', '佩丽卡', '工程支持组', '制造支持组', '测试支持组', '商务支持组'],
      'color': '#ee9177',
      'description': '# EOPS-PJ-2026-003\n'
                     '\n'
                     '# 联盟工团四号谷地供能与地质探针建设项目\n'
                     '\n'
                     '**文档版本：** V2.0\n'
                     '**保密等级：** 内部 / 合同受限\n'
                     '**项目负责人：** 秋栗\n'
                     '**项目监督：** 佩丽卡\n'
                     '**客户机构：** 塔卫二全联盟工团\n'
                     '**项目身份：** 交易方 / 工业装备供应及工程交付\n'
                     '**项目周期：** 2026-08-31 至 2027-02-12\n'
                     '**合同金额：** 8,000,000 折金票（测试金额）\n'
                     '**优先级：** P0 / 关键\n'
                     '**项目状态：** 实施中 / 技术变更待审批\n'
                     '**总体健康度：** 高风险\n'
                     '**填报进度：** 31%\n'
                     '**状态更新时间：** 2026-10-22\n'
                     '\n'
                     '---\n'
                     '\n'
                     '## 1. 项目背景\n'
                     '\n'
                     '联盟工团计划在四号谷地建设新的地质监测与能源配套设施，为区域工业重建、地质研究及长期资源开发提供支持。\n'
                     '\n'
                     '终末地工业作为工程技术与设备提供方，负责部分集成工业装置、协议控制设备和能源配套系统的设计、制造、安装及调试。\n'
                     '\n'
                     '本项目采用分阶段交付与验收方式，并设置设备质量、工期、事故责任及质保条款。\n'
                     '\n'
                     '## 2. 项目负责人陈述\n'
                     '\n'
                     '**秋栗：**\n'
                     '\n'
                     '我接受了本项目的交付负责人任命。\n'
                     '\n'
                     '终末地工业承诺的不只是一批可以运转的设备。对于需要依靠这些设施生产和生活的工团成员而言，按期交付与长期可靠运行同样重要。\n'
                     '\n'
                     '我会协调制造、运输、工程与客户代表，确保每项交付都能获得有效验证。\n'
                     '\n'
                     '对于技术变更和潜在延期，我不会在报告里隐藏问题。\n'
                     '\n'
                     '## 3. 合同目标\n'
                     '\n'
                     '| 项目     | 验收标准           |\n'
                     '| ------ | -------------- |\n'
                     '| 能源模块交付 | 2套标准化供能模块      |\n'
                     '| 地质探针配套 | 1套监测与协议控制装置    |\n'
                     '| 稳定运行   | 连续72小时测试通过     |\n'
                     '| 设备可用性  | 试运行阶段≥99.5%    |\n'
                     '| 项目工期   | 不晚于2027-02-12  |\n'
                     '| 竣工资料   | 提交完整安装、调试及维护文档 |\n'
                     '\n'
                     '## 4. 商务合同及收款计划\n'
                     '\n'
                     '合同金额：8,000,000 折金票。\n'
                     '\n'
                     '| 付款阶段     | 比例  | 金额        |\n'
                     '| -------- | --- | --------- |\n'
                     '| 合同生效及预付款 | 20% | 1,600,000 |\n'
                     '| 工厂测试完成   | 30% | 2,400,000 |\n'
                     '| 现场安装完成   | 30% | 2,400,000 |\n'
                     '| 最终验收     | 20% | 1,600,000 |\n'
                     '\n'
                     '**截至2026-10-22：**\n'
                     '\n'
                     '- 已开票并收取预付款：1,600,000。\n'
                     '- 已确认后续收款计划：6,400,000。\n'
                     '- 尚未达到第二期付款条件。\n'
                     '\n'
                     '后续款项不得仅根据计划日期确认为已收款。\n'
                     '\n'
                     '## 5. WBS 工作分解与任务排期\n'
                     '\n'
                     '| ID  | 任务          | 负责人   | 计划日期        | 状态  | 前置任务 |\n'
                     '| --- | ----------- | ----- | ----------- | --- | ---- |\n'
                     '| C01 | 合同签署及项目启动   | 秋栗    | 08-31～09-04 | 已完成 | —    |\n'
                     '| C02 | 工程设计与客户评审   | 工程支持组 | 09-07～09-25 | 已完成 | C01  |\n'
                     '| C03 | 物料清单及产能评估   | 制造支持组 | 09-28～10-16 | 已完成 | C02  |\n'
                     '| C04 | 技术变更CR-07处理 | 秋栗    | 10-19～10-30 | 阻塞  | C03  |\n'
                     '| C05 | 最终物料采购与排产   | 制造支持组 | 11-02～11-13 | 未开始 | C04  |\n'
                     '| C06 | 设备制造与出厂测试   | 工程支持组 | 11-16～12-04 | 未开始 | C05  |\n'
                     '| C07 | 设备运输及现场交接   | 秋栗    | 12-07～12-18 | 未开始 | C06  |\n'
                     '| C08 | 现场安装与集成     | 工程支持组 | 12-21～01-15 | 未开始 | C07  |\n'
                     '| C09 | 联合调试及运行测试   | 测试支持组 | 01-18～01-29 | 未开始 | C08  |\n'
                     '| C10 | 项目验收与合同结算   | 秋栗    | 02-01～02-12 | 未开始 | C09  |\n'
                     '\n'
                     '日期覆盖2026年至2027年。\n'
                     '\n'
                     '## 6. 关键问题：技术变更 CR-07\n'
                     '\n'
                     '**变更编号：** CR-07\n'
                     '**提出日期：** 2026-10-19\n'
                     '**提出方：** 联盟工团工程代表\n'
                     '**变更原因：** 地质探针新增异常能源波动场景下的运行要求。\n'
                     '\n'
                     '**预估影响：**\n'
                     '\n'
                     '- 新增控制模块设计工作。\n'
                     '- 可能改变部分物料规格。\n'
                     '- 初步预计增加10个工作日的工程工作量。\n'
                     '- 尚未完成对合同工期的净影响评估。\n'
                     '\n'
                     '**当前状态：** 等待客户书面确认。\n'
                     '\n'
                     '**下一步处理：**\n'
                     '\n'
                     '1. 由技术支持人员完成影响分析。\n'
                     '2. 评估追加成本和现有设计复用程度。\n'
                     '3. 向客户提交变更报价及工期影响。\n'
                     '4. 取得客户审批后更新基准计划。\n'
                     '5. 将批准的变更资料纳入合同档案。\n'
                     '\n'
                     '未经批准，不得直接按照新的技术要求组织批量生产。\n'
                     '\n'
                     '## 7. 核心风险\n'
                     '\n'
                     '**R-C01：客户技术变更导致工期延误**\n'
                     '\n'
                     '- 等级：高\n'
                     '- 概率：高\n'
                     '- 影响：可能推迟制造及出厂测试。\n'
                     '- 责任人：秋栗\n'
                     '- 当前状态：已触发\n'
                     '- 对应问题：CR-07\n'
                     '\n'
                     '**R-C02：物流线路可用性不足**\n'
                     '\n'
                     '- 等级：中\n'
                     '- 风险：设备运输高度依赖部分高风险运输路线。\n'
                     '- 应对：与EOPS-PJ-2026-002项目共享运输试点计划，建立备用承运方案。\n'
                     '- 责任人：秋栗\n'
                     '- 状态：监控中\n'
                     '\n'
                     '**R-C03：现场能源环境波动**\n'
                     '\n'
                     '- 等级：中\n'
                     '- 风险：现场条件可能与设计基准不一致。\n'
                     '- 应对：安装前重新验证现场技术参数。\n'
                     '- 状态：未触发\n'
                     '\n'
                     '## 8. 交付物与归档\n'
                     '\n'
                     '- D01：合同及技术附件\n'
                     '- D02：设备设计图纸\n'
                     '- D03：BOM及采购清单\n'
                     '- D04：设备出厂测试报告\n'
                     '- D05：现场交接与安装记录\n'
                     '- D06：联合调试报告\n'
                     '- D07：客户验收证明\n'
                     '- D08：收款及质保档案\n'
                     '\n'
                     '## 9. 治理与审批\n'
                     '\n'
                     '- 秋栗：项目执行、客户沟通和交付协调。\n'
                     '- 工程支持组：方案设计与技术验证。\n'
                     '- 商务支持组：合同、应收款与变更报价。\n'
                     '- 佩丽卡：重大工程变更与资源冲突审批。\n'
                     '- 管理员：重大合同风险接受及跨项目资源协调。\n'
                     '\n'
                     '## 10. 当前工作记录（2026-10-22）\n'
                     '\n'
                     '**已完成：**\n'
                     '\n'
                     '- 合同签署。\n'
                     '- 预付款收取。\n'
                     '- 初步设计评审。\n'
                     '- 设备物料清单评估。\n'
                     '\n'
                     '**当前阻塞：**\n'
                     '\n'
                     '- 客户新增技术要求尚未完成审批。\n'
                     '- 部分采购工作无法启动。\n'
                     '- 后续工程排期存在调整风险。\n'
                     '\n'
                     '**未来七日任务：**\n'
                     '\n'
                     '- 完成CR-07影响评估。\n'
                     '- 形成变更费用说明。\n'
                     '- 召开客户专项协调会议。\n'
                     '- 提交调整后的工程排期方案。\n'
                     '\n'
                     '**项目负责人备注：**\n'
                     '\n'
                     '设计变更本身不是不可处理的问题。真正需要避免的是在变更尚未批准时提前制造设备，最终让整个团队承担返工和延期成本。\n'
                     '\n'
                     '我已经要求相关部门暂停受影响物料的正式采购。待客户确认变更范围后，我将重新提交项目进度基准。\n'
                     '\n'
                     '—— 秋栗',
      'requirement': ('供能模块与地质探针工程交付', '2套供能模块、1套监测与协议控制装置、72小时测试、可用性≥99.5%；按合同阶段验收。'),
      'tasks': [('C01', '合同签署及项目启动', '秋栗', '2026-08-31', '2026-09-04', '已完成', '—', []),
                ('C02', '工程设计与客户评审', '工程支持组', '2026-09-07', '2026-09-25', '已完成', 'C01', ['C01']),
                ('C03', '物料清单及产能评估', '制造支持组', '2026-09-28', '2026-10-16', '已完成', 'C02', ['C02']),
                ('C04', '技术变更CR-07处理', '秋栗', '2026-10-19', '2026-10-30', '阻塞', 'C03', ['C03']),
                ('C05', '最终物料采购与排产', '制造支持组', '2026-11-02', '2026-11-13', '未开始', 'C04', ['C04']),
                ('C06', '设备制造与出厂测试', '工程支持组', '2026-11-16', '2026-12-04', '未开始', 'C05', ['C05']),
                ('C07', '设备运输及现场交接', '秋栗', '2026-12-07', '2026-12-18', '未开始', 'C06', ['C06']),
                ('C08', '现场安装与集成', '工程支持组', '2026-12-21', '2027-01-15', '未开始', 'C07', ['C07']),
                ('C09', '联合调试及运行测试', '测试支持组', '2027-01-18', '2027-01-29', '未开始', 'C08', ['C08']),
                ('C10', '项目验收与合同结算', '秋栗', '2027-02-01', '2027-02-12', '未开始', 'C09', ['C09'])],
      'milestones': [('WBS节点 · 合同签署及项目启动完成', '2026-09-04', True),
                     ('WBS节点 · 设备制造与出厂测试完成', '2026-12-04', False),
                     ('WBS节点 · 现场安装与集成完成', '2027-01-15', False),
                     ('WBS节点 · 项目验收与合同结算完成', '2027-02-12', False)]}]
    for order, definition in enumerate(definitions):
        project = create_item(state, "project", {
            "title": "示例 · " + definition["title"],
            "description": definition["description"] + mapping,
            "startDate": definition["start"], "endDate": definition["end"],
            "members": list(dict.fromkeys([state["settings"]["selfName"], *definition["members"]])),
            "color": definition["color"],
        })
        project["order"] = order
        batch = create_item(state, "batch", {"projectId": project["id"], "date": definition["start"]})
        requirement_title, requirement_description = definition["requirement"]
        requirement = create_item(state, "requirement", {
            "projectId": project["id"], "batchId": batch["id"], "title": requirement_title,
            "description": requirement_description, "kind": "new",
        })
        tasks = {}
        for code, title, worker, start, end, status, condition, predecessors in definition["tasks"]:
            if code == "B03":
                condition += "（仅需初稿；未映射为B02整项完成依赖）"
            description = (
                f"计划区间：{start} 至 {end}。\n"
                f"负责人：{worker}；{snapshot}快照状态：{status}；前置条件：{condition}。\n"
                "现有单日安排取计划截止日，不代表只需一天或实际完成日。"
            )
            if code == "C04":
                description += "\nCR-07等待客户书面确认；10个工作日是初步新增工作量，尚非合同工期净延期。批准前暂停受影响物料正式采购及按新要求批量生产。"
            task = create_item(state, "task", {
                "projectId": project["id"], "requirementId": requirement["id"],
                "title": f"{code} · {title}", "description": description,
                "date": end, "workers": [worker], "done": status == "已完成",
                "difficulty": "normal", "dependencies": [tasks[key]["id"] for key in predecessors],
            })
            if task["done"]:
                # The source supplies status, not an actual completion timestamp.
                task["completedAt"] = snapshot + "T00:00:00+08:00"
            tasks[code] = task
        for title, date, done in definition["milestones"]:
            create_item(state, "milestone", {
                "projectId": project["id"], "title": title, "date": date, "done": done,
                "description": (
                    "由原始WBS计划截止日整理为交付节点，不表示原设定另有独立里程碑。"
                    if title.startswith("WBS节点") else "原始项目书中的关键里程碑。"
                ) + f"完成状态按{snapshot}快照登记。",
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
            existing = json.loads(encoded)
            validate_state(existing)
            require(stored_revision == existing["revision"], "数据库版本不一致，请从备份恢复")
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
                    validate_state(payload["state"])
                    self.save_backup(current, "before-import")
                    state = copy.deepcopy(payload["state"])
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
