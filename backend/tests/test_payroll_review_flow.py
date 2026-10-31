"""Synthetic finish events carry the same persisted review shown after reload."""
import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from openpyxl import Workbook
import payroll_inputs as inputs


class PayrollReviewFlowTests(unittest.TestCase):
    def test_success_persists_summary_and_export_without_changing_engine_options(self):
        self.run_flow(False)

    def test_review_export_failure_keeps_calculated_result_and_reports_gap(self):
        self.run_flow(True)

    def run_flow(self, export_failure):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root/'input'
            source.mkdir()
            output = root/'output'
            output.mkdir()
            book = Workbook()
            book.active.title = '申请名单'
            book.active.append(['骑手ID'])
            book.active.append(['00123'])
            book.save(source/'test-template.xlsx')
            book.close()
            state = {'id':'synthetic','mode':'manual','status':'ready','jobs':[], 'created_at':'2026-10-31T00:00:00',
                     'template_hash':'template-hash', 'deductions':{'version':'rules-v1','rows':[{'保险':3}],'frozen':True},
                     'plan':{'city':'测试城','start':'2026-10-01','end':'2026-10-15','cycle':'半月结','applicants':1,'template':'test-template.xlsx'},
                     'items':{'delivery_fee':{'label':'配送费','status':'ready'},'lanorange_part_price':{'label':'价格档案','status':'omitted'},'payment_binding':{'label':'支付绑定','status':'omitted'}}}
            calls = []
            async def engine(*args, **kwargs):
                calls.append(kwargs)
                yield 'data: '+json.dumps({'type':'finish','status':'success','out_file':str(output),'stats':{'riders':1,'orders':10,'no_price':1,'unbound':0,'intercepted':0}})+'\n\n'
            async def run():
                config = SimpleNamespace(payrollSourceMode='manual',payrollPreparationId='synthetic',basePath='',theme='',enableInterceptor=True,enableCrossStationMerge=False)
                return [event async for event in inputs.run_payroll(config, SimpleNamespace())]
            from payroll_review import write_review
            with patch.object(inputs,'workspace',return_value='shared'), patch.object(inputs,'load',return_value=(root,state)), \
                 patch.object(inputs,'claim_calculation',return_value=(root,state,source)), patch.object(inputs,'verified_hashes',return_value={}), \
                 patch.object(inputs,'publish_result',return_value=output), patch('tasks.run_main_calculation_gen',engine), \
                 patch('payroll_review.write_review',side_effect=OSError('synthetic-full-disk') if export_failure else write_review):
                events = asyncio.run(run())
            decoded = [json.loads(event[6:]) for event in events if event.startswith('data: ')]
            finish = next(event for event in decoded if event['type']=='finish')
            stored = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(stored['status'],'calculated')
            self.assertEqual(finish['review_summary'],stored['result']['review_summary'])
            self.assertEqual(finish['review_summary']['status'],'pending_review')
            self.assertTrue(calls[0]['strict_inputs'])
            self.assertEqual(calls[0]['deductionRules'],[{'保险':3}])
            self.assertTrue(calls[0]['force_no_price'])
            if export_failure:
                self.assertIn('export_error',finish['review_summary'])
            else:
                self.assertTrue((output/'核算复核清单.csv').is_file())


if __name__ == '__main__':
    unittest.main()
