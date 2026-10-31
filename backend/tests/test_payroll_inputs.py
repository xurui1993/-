import asyncio
import csv
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from starlette.requests import Request
from openpyxl import Workbook, load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import payroll_inputs as inputs
from test_parttime_source import template, rider_file
from test_manual_payroll import THEME


class ASGIClient:
    """Exercise the real router without adding an HTTP-client dependency."""
    def __init__(self, app, base_url='http://localhost'):
        self.app, self.headers = app, {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def post(self, path, json):
        body = __import__('json').dumps(json).encode()
        headers = {'host': 'localhost', 'content-type': 'application/json', **self.headers}
        scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                 'method': 'POST', 'scheme': 'http', 'path': path, 'raw_path': path.encode(),
                 'query_string': b'', 'root_path': '', 'server': ('localhost', 80),
                 'client': ('127.0.0.1', 1), 'headers': [(k.encode(), v.encode()) for k,v in headers.items()]}
        messages = []
        async def receive():
            return {'type': 'http.request', 'body': body, 'more_body': False}
        async def send(value):
            messages.append(value)
        asyncio.run(self.app(scope, receive, send))
        code = next(value['status'] for value in messages if value['type'] == 'http.response.start')
        text = b''.join(value.get('body', b'') for value in messages if value['type'] == 'http.response.body').decode()
        return SimpleNamespace(status_code=code, text=text, json=lambda: __import__('json').loads(text))


class FakeManager:
    def __init__(self, run, paths):
        self.run, self.paths, self.created, self.retries = run, paths, [], []

    def create(self, owner, config, request_id):
        self.created.append((owner, config, request_id))
        return self.run

    def get_run(self, owner, key):
        return self.run

    def get_file(self, owner, run, key):
        return self.paths[key], self.paths[key].name

    def retry(self, owner, key, items, request_id):
        self.retries.append(items)
        return {'id': 'b' * 32}


class PayrollInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'uploads' / 'tester' / 'upload_fixture'
        self.source.mkdir(parents=True)
        template(self.source / 'template.xlsx')
        self.patch = patch.object(inputs, 'ROOT', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def delivery(self, folder=None, name='配送费.csv', rows=True):
        path = (folder or self.source) / name
        with path.open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(['账单时间', '团队ID', '团队名称', '骑手ID', '骑手名称', '详情', '订单号',
                             '运单号', '业务交易时间', '订单来源', '标品', '门店ID', '门店名称', '订单标签'])
            if rows:
                writer.writerow(['2026-08-20', '100', '测试站', '00123', '测试骑手', '完成单', 'o1',
                                 'w1', '2026-08-20', 'test', '', '', '', ''])
        return path

    def auto(self):
        return inputs.create(str(self.source), 'tester', 'fengshen', 'download_shared')

    def failed(self, folder, state, kind='problem'):
        for key in state['items']:
            if key == kind:
                state['items'][key].update(status='failed', run_id='a' * 32)
            elif key == 'delivery_fee':
                inputs.stage(folder, state, key, self.delivery(), 'fixture')
            else:
                state['items'][key]['status'] = 'omitted'
        state['jobs'] = ['a' * 32]
        inputs.readiness(state)
        inputs.save(folder, state)

    def client(self):
        app = FastAPI()
        app.include_router(inputs.router)
        client = ASGIClient(app, base_url='http://localhost')
        client.headers.update({'origin': 'http://localhost', 'x-workspace-id': 'tester'})
        return client

    def test_manual_requires_delivery_and_keeps_only_current_inputs(self):
        with self.assertRaisesRegex(inputs.SourceError, '配送费'):
            inputs.create(str(self.source), 'tester', 'manual')
        fee = self.delivery()
        folder, state = inputs.create(str(self.source), 'tester', 'manual')
        self.assertEqual(state['status'], 'ready')
        self.assertEqual(state['items']['payment_binding']['status'], 'omitted')
        self.assertEqual(state['items']['lanorange_part_price']['status'], 'omitted')
        self.assertEqual(len(list((folder / 'input').iterdir())), 2)
        self.assertEqual(inputs.digest(fee), state['items']['delivery_fee']['files'][0]['sha256'])
        inputs.checked_inputs(folder, state)

    def test_manual_multiple_files_and_identical_duplicates(self):
        first = self.delivery(name='配送费_1.csv')
        second = self.delivery(name='配送费_2.csv', rows=False)
        _, state = inputs.create(str(self.source), 'tester', 'manual')
        self.assertEqual(len(state['items']['delivery_fee']['files']), 2)
        second.write_bytes(first.read_bytes())
        with self.assertRaisesRegex(inputs.SourceError, '重复文件'):
            inputs.create(str(self.source), 'tester', 'manual')

    def test_optional_failure_blocks_and_delivery_cannot_be_omitted(self):
        folder, state = self.auto()
        self.failed(folder, state)
        with self.assertRaisesRegex(inputs.SourceError, '暂停'):
            inputs.checked_inputs(folder, state)
        with self.client() as client:
            response = client.post(f'/api/parttime/preparations/{state["id"]}/resolve',
                                   json={'dataset': 'problem', 'action': 'omit'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['status'], 'ready')
            _, changed = inputs.load('tester', state['id'], 'download_shared')
            self.assertEqual(changed['audit'][-1]['action'], 'explicit_omit')
        self.failed(folder, state, kind='delivery_fee')
        with self.client() as client:
            response = client.post(f'/api/parttime/preparations/{state["id"]}/resolve',
                                   json={'dataset': 'delivery_fee', 'action': 'omit'})
            self.assertEqual(response.status_code, 400)

    def test_supplement_validates_type_and_workspace_and_restores_readiness(self):
        folder, state = self.auto()
        self.failed(folder, state, kind='delivery_fee')
        other = self.root / 'uploads' / 'other' / 'upload_extra'
        other.mkdir(parents=True)
        self.delivery(other)
        good = self.root / 'uploads' / 'tester' / 'upload_extra'
        good.mkdir()
        self.delivery(good)
        with self.client() as client:
            url = f'/api/parttime/preparations/{state["id"]}/supplement'
            self.assertEqual(client.post(url, json={'dataset': 'delivery_fee', 'path': str(other)}).status_code, 400)
            response = client.post(url, json={'dataset': 'delivery_fee', 'path': str(good)})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['status'], 'ready')
        (good / '配送费.csv').write_text('invalid', encoding='utf-8')
        with self.assertRaisesRegex(inputs.SourceError, '表头'):
            inputs.validate_upload(good / '配送费.csv', 'delivery_fee')

    def test_snapshot_hash_and_owner_isolation(self):
        folder, state = self.auto()
        self.failed(folder, state)
        with self.assertRaises(inputs.SourceError):
            inputs.load('tester', state['id'], 'another_owner')
        with self.assertRaises(inputs.SourceError):
            inputs.load('other', state['id'], 'download_shared')
        state['items']['problem']['status'] = 'omitted'
        inputs.readiness(state)
        path = inputs.checked_inputs(folder, state) / state['items']['delivery_fee']['file']
        path.write_text('changed', encoding='utf-8')
        with self.assertRaisesRegex(inputs.SourceError, '修改'):
            inputs.checked_inputs(folder, state)

    def test_auto_uses_fresh_city_download_without_automatic_binding(self):
        folder, state = self.auto()
        manager = FakeManager({'id': 'a' * 32}, {})
        inputs.start_download(folder, state, manager)
        config = manager.created[0][1]
        self.assertEqual(config['cities'], ['泉州'])
        self.assertTrue(config['refresh_history'])
        self.assertTrue(config['lanorange_by_city'])
        self.assertNotIn('payment_binding', config['datasets'])
        self.assertNotIn('baize_employees', config['datasets'])
        self.assertEqual(state['items']['payment_binding']['status'], 'failed')
        self.assertIn('lanorange_part_price', config['datasets'])
        self.assertNotIn('lanorange_full_delivery', config)

    def test_successful_empty_file_is_ready_and_monthly_uses_whole_month(self):
        folder, state = self.auto()
        state['jobs'] = ['a' * 32]
        fee = self.delivery(rows=False)
        monthly = self.source / 'monthly.xlsx'
        rider_file(monthly)
        kinds = ['delivery_fee', 'rider_monthly']
        run = {'items': [{'dataset': kind, 'status': 'success'} for kind in kinds],
               'files': [{'dataset': kind, 'id': kind} for kind in kinds]}
        manager = FakeManager(run, {'delivery_fee': fee, 'rider_monthly': monthly})
        inputs.collect_finished(folder, state, manager)
        self.assertEqual(state['items']['delivery_fee']['status'], 'ready')
        self.assertEqual(state['items']['rider_monthly']['status'], 'ready')
        self.assertIn('2026-08', state['items']['rider_monthly']['file'])
        self.assertEqual(state['status'], 'waiting_materials')

    def test_monthly_validation_failure_preserves_specific_reason(self):
        folder, state = self.auto()
        state['jobs'] = ['a' * 32]
        monthly = self.source / 'bad.xlsx'
        rider_file(monthly)
        run = {'items': [{'dataset': 'rider_monthly', 'status': 'success'}],
               'files': [{'dataset': 'rider_monthly', 'id': 'monthly'}]}
        manager = FakeManager(run, {'monthly': monthly})
        with patch.object(inputs, 'clean_rider_bill', side_effect=inputs.SourceError('账单月份不一致')):
            inputs.collect_finished(folder, state, manager)
        self.assertIn('账单月份不一致', state['items']['rider_monthly']['error'])
        self.assertEqual(state['items']['rider_monthly']['status'], 'failed')

    def test_retry_selects_only_failed_item(self):
        folder, state = self.auto()
        self.failed(folder, state)
        item = {'city': '泉州', 'dataset': 'problem', 'start': '2026-08-16', 'end': '2026-08-31', 'status': 'error'}
        manager = FakeManager({'id': 'a' * 32, 'items': [item, {**item, 'dataset': 'delivery_fee', 'status': 'success'}]}, {})
        with patch('download_jobs.get_manager', return_value=manager), self.client() as client:
            response = client.post(f'/api/parttime/preparations/{state["id"]}/resolve',
                                   json={'dataset': 'problem', 'action': 'retry'})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(manager.retries[0]), 1)
        self.assertEqual(manager.retries[0][0]['dataset'], 'problem')
        self.assertEqual(response.json()['status'], 'preparing')

    def test_seven_downloaded_sources_form_one_verified_snapshot(self):
        folder, state = self.auto()
        state['jobs'] = ['a' * 32]
        paths = {}
        for kind in inputs.LABELS:
            if kind == 'rider_monthly':
                path = self.source / 'UB.xlsx'
                rider_file(path)
            else:
                path = self.delivery(name=kind + '.csv', rows=False)
            paths[kind] = path
        manager = FakeManager({'items': [{'dataset': key, 'status': 'success'} for key in paths],
                               'files': [{'dataset': key, 'id': key} for key in paths]}, paths)
        inputs.collect_finished(folder, state, manager)
        self.assertEqual(state['status'], 'ready')
        self.assertEqual(len(list(inputs.checked_inputs(folder, state).iterdir())), 8)
        self.assertTrue(all(value['origin']['run_id'] == 'a' * 32 for value in state['items'].values()))

    def test_changed_download_artifact_is_failed_not_treated_as_empty(self):
        from download_jobs import DownloadNotFound
        folder, state = self.auto()
        state['jobs'] = ['a' * 32]
        manager = FakeManager({'items': [{'dataset': 'delivery_fee', 'status': 'success'}],
                               'files': [{'dataset': 'delivery_fee', 'id': 'fee'}]}, {})
        manager.get_file = lambda *args: (_ for _ in ()).throw(DownloadNotFound('文件已变更'))
        inputs.collect_finished(folder, state, manager)
        self.assertEqual(state['items']['delivery_fee']['status'], 'failed')
        self.assertEqual(state['status'], 'waiting_materials')

    def test_manual_and_resumed_auto_use_same_engine_flags_and_pause_before_calc(self):
        folder, state = self.auto()
        self.failed(folder, state)
        config = SimpleNamespace(payrollSourceMode='fengshen', payrollPreparationId=state['id'],
            sourcePath=str(self.source), basePath='', theme=THEME, enableInterceptor=False,
            enableCrossStationMerge=False, deductionRules=[])
        request = Request({'type': 'http', 'method': 'POST', 'scheme': 'http', 'path': '/api/run',
            'headers': [(b'host', b'localhost'), (b'origin', b'http://localhost'),
                        (b'content-type', b'application/json'), (b'x-workspace-id', b'tester')],
            'client': ('127.0.0.1', 1), 'server': ('localhost', 80), 'query_string': b''})
        calls = []
        async def calculate(*args, **kwargs):
            calls.append((args, kwargs))
            yield 'data: ' + json.dumps({'type': 'finish', 'status': 'success', 'out_file': ''}) + '\n\n'
        async def run():
            return [event async for event in inputs.run_payroll(config, request)]
        with patch('tasks.run_main_calculation_gen', calculate):
            events = asyncio.run(run())
            self.assertTrue(any('paused' in event for event in events))
            self.assertFalse(calls)
            state['items']['problem']['status'] = 'omitted'
            inputs.readiness(state)
            inputs.save(folder, state)
            asyncio.run(run())
            self.assertEqual(len(calls), 1)
            self.assertTrue(calls[0][1]['force_no_price'])
            self.assertTrue(calls[0][1]['skip_binding_check'])
            self.assertTrue(calls[0][1]['strict_inputs'])
            self.assertEqual(inputs.load('tester', state['id'], 'download_shared')[1]['status'], 'calculated')
            with self.assertRaisesRegex(inputs.SourceError, '已核算'):
                asyncio.run(run())

    def test_real_engine_output_marks_missing_inputs_and_removes_template_old_data(self):
        import processor
        self.delivery()
        book = load_workbook(self.source / 'template.xlsx')
        for name in ('配送单', '配送所得', '安全基金', '骑手支付绑定', '问题单', '违规索赔', '风神账单'):
            sheet = book.create_sheet(name)
            sheet.append(['旧资料'])
            sheet.append(['old_business_data'])
        book.save(self.source / 'template.xlsx')
        book.close()
        folder, state = inputs.create(str(self.source), 'tester', 'manual')
        final = []
        processor.process_rider_data('泉州', '半月结', str(folder / 'input'), '', lambda *a: None,
            lambda *a: None, lambda *a: final.append(a), THEME, template_file='template.xlsx',
            output_root=str(self.root / 'output'), strict_inputs=True, manual_template_only=True,
            force_no_price=True, skip_binding_check=True, input_snapshot=inputs.public(state))
        self.assertEqual(final[-1][0], 'success', final)
        files = list(Path(final[-1][1]).glob('*.xlsx'))
        self.assertTrue(files)
        result = load_workbook(files[0], read_only=True, data_only=False)
        self.assertIn('核算资料说明', result.sheetnames)
        for name in ('问题单', '违规索赔', '风神账单'):
            self.assertFalse(any('old_business_data' in row for row in result[name].iter_rows(values_only=True)))
        result.close()


if __name__ == '__main__':
    unittest.main()
