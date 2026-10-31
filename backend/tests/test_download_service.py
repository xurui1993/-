import contextlib
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import threading
import shutil
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import download_service as service
from fengshen_bill import validate_bill_file, MonthlyBillRequest
from test_parttime_source import daily_file, rider_file, file_checks, write_csv, WAYBILL_COLUMNS, VIOLATION_COLUMNS

TODAY = dt.date(2026, 10, 16)
PUBLISHED_AT = "2026-10-16T06:30:45+00:00"


class FakeRunner:
    def __init__(self):
        self.calls = []
        self.fail = set()

    def daily(self, plan, directory, selected):
        self.calls.append((plan.city, "daily", set(selected)))
        if (plan.city, "daily") in self.fail:
            raise RuntimeError("token=synthetic-private https://private.invalid/path")
        directory.mkdir(parents=True)
        source = directory / "bill.zip"
        for key in ("delivery_fee", "penalty"):
            if key in selected:
                daily_file(directory / (service.DATASETS[key] + ".csv"), [
                    [plan.start, plan.agency_id, "TEST-1", "1.00", "泉州测试站"],
                    [plan.start, plan.agency_id, "TEST-2", "1.00", "泉州测试站(取分离)"],
                ])
        with zipfile.ZipFile(source, "w") as archive:
            for file in directory.glob("*.csv"):
                archive.write(file, file.name)
        return dict(dataset="agency_daily", agency_id=plan.agency_id, start=plan.start, end=plan.end,
                    status="success", files=[dict(path=source.name, **validate_bill_file(source))])

    def monthly(self, plan, directory):
        self.calls.append((plan.city, "monthly", plan.month))
        directory.mkdir(parents=True)
        source = directory / "monthly.xlsx"
        rider_file(source, [["bill_" + plan.month, "TEST-1", "test", plan.agency_id, "1", "station", plan.month, "text", "进行中", "1"]])
        request = MonthlyBillRequest(plan.month)
        return dict(dataset="rider_monthly", agency_id=plan.agency_id, start=request.start, end=request.end,
                    status="success", files=[dict(path=source.name, **validate_bill_file(source))])

    def rider_source(self, plan, directory, kind):
        from rider_sources import validate_document
        self.calls.append((plan.city, kind, plan.start, plan.end))
        if (plan.city, kind) in self.fail:
            raise RuntimeError("token=synthetic-private https://private.invalid/path")
        directory.mkdir(parents=True)
        path = directory / (kind + ".csv")
        if kind == "receive_account":
            write_csv(path, ["团队ID", "团队名称", "骑手ID", "收款方式", "收款账户", "收款账户姓名", "收款账户身份证"],
                      [{"团队ID": "1", "团队名称": "test", "骑手ID": "001", "收款方式": "测试方式",
                        "收款账户": "synthetic", "收款账户姓名": "test", "收款账户身份证": ""}])
        elif kind == "rider_info":
            write_csv(path, ["骑手ID", "姓名", "部门", "身份证", "状态"],
                      [{"骑手ID": "001", "姓名": "test", "部门": "test", "身份证": "", "状态": "在职"}])
        else:
            write_csv(path, ["日期", "骑手ID", "团队ID", "团队名称", "有效完成单"],
                      [{"日期": plan.start, "骑手ID": "001", "团队ID": "1", "团队名称": "test", "有效完成单": 5},
                       {"日期": plan.start, "骑手ID": "002", "团队ID": "1", "团队名称": "test(取分离)", "有效完成单": 5}])
        return {**validate_document(path, kind, plan, {"1": "test"}),
                "dataset": kind, "scope": "target_city", "city": plan.city, "agency_id": plan.agency_id,
                "start": plan.start, "end": plan.end, "month": plan.month}

    def goods_rent(self, plan, directory):
        import hashlib
        from fengshen_http_riders import GOODS_RENT_HEADERS
        from openpyxl import Workbook
        self.calls.append((plan.city, "goods_rent", plan.start, plan.end))
        if (plan.city, "goods_rent") in self.fail:
            raise RuntimeError("token=synthetic-private https://private.invalid/path")
        directory.mkdir(parents=True)
        path = directory / "goods_rent.xlsx"
        book = Workbook(write_only=True)
        sheet = book.create_sheet()
        sheet.append(list(GOODS_RENT_HEADERS))
        sheet.append(["test", "1", "rider", "001", "15100000000", "租用", "住宿", "1.0", plan.start, "tester", "", "进行中"])
        book.save(path)
        book.close()
        return dict(dataset="goods_rent", status="validated", scope="target_city", city=plan.city,
                    agency_id=plan.agency_id, start=plan.start, end=plan.end, month=plan.month,
                    rows=1, path=path.name, bytes=path.stat().st_size,
                    sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    requested_start=plan.start, requested_end=plan.end, requested_month=plan.month)

    def orders(self, plan, directory, selected):
        self.calls.append((plan.city, "orders", set(selected)))
        manifests = []
        for first, last in service.date_batches(plan.start, plan.end):
            batch = directory / (first + "_" + last)
            batch.mkdir(parents=True)
            write_csv(batch / "orders.csv", WAYBILL_COLUMNS)
            files = {"waybills": "orders.csv"}
            if "problem" in selected:
                write_csv(batch / "violations.csv", VIOLATION_COLUMNS)
                files["violations"] = "violations.csv"
            manifests.append(dict(dataset="issue_orders", agency_id=plan.agency_id, start=first, end=last,
                status="success", time_basis="tracking_finish", merchant_group="物流合作商", all_city_riders=True,
                files=files, file_checks=file_checks(batch, files), expected_waybills=0))
        return manifests


class DownloadServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.runner = FakeRunner()
        original_batches = service.date_batches
        self.clock = patch.object(service, "date_batches", side_effect=lambda a, b, today=None: original_batches(a, b, today or TODAY))
        self.clock.start()
        self.addCleanup(self.clock.stop)
        filename = service.archive_filename
        self.names = patch.object(service, "archive_filename", side_effect=lambda city, dataset, start, end,
                                  suffix=".csv", **options: filename(city, dataset, start, end, suffix, **options))
        self.name_calls = self.names.start()
        self.addCleanup(self.names.stop)

    def config(self, datasets, **options):
        return service.validate_request({"cities": ["泉州"], "datasets": datasets,
            "start": "2026-09-20", "end": "2026-10-10", **options}, today=TODAY)

    def execute(self, config):
        updates, logs = [], []
        files = service.execute_downloads({**config, "owner": "test"}, self.root / "run", logs.append,
            threading.Event(), updates.append, runner_factory=lambda *args: contextlib.nullcontext(self.runner))
        return files, updates, logs

    def test_all_covered_months_include_cross_year_and_leap_february(self):
        value = service.validate_request(dict(cities=["泉州"], datasets=["rider_monthly"],
            start="2023-12-20", end="2024-02-10"), today=TODAY)
        self.assertEqual(value["months"], ["2023-12", "2024-01", "2024-02"])
        self.assertEqual(MonthlyBillRequest(value["months"][-1]).end, "2024-02-29")

    def test_history_refresh_option_is_boolean_and_default_scope_is_unchanged(self):
        self.assertNotIn("refresh_history", self.config(["problem"]))
        self.assertTrue(self.config(["problem"], refresh_history=True)["refresh_history"])
        with self.assertRaises(service.ValidationError):
            self.config(["problem"], refresh_history="true")

    def test_invalid_cities_datasets_dates_and_empty_selections(self):
        for changes in ({"cities": []}, {"cities": ["未配置城市"]}, {"datasets": []},
                        {"datasets": ["unknown"]}, {"start": "2026-10-11", "end": "2026-10-10"},
                        {"start": "2026-02-30"}, {"end": "2026-11-01"}):
            with self.subTest(changes=changes), self.assertRaises(service.ValidationError):
                service.validate_request({"cities": ["泉州"], "datasets": ["delivery_fee"],
                                          "start": "2026-09-20", "end": "2026-10-10", **changes}, today=TODAY)

    def test_monthly_only_does_not_apply_order_sixty_day_limit(self):
        value = service.validate_request(dict(cities=["泉州"], datasets=["rider_monthly"],
            start="2025-09-20", end="2025-10-10"), today=TODAY)
        self.assertEqual(value["months"], ["2025-09", "2025-10"])
        with self.assertRaises(service.ValidationError):
            service.validate_request({**value, "datasets": ["fraud"]}, today=TODAY)

    def test_single_delivery_publishes_no_other_type(self):
        files, updates, _ = self.execute(self.config(["delivery_fee"]))
        self.assertEqual([file["dataset"] for file in files], ["delivery_fee"])
        self.assertEqual(len(self.runner.calls), 1)
        self.assertEqual(updates[-1]["status"], "success")
        self.assertTrue(all((self.root / "run" / f["relative_path"]).is_file() for f in files))

    def test_separation_unchecked_excludes_separation_rows(self):
        import csv
        files, _, _ = self.execute(self.config(["delivery_fee"]))
        proof = files[0]["separation_filter"]
        self.assertEqual((proof["column"], proof["rows_before"], proof["rows_after"]), ("团队名称", 2, 1))
        with open(self.root / "run" / files[0]["relative_path"], encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.reader(stream))
        self.assertEqual([row[4] for row in rows[1:]], ["泉州测试站"])

    def test_separation_checked_keeps_only_separation_rows(self):
        import csv
        files, _, _ = self.execute(self.config(["delivery_fee"], include_separation=True))
        proof = files[0]["separation_filter"]
        self.assertEqual((proof["column"], proof["rows_before"], proof["rows_after"]), ("团队名称", 2, 1))
        with open(self.root / "run" / files[0]["relative_path"], encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.reader(stream))
        self.assertEqual([row[4] for row in rows[1:]], ["泉州测试站(取分离)"])

    def test_binding_sources_exclude_separation_when_unchecked(self):
        import csv
        sources = Mock(); sources.employees.return_value = Path('employee.xlsx'); sources.proxies.return_value = Path('proxy.xlsx')
        config = service.validate_request({'cities': ['泉州'], 'datasets': ['payment_binding'],
                                           'start': '2026-09-20', 'end': '2026-09-30'})
        config['owner'] = 'test'
        captured = {}
        def generate(paths, employees, proxies, plan, raw, log, cancelled):
            with open(paths['rider_detail'], encoding='utf-8-sig', newline='') as stream:
                captured['teams'] = {row['团队名称'] for row in csv.DictReader(stream)}
            path = Path(raw) / 'generated.xlsx'; path.write_bytes(b'fixture')
            return path, {}
        @contextlib.contextmanager
        def factory(*_): yield self.runner
        with patch('binding_sources_http.BindingSources', return_value=sources), \
             patch('binding_download.generate_binding', side_effect=generate):
            files = service.execute_downloads(config, self.root / 'run', lambda *_: None,
                                              threading.Event(), lambda *_: None, factory)
        self.assertEqual(len(files), 1)
        self.assertEqual(captured['teams'], {'test'})

    def test_binding_sources_keep_only_separation_when_checked(self):
        import csv
        sources = Mock(); sources.employees.return_value = Path('employee.xlsx'); sources.proxies.return_value = Path('proxy.xlsx')
        config = service.validate_request({'cities': ['泉州'], 'datasets': ['payment_binding'],
                                           'start': '2026-09-20', 'end': '2026-09-30',
                                           'include_separation': True})
        config['owner'] = 'test'
        captured = {}
        def generate(paths, employees, proxies, plan, raw, log, cancelled):
            with open(paths['rider_detail'], encoding='utf-8-sig', newline='') as stream:
                captured['teams'] = {row['团队名称'] for row in csv.DictReader(stream)}
            path = Path(raw) / 'generated.xlsx'; path.write_bytes(b'fixture')
            return path, {}
        @contextlib.contextmanager
        def factory(*_): yield self.runner
        with patch('binding_sources_http.BindingSources', return_value=sources), \
             patch('binding_download.generate_binding', side_effect=generate):
            files = service.execute_downloads(config, self.root / 'run', lambda *_: None,
                                              threading.Event(), lambda *_: None, factory)
        self.assertEqual(len(files), 1)
        self.assertEqual(captured['teams'], {'test(取分离)'})

    def test_monthly_only_downloads_two_whole_months(self):
        files, _, _ = self.execute(self.config(["rider_monthly"]))
        self.assertEqual([(f["start"], f["end"]) for f in files],
                         [("2026-09-01", "2026-09-30"), ("2026-10-01", "2026-10-31")])
        self.assertEqual(self.runner.calls, [("泉州", "monthly", "2026-09"), ("泉州", "monthly", "2026-10")])

    def test_new_options_and_monthly_account_future_day_rule(self):
        options = {value["id"]: value["label"] for value in service.get_options()["datasets"]}
        self.assertEqual(options["receive_account"], "骑手风神绑定")
        self.assertEqual(options["rider_detail"], "骑手数据明细")
        self.assertEqual(options["rider_info"], "骑手信息导出")
        self.assertEqual(options['payment_binding'], '骑手支付绑定（生成表）')
        self.assertEqual(options['abnormal_riders'], '异常骑手整理（生成表）')
        entry = next(value for value in service.get_options()["datasets"] if value["id"] == "abnormal_riders")
        self.assertEqual((entry["group"], entry["scope"]), ("lanorange", "all"))
        self.assertEqual(options['baize_employees'], '白泽员工资料（全量）')
        self.assertEqual(len(options), 28)
        monthly = self.config(["receive_account"], end="2026-10-31")
        self.assertEqual(monthly["months"], ["2026-09", "2026-10"])
        for datasets in (["receive_account", "rider_detail"], ["rider_detail"]):
            with self.assertRaises(service.ValidationError):
                self.config(datasets, end="2026-10-31")
        with self.assertRaises(service.ValidationError):
            self.config(["receive_account"], end="2026-11-01")

    def test_abnormal_riders_only_selection_uses_global_delivery_without_cities(self):
        value = service.validate_request({"datasets": ["abnormal_riders"]}, today=TODAY)
        self.assertEqual(value["cities"], ["全部城市"])
        self.assertTrue(value["lanorange_full_delivery"])
        self.assertEqual((value["start"], value["end"]), ("2026-10-16", "2026-10-16"))
        expanded = service.expand_followup_datasets(["abnormal_riders"])
        self.assertEqual(set(expanded) - {"abnormal_riders"},
                         {"lanorange_batch_quit", "lanorange_rider_quit", "lanorange_rider_report",
                          "lanorange_rider_leave", "lanorange_rider_archive"})

    def test_abnormal_riders_requested_items_are_global_and_retry_readds_sources(self):
        from lanorange_catalog import ALL_CITIES
        config = service.validate_request({"datasets": ["abnormal_riders"]}, today=TODAY)
        config = {**config, "datasets": service.expand_followup_datasets(config["datasets"])}
        items = service._requested_items(config)
        self.assertEqual([item["city"] for item in items], [ALL_CITIES] * 6)
        self.assertEqual({item["dataset"] for item in items},
                         {"abnormal_riders", "lanorange_batch_quit", "lanorange_rider_quit",
                          "lanorange_rider_report", "lanorange_rider_leave", "lanorange_rider_archive"})
        retry = [{key: item[key] for key in ("city", "dataset", "start", "end")}
                 for item in items if item["dataset"] == "abnormal_riders"]
        retried = service._requested_items({**config, "retry_items": retry})
        self.assertEqual({item["dataset"] for item in retried}, {item["dataset"] for item in items})

    def test_abnormal_riders_global_run_generates_workbook_without_fengshen_login(self):
        from openpyxl import Workbook, load_workbook
        archive_header = ['项目', '城市', '站点', '骑手ID', '姓名', '身份证号', '合作类型',
                          '当前生效兼职价格', '合作日期', '推荐人身份证号', '三方公司/推荐人',
                          '招聘来源', '状态', '是否寒暑假工']
        fixtures = {
            'lanorange_batch_quit': (['城市名称', '站点名称', '骑手ID', '骑手姓名', '身份证',
                                      '解除合作申请日', '解除合作类别', '状态'],
                                     [['保定', '保定一站', 'B001', '张三', '110101199001010011',
                                       '2026-06-05', '劝退优化', '已解除']]),
            'lanorange_rider_quit': (['城市名称', '站点', '风神骑手ID', '骑手姓名', '身份证',
                                      '离职申请日', '离职类型', '状态'],
                                     [['保定', '保定二站', 'B002', '李四', '110101199002020022',
                                       '2026-08-03', '正常离职', '已离职']]),
            'lanorange_rider_report': (['城市名称', '站点名称', '风神骑手ID', '骑手姓名', '身份证',
                                        '解除合作申请日', '解除合作类别', '状态'],
                                       [['保定', '保定三站', 'B003', '王五', '110101199003030033',
                                         '2026-09-09', '辞退', '已解除']]),
            'lanorange_rider_leave': (['城市', '站点', '风神骑手ID', '姓名', '身份证号',
                                       '请假结束时间', '类型', '审核状态'],
                                      [['保定', '保定一站', 'B001', '张三', '110101199001010011',
                                        '2026-09-18', '病假', '已通过']]),
            'lanorange_rider_archive': (archive_header,
                                        [['U+B', '保定', '保定一站', 'B001', '张三',
                                          '110101199001010011', '全职', 8.5, '2025-03-01', '', '',
                                          '骑手内推', '合作', '否']]),
        }
        source_dir = self.root / 'fixtures'
        source_dir.mkdir()
        for kind, (header, rows) in fixtures.items():
            book = Workbook()
            book.remove(book.active)
            sheet = book.create_sheet('骑手档案' if kind == 'lanorange_rider_archive' else '业务表')
            sheet.append(header)
            for row in rows:
                sheet.append(row)
            book.save(source_dir / (kind + '.xlsx'))
            book.close()

        def fake_collect_full(kind, directory, log, cancelled, resume=None):
            directory = Path(directory)
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / (kind + '.xlsx')
            shutil.copyfile(source_dir / (kind + '.xlsx'), target)
            (directory / 'source_receipt.json').write_text(
                json.dumps({'delivery_kind': 'platform_original'}), encoding='utf-8')
            return target

        def forbidden_factory(*args):
            raise AssertionError('纯蓝橙生成任务不应打开风神采集会话')

        config = service.validate_request({"datasets": ["abnormal_riders"]}, today=TODAY)
        config.update(owner="test", archive_created_at=PUBLISHED_AT)
        with patch('lanorange_full.collect_full', side_effect=fake_collect_full):
            files = service.execute_downloads(config, self.root / "run", lambda *_: None,
                                              threading.Event(), lambda *_: None,
                                              runner_factory=forbidden_factory)
        self.assertEqual({file["dataset"] for file in files}, set(fixtures) | {"abnormal_riders"})
        generated = next(file for file in files if file["dataset"] == "abnormal_riders")
        self.assertEqual(generated["name"], "全部城市异常骑手整理明细表1016.xlsx")
        book = load_workbook(self.root / "run" / generated["relative_path"], read_only=True)
        try:
            self.assertEqual(book.sheetnames, ["异常汇总", "蓝橙骑手档案", "汇总"])
        finally:
            book.close()

    def test_receive_account_only_publishes_all_covered_months(self):
        files, updates, _ = self.execute(self.config(["receive_account"]))
        self.assertEqual([(f["dataset"], f["start"], f["end"]) for f in files],
                         [("receive_account", "2026-09-01", "2026-09-30"),
                          ("receive_account", "2026-10-01", "2026-10-31")])
        self.assertTrue(all("骑手风神绑定" in f["name"] for f in files))
        self.assertTrue(all(call[1] == "receive_account" for call in self.runner.calls))
        self.assertEqual([u["phase"] for u in updates],
                         ["preparing", "validating", "publishing", "completed"] * 2)
        self.assertEqual([u["status"] for u in updates if u["phase"] == "completed"], ["success", "success"])

    def test_detail_only_keeps_exact_cross_month_period_and_no_order_limit(self):
        config = self.config(["rider_detail"], start="2025-09-20", end="2025-10-10")
        files, _, _ = self.execute(config)
        self.assertEqual(self.runner.calls, [("泉州", "rider_detail", "2025-09-20", "2025-10-10")])
        self.assertEqual([(f["start"], f["end"]) for f in files], [(config["start"], config["end"])])
        self.assertIn("骑手数据明细", files[0]["name"])

    def test_rider_information_only_exports_snapshot_without_month_splitting(self):
        config = self.config(["rider_info"], start="2024-01-01", end="2026-10-31")
        files, updates, _ = self.execute(config)
        self.assertEqual(self.runner.calls, [("泉州", "rider_info", "2024-01-01", "2026-10-31")])
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["name"], "泉州_骑手信息_快照.csv")
        self.assertEqual(updates[-1]["status"], "success")

    def test_rider_information_mix_keeps_independent_city_files_and_monthly_periods(self):
        config = self.config(["rider_info", "receive_account"])
        config["cities"] = ["泉州", "上海"]
        files, _, _ = self.execute(config)
        self.assertEqual(len(files), 6)
        self.assertEqual(sum(file["dataset"] == "rider_info" for file in files), 2)
        self.assertEqual({file["city"] for file in files}, {"泉州", "上海"})
        self.assertTrue(all(Path(file["relative_path"]).parent == Path(".") for file in files))
        self.assertFalse((self.root / "run" / "泉州").exists())
        self.assertFalse((self.root / "run" / "上海").exists())
        self.assertEqual(sum(file["dataset"] == "receive_account" for file in files), 4)

    def test_detail_recovery_only_uses_existing_task_runner(self):
        previous = "a" * 32
        expected_source = self.root / previous / "31029436" / "raw" / "rider_detail"
        def resume(plan, directory, source_dir):
            self.assertEqual(source_dir, expected_source)
            result = FakeRunner.rider_source(self.runner, plan, directory, "rider_detail")
            self.runner.calls[-1] = (plan.city, "resume", plan.start, plan.end)
            return result
        self.runner.resume_detail = resume
        self.runner.rider_source = lambda *args: self.fail("Recovery must not submit a new export")
        files, updates, logs = self.execute({**self.config(["rider_detail"]), "resume_detail_from": previous})
        self.assertEqual(self.runner.calls, [("泉州", "resume", "2026-09-20", "2026-10-10")])
        self.assertEqual([file["dataset"] for file in files], ["rider_detail"])
        self.assertEqual(updates[-1]["status"], "success")
        self.assertTrue(any("不重新提交导出" in line for line in logs))

    def test_detail_recovery_failure_has_no_new_export_fallback(self):
        def fail_resume(*args):
            raise RuntimeError("synthetic recovery failure")
        self.runner.resume_detail = fail_resume
        self.runner.rider_source = lambda *args: self.fail("Recovery must not submit a new export")
        files, updates, _ = self.execute({**self.config(["rider_detail"]), "resume_detail_from": "a" * 32})
        self.assertEqual(files, [])
        self.assertEqual(updates[-1]["status"], "error")
        self.assertEqual(self.runner.calls, [])

    def test_recovery_uses_server_source_in_another_archive_month_before_legacy_id(self):
        source = self.root / "历史归档" / "2026-09" / "旧任务" / "原始资料" / "泉州" / "rider_detail"
        source.mkdir(parents=True)
        evidence = source / "detail_submission.json"
        evidence.write_text('{"synthetic": true}', encoding="utf-8")
        def resume(plan, directory, source_dir):
            self.assertEqual(source_dir, source)
            self.assertEqual(directory, self.root / "run" / "原始资料" / "泉州" / "rider_detail")
            return FakeRunner.rider_source(self.runner, plan, directory, "rider_detail")
        self.runner.resume_detail = resume
        self.runner.rider_source = lambda *args: self.fail("Recovery must not submit a new export")
        files, updates, _ = self.execute({**self.config(["rider_detail"]), "resume_detail_from": "a" * 32,
                                          "resume_detail_source_dir": str(source)})
        self.assertEqual(len(files), 1)
        self.assertEqual(updates[-1]["status"], "success")
        self.assertEqual(evidence.read_text(encoding="utf-8"), '{"synthetic": true}')
        manifest = json.loads((self.root / "run" / "manifest.json").read_text(encoding="utf-8"))
        self.assertNotIn("resume_detail_source_dir", manifest["config"])
        self.assertNotIn("owner", manifest["config"])
        self.assertNotIn(str(source), json.dumps(manifest, ensure_ascii=False))

    def test_server_recovery_source_rejects_invalid_type_relative_path_and_scope(self):
        for changes in ({"resume_detail_source_dir": "../outside"}, {"resume_detail_source_dir": 123},
                        {"cities": ["泉州", "上海"]}, {"datasets": ["rider_detail", "receive_account"]}):
            with self.subTest(changes=changes), self.assertRaises(service.BillCollectionError):
                self.execute({**self.config(["rider_detail"]),
                              "resume_detail_source_dir": str(self.root / "old"), **changes})
        self.assertEqual(self.runner.calls, [])

    def test_missing_server_source_never_falls_back_to_new_export_or_legacy_path(self):
        self.runner.resume_detail = lambda *args: self.fail("Missing source must not be read")
        self.runner.rider_source = lambda *args: self.fail("Missing recovery source must not submit a new export")
        files, updates, _ = self.execute({**self.config(["rider_detail"]), "resume_detail_from": "a" * 32,
                                          "resume_detail_source_dir": str(self.root / "missing")})
        self.assertEqual(files, [])
        self.assertEqual(updates[-1]["status"], "error")
        self.assertEqual(self.runner.calls, [])

    def test_recovery_source_inside_current_run_is_rejected_without_submission(self):
        self.runner.resume_detail = lambda *args: self.fail("A run must not resume itself")
        self.runner.rider_source = lambda *args: self.fail("Recovery must not submit a new export")
        files, updates, _ = self.execute({**self.config(["rider_detail"]),
                                          "resume_detail_source_dir": str(self.root / "run")})
        self.assertEqual(files, [])
        self.assertEqual(updates[-1]["status"], "error")

    def test_user_request_cannot_supply_private_recovery_source_or_archive_time(self):
        config = self.config(["rider_detail"], resume_detail_source_dir=str(self.root),
                             archive_created_at="2020-01-01T00:00:00+08:00")
        self.assertNotIn("resume_detail_source_dir", config)
        self.assertNotIn("archive_created_at", config)

    def test_detail_recovery_rejects_changed_scope_and_invalid_source_ids(self):
        for changes in ({"resume_detail_from": "../outside"}, {"resume_detail_from": 123},
                        {"cities": ["泉州", "上海"]}, {"datasets": ["rider_detail", "receive_account"]}):
            with self.subTest(changes=changes), self.assertRaises(service.BillCollectionError):
                self.execute({**self.config(["rider_detail"]), "resume_detail_from": "a" * 32, **changes})
        self.assertEqual(self.runner.calls, [])

    def test_new_sources_mix_with_ub_for_multiple_cities(self):
        config = self.config(["rider_monthly", "receive_account", "rider_detail"])
        config["cities"] = ["泉州", "上海"]
        files, _, _ = self.execute(config)
        self.assertEqual(len(files), 10)
        self.assertEqual({f["dataset"] for f in files}, {"rider_monthly", "receive_account", "rider_detail"})
        self.assertEqual({f["city"] for f in files}, {"泉州", "上海"})
        self.assertTrue(all(f["start"] == config["start"] and f["end"] == config["end"]
                            for f in files if f["dataset"] == "rider_detail"))
        manifest = json.loads((self.root / "run" / "manifest.json").read_text(encoding="utf-8"))
        self.assertFalse(manifest["payroll_executed"])

    def test_new_source_failure_does_not_publish_or_stop_other_sources(self):
        self.runner.fail.add(("泉州", "receive_account"))
        files, updates, logs = self.execute(self.config(["receive_account", "rider_detail"]))
        self.assertEqual([f["dataset"] for f in files], ["rider_detail"])
        self.assertEqual(sum(u["status"] == "error" for u in updates), 2)
        self.assertNotIn("synthetic-private", json.dumps(logs + updates))

    def test_new_source_wrong_city_period_hash_or_scope_never_publishes(self):
        original = self.runner.rider_source
        for index, changes in enumerate(({"agency_id": "other"}, {"start": "2020-01-01"},
                                         {"sha256": "wrong"}, {"scope": "all_available_teams"})):
            with self.subTest(changes=changes):
                self.root = self.root / str(index)
                self.root.mkdir()
                self.runner.rider_source = lambda *args, **kwargs: {**original(*args, **kwargs), **changes}
                files, updates, _ = self.execute(self.config(["rider_detail"]))
                self.assertEqual(files, [])
                self.assertEqual(updates[-1]["status"], "error")
                self.assertEqual([p for p in (self.root / "run").iterdir() if p.suffix in (".csv", ".xlsx")], [])

    def test_second_account_month_cancel_retains_first_month_only(self):
        cancelled, updates = threading.Event(), []
        original = self.runner.rider_source
        def cancel_second_month(plan, directory, kind):
            info = original(plan, directory, kind)
            if kind == "receive_account" and plan.month == "2026-10":
                cancelled.set()
            return info
        self.runner.rider_source = cancel_second_month
        files = service.execute_downloads({**self.config(["receive_account", "rider_detail"]), "owner": "test"},
            self.root / "run", lambda _: None, cancelled, updates.append,
            runner_factory=lambda *args: contextlib.nullcontext(self.runner))
        self.assertEqual([(f["dataset"], f["start"]) for f in files], [("receive_account", "2026-09-01")])
        published = [p for p in (self.root / "run").iterdir() if p.suffix in (".csv", ".xlsx")]
        self.assertEqual([p.name for p in published], [files[0]["name"]])
        self.assertEqual(updates[-1]["status"], "cancelled")
        self.assertFalse(any(call[1] == "rider_detail" for call in self.runner.calls))

    def test_fraud_and_problem_single_selection_keep_only_selected_outputs(self):
        for kind in ("fraud", "problem"):
            with self.subTest(kind=kind):
                self.root = self.root / kind
                self.root.mkdir()
                self.runner.calls.clear()
                files, _, _ = self.execute(self.config([kind]))
                self.assertEqual([f["dataset"] for f in files], [kind])
                self.assertEqual(len(self.runner.calls), 1)
                self.assertEqual(self.runner.calls[0][1], "orders")

    def test_multiple_cities_and_tasks_share_period_and_keep_failure_separate(self):
        config = self.config(["delivery_fee", "penalty", "rider_monthly"])
        config["cities"] = ["泉州", "上海"]
        self.runner.fail.add(("泉州", "daily"))
        files, updates, logs = self.execute(config)
        self.assertEqual(len(files), 6)
        errors = [value for value in updates if value["status"] == "error"]
        self.assertEqual({v["dataset"] for v in errors}, {"delivery_fee", "penalty"})
        self.assertNotIn("synthetic-private", json.dumps(logs + errors))
        self.assertTrue(all(f["start"] == "2026-09-20" and f["end"] == "2026-10-10"
                            for f in files if f["dataset"] != "rider_monthly"))
        manifest = json.loads((self.root / "run" / "manifest.json").read_text(encoding="utf-8"))
        self.assertFalse(manifest["payroll_executed"])

    def test_all_eight_datasets_keep_city_deliverables_separate_from_raw_and_intermediates(self):
        # 生成表（骑手支付绑定/异常骑手跟进/异常骑手整理）自动关联的来源需要真实
        # 外部会话，不纳入本用例；它们的发布与重试在各自专项用例中校验。
        generated = ('payment_binding', 'abnormal_followup', 'abnormal_riders')
        original_datasets = [kind for kind in service.DATASETS
                             if kind not in generated and kind not in service.LANORANGE_DATASETS
                             and kind not in (service.BAIZE_DATASET, service.RIDER_DAILY_DATASET)
                             and kind not in service.DETAIL_DATASETS
                             and kind != service.RIDER_ARCHIVE_DATASET
                             and kind not in service.MERCHANT_DATASETS]
        files, updates, _ = self.execute(self.config(original_datasets))
        self.assertEqual(len(files), 11)  # Both monthly sources cover two months.
        self.assertEqual({file["dataset"] for file in files}, set(original_datasets))
        run, output = self.root / "run", self.root / "run"
        for file in files:
            self.assertEqual(Path(file["relative_path"]).parts, (file["name"],))
            path = run / file["relative_path"]
            self.assertEqual(path.stat().st_size, file["bytes"])
            self.assertEqual(service._hash(path), file["sha256"])
            self.assertNotIn("_下载", file["name"])
        raw = run / "原始资料" / "泉州"
        self.assertTrue((raw / "agency_daily" / "bill.zip").is_file())
        self.assertTrue((raw / "issue_orders").is_dir())
        self.assertTrue((raw / "order_processed").is_dir())
        self.assertFalse((output / "order_processed").exists())
        self.assertFalse((run / "31029436").exists())
        self.assertEqual(len([p for p in output.iterdir() if p.suffix in (".csv", ".xlsx")]), len(files))
        monthly = next(file for file in files if file["dataset"] == "rider_monthly" and file["start"] == "2026-09-01")
        # 骑手月度账单发布前会做取分离站点过滤（重写副本），成品不再与原始字节一致；
        # 完整性由上方的 bytes/sha256 断言保证，此处核对原始资料留存。
        self.assertTrue((raw / "rider_monthly" / "2026-09" / "monthly.xlsx").is_file())
        self.assertEqual(updates[-1]["status"], "success")

    def test_filenames_use_effective_business_period_without_publish_stamp(self):
        files, _, _ = self.execute({**self.config(["delivery_fee", "rider_monthly", "rider_info"]),
                                    "archive_created_at": "2026-09-30T23:59:00+08:00"})
        names = {file["dataset"]: file["name"] for file in files}
        self.assertEqual(names["delivery_fee"], "泉州_配送费_2026-09-20至2026-10-10.csv")
        self.assertEqual(names["rider_monthly"], "泉州10月风神骑手月度UB账单0930.xlsx")
        self.assertEqual(names["rider_info"], "泉州_骑手信息_快照.csv")
        self.assertTrue(all("下载" not in file["name"] and "20260930-235900" not in file["name"]
                            for file in files))

    def test_existing_archive_file_is_preserved_and_current_pair_rolls_back(self):
        original = self.runner.daily
        target = self.root / "run" / "泉州_违规扣款_2026-09-20至2026-10-10.csv"
        def daily(plan, directory, selected):
            manifest = original(plan, directory, selected)
            target.write_bytes(b"preexisting-archive-must-not-change")
            return manifest
        self.runner.daily = daily
        files, updates, _ = self.execute(self.config(["delivery_fee", "penalty"]))
        self.assertEqual(files, [])
        self.assertEqual(target.read_bytes(), b"preexisting-archive-must-not-change")
        self.assertEqual([p for p in target.parent.iterdir() if p.suffix in (".csv", ".xlsx")], [target])
        self.assertEqual(sum(update["status"] == "error" for update in updates), 2)

    def test_pair_checkpoint_precedes_success_and_each_item_carries_only_its_file(self):
        updates = []
        def changed(value):
            updates.append(value)
            if value["status"] != "success":
                return
            checkpoint = json.loads((self.root / "run" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual({item["dataset"] for item in checkpoint["items"] if item["status"] == "success"},
                             {"delivery_fee", "penalty"})
            self.assertEqual(len(checkpoint["files"]), 2)
            self.assertEqual(len(value["files"]), 1)
            self.assertEqual(value["files"][0]["dataset"], value["dataset"])
            path = self.root / "run" / value["files"][0]["relative_path"]
            self.assertEqual(service._hash(path), value["files"][0]["sha256"])
        files = service.execute_downloads({**self.config(["delivery_fee", "penalty"]), "owner": "test"},
            self.root / "run", lambda _: None, threading.Event(), changed,
            runner_factory=lambda *args: contextlib.nullcontext(self.runner))
        self.assertEqual(len(files), 2)
        self.assertEqual(sum(value["status"] == "success" for value in updates), 2)

    def test_failed_manifest_commit_publishes_no_success_or_files(self):
        original = service.atomic_json
        def checkpoint(path, payload):
            if payload["files"]:
                raise OSError("synthetic checkpoint failure")
            return original(path, payload)
        with patch.object(service, "atomic_json", side_effect=checkpoint):
            files, updates, _ = self.execute(self.config(["delivery_fee"]))
        self.assertEqual(files, [])
        self.assertFalse(any(value["status"] == "success" for value in updates))
        self.assertEqual([p for p in (self.root / "run").iterdir() if p.suffix in (".csv", ".xlsx")], [])
        checkpoint = json.loads((self.root / "run" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["files"], [])

    def test_success_callback_failure_preserves_durable_checkpoint_and_files(self):
        logs = []
        def changed(value):
            if value["status"] == "success":
                raise RuntimeError("synthetic manager persistence failure")
        files = service.execute_downloads({**self.config(["delivery_fee", "rider_info"]), "owner": "test"},
            self.root / "run", logs.append, threading.Event(), changed,
            runner_factory=lambda *args: contextlib.nullcontext(self.runner))
        self.assertEqual(len(files), 2)
        self.assertTrue(any("状态回写未完成" in message and "RuntimeError" in message for message in logs))
        checkpoint = json.loads((self.root / "run" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual([item["status"] for item in checkpoint["items"]], ["success", "success"])
        self.assertEqual(len(checkpoint["files"]), 2)
        for info in checkpoint["files"]:
            self.assertTrue((self.root / "run" / info["relative_path"]).is_file())
        self.assertEqual(len(self.runner.calls), 2)

    def test_partial_success_callback_failure_keeps_group_in_later_manifest(self):
        def changed(value):
            if value["status"] == "success":
                raise RuntimeError("synthetic callback failure")
        files = service.execute_downloads({**self.config(["delivery_fee", "penalty", "rider_info"]), "owner": "test"},
            self.root / "run", lambda _: None, threading.Event(), changed,
            runner_factory=lambda *args: contextlib.nullcontext(self.runner))
        self.assertEqual(len(files), 3)
        checkpoint = json.loads((self.root / "run" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual({item["dataset"] for item in checkpoint["items"] if item["status"] == "success"},
                         {"delivery_fee", "penalty", "rider_info"})
        self.assertEqual(len(checkpoint["files"]), 3)

    def test_corrupted_archive_copy_is_never_offered_as_valid(self):
        copy = shutil.copy2
        def corrupt(source, target):
            copy(source, target)
            Path(target).write_bytes(b"synthetic corrupt archive")
        with patch.object(service.shutil, "copy2", side_effect=corrupt):
            files, updates, _ = self.execute(self.config(["delivery_fee"]))
        self.assertEqual(files, [])
        self.assertFalse(any(value["status"] == "success" for value in updates))
        self.assertEqual([p for p in (self.root / "run").iterdir() if p.suffix in (".csv", ".xlsx")], [])

    def test_retry_executes_only_exact_city_dataset_and_failed_month(self):
        config = self.config(["delivery_fee", "penalty", "receive_account"])
        config["cities"] = ["泉州", "上海"]
        config["retry_items"] = [
            {"city": "泉州", "dataset": "receive_account", "start": "2026-10-01", "end": "2026-10-31"},
            {"city": "上海", "dataset": "delivery_fee", "start": config["start"], "end": config["end"]}]
        files, updates, _ = self.execute(config)
        self.assertEqual(self.runner.calls, [("泉州", "receive_account", "2026-10-01", "2026-10-31"),
                                             ("上海", "daily", {"delivery_fee"})])
        self.assertEqual({service._item_key(file) for file in files}, {service._item_key(value) for value in config["retry_items"]})
        self.assertFalse((self.root / "run" / "原始资料" / "泉州" / "receive_account" / "2026-09").exists())
        self.assertEqual(sum(value["status"] == "success" for value in updates), 2)

    def test_invalid_retry_items_stop_before_runner_is_opened(self):
        config = self.config(["delivery_fee"])
        key = {"city": "泉州", "dataset": "delivery_fee", "start": config["start"], "end": config["end"]}
        factory = Mock()
        for selection in ([key, key], [{**key, "city": "上海"}], [{**key, "end": "2026-10-09"}],
                          [{**key, "status": "error"}], ["invalid"]):
            with self.subTest(selection=selection), self.assertRaises(BillCollectionError):
                service.execute_downloads({**config, "retry_items": selection}, self.root / "run", lambda _: None,
                                          threading.Event(), lambda _: None, runner_factory=factory)
        factory.assert_not_called()

    def test_multi_city_detail_resume_can_mix_with_unsubmitted_other_items(self):
        config = self.config(["delivery_fee", "rider_detail"])
        config["cities"] = ["泉州", "上海"]
        config["retry_items"] = [
            {"city": city, "dataset": kind, "start": config["start"], "end": config["end"]}
            for city, kind in (("泉州", "rider_detail"), ("上海", "delivery_fee"), ("上海", "rider_detail"))]
        sources = {city: self.root / "old" / city / "rider_detail" for city in config["cities"]}
        for source in sources.values():
            source.mkdir(parents=True)
        config["resume_detail_sources"] = {city: str(source) for city, source in sources.items()}
        def resume(plan, directory, source):
            self.assertEqual(source, sources[plan.city])
            result = FakeRunner.rider_source(self.runner, plan, directory, "rider_detail")
            self.runner.calls[-1] = (plan.city, "resume", plan.start, plan.end)
            return result
        self.runner.resume_detail = resume
        self.runner.rider_source = lambda *args: self.fail("Selected recovery cities must never submit")
        files, _, _ = self.execute(config)
        self.assertEqual(len(files), 3)
        self.assertEqual([call[1] for call in self.runner.calls], ["resume", "daily", "resume"])
        checkpoint = (self.root / "run" / "manifest.json").read_text(encoding="utf-8")
        self.assertNotIn("resume_detail_sources", checkpoint)
        self.assertNotIn(str(self.root / "old"), checkpoint)

    def test_pre_item_waits_use_task_events_and_manual_wait_keeps_old_status_enum(self):
        @contextlib.contextmanager
        def runner(config, log, cancelled, notify):
            for state in ("waiting_collection", "waiting_login", "manual_required", "ready"):
                notify({"state": state})
            original = self.runner.rider_source
            def source(*args):
                log("[等待验证] synthetic manual verification")
                return original(*args)
            self.runner.rider_source = source
            yield self.runner
        updates = []
        service.execute_downloads({**self.config(["rider_info"]), "owner": "test"}, self.root / "run",
            lambda _: None, threading.Event(), updates.append, runner_factory=runner)
        self.assertEqual([value["phase"] for value in updates[:4]],
                         ["waiting_collection", "waiting_login", "waiting_manual", "preparing"])
        self.assertTrue(all(value.get("_run_event") and "city" not in value for value in updates[:4]))
        self.assertTrue(any(value.get("city") == "泉州" and value["phase"] == "waiting_manual"
                            and value["status"] == "waiting_login" for value in updates))
        self.assertEqual(updates[-1]["phase"], "completed")

    def test_waiting_export_log_never_proves_submission(self):
        @contextlib.contextmanager
        def runner(config, log, cancelled, notify):
            def source(*args):
                log("[导出] 等待原文件")
                raise RuntimeError("synthetic unknown platform state")
            self.runner.rider_source = source
            yield self.runner
        updates = []
        files = service.execute_downloads({**self.config(["rider_info"]), "owner": "test"}, self.root / "run",
            lambda _: None, threading.Event(), updates.append, runner_factory=runner)
        self.assertEqual(files, [])
        self.assertEqual((updates[-1]["failure_phase"], updates[-1]["submission_state"]), ("waiting_export", "unknown"))

    def test_browser_preparation_failure_marks_only_requested_items_not_submitted(self):
        @contextlib.contextmanager
        def runner(config, log, cancelled, notify):
            notify({"state": "waiting_collection"})
            raise service.CollectionFailure("synthetic browser unavailable", {"phase": "browser_launch"})
            yield  # pragma: no cover
        config = self.config(["receive_account"])
        config["retry_items"] = [{"city": "泉州", "dataset": "receive_account", "start": "2026-10-01", "end": "2026-10-31"}]
        updates = []
        with self.assertRaises(service.CollectionFailure):
            service.execute_downloads({**config, "owner": "test"}, self.root / "run", lambda _: None,
                threading.Event(), updates.append, runner_factory=runner)
        errors = [value for value in updates if value["status"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["start"], "2026-10-01")
        self.assertEqual(errors[0]["submission_state"], "not_submitted")

    def test_invalid_profile_is_known_unsubmitted_without_browser_operations(self):
        page, auth = Mock(), Mock()
        runner = service.BrowserRunner(page, auth, Mock(), threading.Event())
        plan = SimpleNamespace(agency_id="31029436", start="2026-10-01", end="2026-10-15", month="2026-10")
        calls = ((runner.daily, (plan, self.root, {"delivery_fee"})),
                 (runner.monthly, (plan, self.root)),
                 (runner.orders, (plan, self.root, {"fraud"})))
        with patch.object(service, "_load_profile", side_effect=BillCollectionError("页面配置不可用")):
            for method, args in calls:
                with self.subTest(method=method.__name__), self.assertRaises(service.CollectionFailure) as raised:
                    method(*args)
                self.assertEqual(raised.exception.diagnostics["submission_state"], "not_submitted")
                self.assertEqual(raised.exception.diagnostics["failure_phase"], "preparing")
        self.assertEqual(page.mock_calls, [])
        self.assertEqual(auth.mock_calls, [])

    def test_bad_download_hash_is_rejected(self):
        plan = SimpleNamespace(agency_id="31029436", start="2026-09-20", end="2026-10-10")
        directory = self.root / "raw"
        manifest = self.runner.daily(SimpleNamespace(**vars(plan), city="泉州"), directory, {"delivery_fee"})
        manifest["files"][0]["sha256"] = "wrong"
        with self.assertRaises(BillCollectionError):
            service._download_file(manifest, directory, "agency_daily", plan)

    def test_later_validation_failure_publishes_no_part_of_daily_pair(self):
        validate = service.validate_daily
        def checked(path, plan):
            if "违规扣款" in str(path):
                raise RuntimeError("bad file")
            return validate(path, plan)
        with patch.object(service, "validate_daily", side_effect=checked):
            files, updates, _ = self.execute(self.config(["delivery_fee", "penalty"]))
        self.assertEqual(files, [])
        self.assertEqual(len([v for v in updates if v["status"] == "error"]), 2)
        self.assertEqual([p for p in (self.root / "run").iterdir() if p.suffix in (".csv", ".xlsx")], [])

    def test_copy_failure_cleans_current_step_outputs(self):
        original = shutil.copy2
        copies = []
        def copy(source, target):
            copies.append(target)
            if len(copies) == 2:
                raise OSError("disk full")
            return original(source, target)
        with patch.object(service.shutil, "copy2", side_effect=copy):
            files, _, _ = self.execute(self.config(["delivery_fee", "penalty"]))
        self.assertEqual(files, [])
        self.assertEqual([p for p in (self.root / "run").iterdir() if p.suffix in (".csv", ".xlsx")], [])

    def test_cancel_preserves_previously_validated_files(self):
        cancelled = threading.Event()
        original = self.runner.monthly
        def monthly(plan, directory):
            manifest = original(plan, directory)
            cancelled.set()
            return manifest
        self.runner.monthly = monthly
        updates = []
        files = service.execute_downloads({**self.config(["delivery_fee", "rider_monthly"]), "owner": "test"},
            self.root / "run", lambda _: None, cancelled, updates.append,
            runner_factory=lambda *args: contextlib.nullcontext(self.runner))
        self.assertEqual([file["dataset"] for file in files], ["delivery_fee"])
        self.assertTrue(any(v["status"] == "cancelled" for v in updates))


from fengshen_bill import BillCollectionError

if __name__ == "__main__":
    unittest.main()
