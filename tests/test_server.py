"""Contract tests run entirely against disposable databases and loopback ports."""
import copy
from contextlib import closing
import http.client
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("eops_server", Path(__file__).resolve().parents[1] / "server/server.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = module.Store(self.root / "data/dayline.sqlite3", self.root / "backups")

    def tearDown(self):
        self.temp.cleanup()

    def act(self, kind, payload=None, **kwargs):
        return self.store.action({"type": kind, "payload": payload or {}, **kwargs})

    def project(self, title="测试项目"):
        return self.act("project.create", {"title": title, "startDate": "2026-10-01", "endDate": "2026-11-01"})["projects"][-1]

    def task(self, project, title="任务", **kwargs):
        return self.act("task.create", {"projectId": project["id"], "title": title, **kwargs})["tasks"][-1]

    def test_persistence_and_revision_conflict(self):
        project = self.project()
        other = module.Store(self.root / "data/dayline.sqlite3", self.root / "backups")
        self.assertEqual(other.read()["projects"][0]["id"], project["id"])
        with self.assertRaises(module.ApiError) as context:
            self.act("project.update", {"id": project["id"], "title": "stale"}, expectedRevision=0)
        self.assertEqual(context.exception.status, 409)
        self.assertEqual(other.read()["projects"][0]["title"], "测试项目")

    def test_toggle_keeps_order_and_completion_is_manual(self):
        project = self.project()
        task = self.task(project)
        completed = self.act("task.update", {"id": task["id"], "done": True})["tasks"][0]
        self.assertEqual(task["order"], completed["order"])
        self.assertIn("completedAt", completed)
        reopened = self.act("task.update", {"id": task["id"], "done": False})
        self.assertNotIn("completedAt", reopened["tasks"][0])
        old = self.act("project.update", {"id": project["id"], "startDate": "2020-01-01", "endDate": "2020-02-01"})
        self.assertEqual(old["projects"][0]["status"], "active")

    def test_cascade_and_requirement_links(self):
        project = self.project()
        batch = self.act("batch.create", {"projectId": project["id"], "date": "2026-10-21"})["batches"][0]
        req = self.act("requirement.create", {"projectId": project["id"], "batchId": batch["id"], "title": "新增功能"})["requirements"][0]
        first = self.task(project, requirementId=req["id"])
        second = self.task(project, dependencies=[first["id"]])
        state = self.act("batch.delete", {"id": batch["id"]})
        self.assertFalse(state["requirements"])
        self.assertNotIn("requirementId", state["tasks"][0])
        state = self.act("task.delete", {"id": first["id"]})
        self.assertEqual(state["tasks"][0]["dependencies"], [])
        state = self.act("project.delete", {"id": project["id"]})
        self.assertFalse(any(state[key] for key in module.COLLECTIONS.values()))

    def test_cycles_cross_project_and_unknown_fields_rejected(self):
        project = self.project()
        other = self.project("另一个")
        a = self.task(project, "a")
        b = self.task(project, "b", dependencies=[a["id"]])
        before = self.store.read()
        for kind, payload in (
            ("task.update", {"id": a["id"], "dependencies": [b["id"]]}),
            ("task.create", {"projectId": other["id"], "title": "cross", "dependencies": [a["id"]]}),
            ("task.update", {"id": a["id"], "workers": ["陌生人"]}),
            ("project.update", {"id": project["id"], "revision": 500}),
            ("project.update", {"id": project["id"], "endDate": "2026-09-01"}),
            ("task.update", {"id": a["id"], "done": "yes"}),
            ("task.update", {"id": a["id"], "date": "2026-02-30"}),
            ("task.update", {"id": a["id"], "subtasks": [{"id": str(i), "title": "x", "done": False} for i in range(21)]}),
        ):
            with self.subTest(payload=payload), self.assertRaises(module.ApiError):
                self.act(kind, payload)
            self.assertEqual(before, self.store.read())

    def test_subgroup_reorder_and_self_name(self):
        project = self.project()
        tasks = [self.task(project, str(i)) for i in range(4)]
        state = self.act("task.reorder", {"ids": [tasks[2]["id"], tasks[0]["id"]]})
        self.assertEqual([t["order"] for t in state["tasks"]], [2, 1, 0, 3])
        state = self.act("settings.update", {"selfName": "我"})
        self.assertEqual(state["projects"][0]["members"], ["我"])
        self.assertTrue(all(t["workers"] == ["我"] for t in state["tasks"]))

    def test_member_and_date_changes_preserve_existing_work(self):
        project = self.project()
        self.act("project.update", {"id": project["id"], "members": ["自己", "小林"]})
        task = self.task(project, "已交付", date="2026-10-20", workers=["小林"], done=True)
        state = self.act("project.update", {"id": project["id"], "members": ["自己"], "startDate": "2026-11-01", "endDate": "2026-12-01"})
        self.assertEqual(state["tasks"][0], task)
        self.act("task.update", {"id": task["id"], "title": "已交付并归档", "workers": ["小林", "自己"]})
        with self.assertRaises(module.ApiError):
            self.task(project, "新安排", workers=["小林"])
        state = self.act("task.update", {"id": task["id"], "workers": ["自己"]})
        with self.assertRaises(module.ApiError):
            self.act("task.update", {"id": task["id"], "workers": ["小林"]})
        self.assertEqual(state, self.store.read())

    def test_self_name_collision_cannot_merge_worker_history(self):
        project = self.project()
        self.act("project.update", {"id": project["id"], "members": ["自己", "小林"]})
        self.task(project, "我完成的任务", workers=["自己"])
        self.task(project, "小林完成的任务", workers=["小林"])
        before = self.store.read()
        with self.assertRaises(module.ApiError):
            self.act("settings.update", {"selfName": "小林"})
        self.assertEqual(self.store.read(), before)
        # Removing a member must not allow their historical attribution to be merged.
        self.act("project.update", {"id": project["id"], "members": ["自己"]})
        removed = self.store.read()
        with self.assertRaises(module.ApiError):
            self.act("settings.update", {"selfName": "小林"})
        self.assertEqual(self.store.read(), removed)
        # A safe rename and rename-back retain both people's original work.
        self.act("settings.update", {"selfName": "我的新称呼"})
        returned = self.act("settings.update", {"selfName": "自己"})
        self.assertEqual([task["workers"] for task in returned["tasks"]], [["自己"], ["小林"]])

    def test_all_schedule_dates_respect_supported_range(self):
        project = self.project()
        task = self.task(project, date="")
        self.act("task.update", {"id": task["id"], "date": "1900-01-01"})
        self.act("task.update", {"id": task["id"], "date": "2099-12-31"})
        before = self.store.read()
        for kind, payload in (
            ("project.update", {"id": project["id"], "startDate": "1899-12-31"}),
            ("project.update", {"id": project["id"], "endDate": "2100-01-01"}),
            ("task.update", {"id": task["id"], "date": "1899-12-31"}),
            ("batch.create", {"projectId": project["id"], "date": "2100-01-01"}),
            ("milestone.create", {"projectId": project["id"], "title": "超出范围", "date": "2100-01-01"}),
            ("settings.update", {"calendarOverrides": {"2100-01-01": {"workday": True, "note": "超出范围"}}}),
        ):
            with self.subTest(kind=kind), self.assertRaises(module.ApiError):
                self.act(kind, payload)
            self.assertEqual(self.store.read(), before)
        invalid_import = copy.deepcopy(before)
        invalid_import["tasks"][0]["date"] = "9999-12-31"
        with self.assertRaises(module.ApiError):
            self.act("state.import", {"state": invalid_import})
        self.assertEqual(self.store.read(), before)

    def test_backup_import_restore_and_schema_validation(self):
        self.project()
        original = self.store.read()
        self.act("backup.create")
        backup = self.root / "backups" / self.store.list_backups()[0]["name"]
        self.assertEqual(json.loads(backup.read_text()), original)
        with closing(sqlite3.connect(backup.with_suffix(".sqlite3"))) as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(json.loads(conn.execute("SELECT state_json FROM app_state").fetchone()[0]), original)
        self.project("后来新增")
        before_restore = self.store.read()
        restored = self.act("state.import", {"state": original}, expectedRevision=before_restore["revision"])
        self.assertEqual(restored["projects"], original["projects"])
        self.assertEqual(restored["revision"], before_restore["revision"] + 1)
        prior = list((self.root / "backups").glob("*before-import*.json"))
        self.assertEqual(json.loads(prior[0].read_text()), before_restore)
        for alteration in (lambda s: s.update(schemaVersion=2), lambda s: s["projects"][0].update(unknown=True), lambda s: s["settings"].update(fontSize=999)):
            invalid = copy.deepcopy(original)
            alteration(invalid)
            with self.assertRaises(module.ApiError):
                self.act("state.import", {"state": invalid})
        self.assertEqual(self.store.read(), restored)

    def test_import_backup_failure_keeps_database_unchanged(self):
        self.project()
        original = self.store.read()
        replacement = module.empty_state()
        with mock.patch.object(self.store, "save_backup", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.act("state.import", {"state": replacement})
        self.assertEqual(self.store.read(), original)

    def test_demo_uses_fixed_fiction_snapshot_and_does_not_overwrite(self):
        with mock.patch.object(module, "today", return_value=module.dt.date(2031, 6, 1)):
            state = self.act("demo.load")
        self.assertEqual([p["title"] for p in state["projects"]], [
            "示例 · 宏山科学院科研治理与智能决策平台建设项目",
            "示例 · 环塔商会跨区域战略物流服务采购项目",
            "示例 · 联盟工团四号谷地供能与地质探针建设项目",
        ])
        self.assertEqual([(p["startDate"], p["endDate"]) for p in state["projects"]], [
            ("2026-09-14", "2026-12-18"), ("2026-10-12", "2027-01-15"), ("2026-08-31", "2027-02-12"),
        ])
        self.assertEqual(len(state["tasks"]), 25)
        self.assertEqual(len(state["milestones"]), 13)
        self.assertEqual([p["order"] for p in state["projects"]], [0, 1, 2])
        for project, owner in zip(state["projects"], ("安塔尔", "艾维文娜", "秋栗")):
            self.assertIn(owner, project["members"])
            self.assertIn(state["settings"]["selfName"], project["members"])
            self.assertTrue(project["description"].startswith("# EOPS-PJ-2026-"))
            self.assertIn("2026-10-22", project["description"])
            self.assertEqual(project["status"], "active")
        for collection in ("projects", "tasks", "requirements", "milestones"):
            for item in state[collection]:
                for notice in ("警告", "AI生成", "OOC", "未核实", "二创测试设定"):
                    self.assertNotIn(notice, item["description"])
        done = [t for t in state["tasks"] if t["done"]]
        self.assertEqual([t["title"].split(" · ")[0] for t in done], ["A01", "A02", "B01", "C01", "C02", "C03"])
        self.assertTrue(all(t["completedAt"] == "2026-10-22T00:00:00+08:00" for t in done))
        self.assertTrue(all("completedAt" not in t for t in state["tasks"] if not t["done"]))
        with self.assertRaises(module.ApiError):
            self.act("demo.load")
        self.assertEqual(state, self.store.read())

    def test_demo_preserves_responsibility_dependencies_and_cross_year_dates(self):
        self.act("settings.update", {"selfName": "个人管理者", "calendarOverrides": {
            "2026-10-24": {"workday": True, "note": "个人安排"},
        }})
        settings = copy.deepcopy(self.store.read()["settings"])
        state = self.act("demo.load")
        self.assertEqual(state["settings"], settings)
        tasks = {t["title"].split(" · ")[0]: t for t in state["tasks"]}
        self.assertEqual(tasks["A04"]["workers"], ["技术支持组"])
        self.assertEqual(tasks["B01"]["workers"], ["艾维文娜"])
        self.assertEqual(tasks["C02"]["workers"], ["工程支持组"])
        self.assertEqual(tasks["C04"]["workers"], ["秋栗"])
        self.assertEqual(tasks["A05"]["dependencies"], [tasks["A03"]["id"], tasks["A04"]["id"]])
        self.assertEqual(tasks["C05"]["dependencies"], [tasks["C04"]["id"]])
        self.assertEqual(tasks["B03"]["dependencies"], [])
        self.assertIn("B02初稿", tasks["B03"]["description"])
        self.assertFalse(tasks["C04"]["done"])
        self.assertIn("快照状态：阻塞", tasks["C04"]["description"])
        self.assertIn("尚非合同工期净延期", tasks["C04"]["description"])
        self.assertEqual(tasks["B07"]["date"], "2027-01-08")
        self.assertIn("2026-12-14 至 2027-01-08", tasks["B07"]["description"])
        self.assertEqual(tasks["C08"]["date"], "2027-01-15")
        self.assertIn("2026-12-21 至 2027-01-15", tasks["C08"]["description"])
        self.assertEqual(tasks["C10"]["date"], "2027-02-12")
        p1, p2, p3 = state["projects"]
        self.assertIn("1,200,000 折金票", p1["description"])
        self.assertIn("框架合同上限", p2["description"])
        self.assertIn("3,200,000", p2["description"])
        self.assertIn("320,000", p2["description"])
        self.assertIn("2,880,000", p2["description"])
        self.assertIn("不代表全部金额已支付或已形成采购订单", p2["description"])
        self.assertIn("已开票并收取预付款：1,600,000", p3["description"])
        self.assertIn("已确认后续收款计划：6,400,000", p3["description"])
        self.assertIn("尚未达到第二期付款条件", p3["description"])

    def test_demo_cannot_replace_personal_projects(self):
        self.project("我的个人项目")
        before = self.store.read()
        with self.assertRaises(module.ApiError):
            self.act("demo.load")
        self.assertEqual(self.store.read(), before)

    def test_concurrent_writers_cannot_overwrite_each_other(self):
        outcomes = []
        barrier = threading.Barrier(2)
        def write(title):
            barrier.wait()
            try:
                other = module.Store(self.root / "data/dayline.sqlite3", self.root / "backups")
                other.action({"type": "project.create", "payload": {"title": title}, "expectedRevision": 0})
                outcomes.append(200)
            except module.ApiError as error:
                outcomes.append(error.status)
        threads = [threading.Thread(target=write, args=(title,)) for title in ("甲", "乙")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(outcomes), [200, 409])
        self.assertEqual(len(self.store.read()["projects"]), 1)


class HttpTests(unittest.TestCase):
    def setUp(self):
        StoreTests.setUp(self)
        dist = self.root / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<html>EOPS</html>")
        (self.root / "secret.txt").write_text("secret")
        self.server = module.Server(("127.0.0.1", 0), self.store, dist)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        StoreTests.tearDown(self)

    def request(self, path, method="GET", data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        payload = json.dumps(data) if data is not None else None
        selected = {"Content-Type": "application/json", **(headers or {})}
        connection.request(method, path, payload, selected)
        response = connection.getresponse()
        body, status, response_headers = response.read(), response.status, dict(response.getheaders())
        connection.close()
        return status, body, response_headers

    def test_http_security_and_spa_routes(self):
        port = self.server.server_port
        self.assertEqual(self.request("/api/state")[0], 200)
        self.assertEqual(self.request("/project/abc/tasks?date=2026-10-22")[0], 200)
        self.assertEqual(self.request("/../secret.txt")[0], 404)
        self.assertEqual(self.request("/%2e%2e/secret.txt")[0], 404)
        self.assertEqual(self.request("/.env")[0], 404)
        self.assertEqual(self.request("/api/state", headers={"Host": "evil.example"})[0], 403)
        action = {"type": "project.create", "payload": {"title": "HTTP test"}, "expectedRevision": 0}
        self.assertEqual(self.request("/api/action", "POST", action, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("/api/action", "POST", action, {"Content-Type": "text/plain"})[0], 415)
        response = self.request("/api/action", "POST", action, {"Origin": f"http://127.0.0.1:{port}"})
        self.assertEqual(response[0], 200)
        self.assertEqual(json.loads(response[1])["revision"], 1)
        self.assertNotIn("Access-Control-Allow-Origin", response[2])
        self.assertEqual(self.request("/api/action", "POST", action)[0], 409)
        export = self.request("/api/export")
        self.assertIn("attachment", export[2]["Content-Disposition"])
        self.assertEqual(json.loads(export[1]), self.store.read())


if __name__ == "__main__":
    unittest.main()
