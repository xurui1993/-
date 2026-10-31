import csv
import json
from pathlib import Path
import tempfile
import unittest
from openpyxl import Workbook
from payroll_review import application_summary, build_review, metric_value, write_review


class PayrollReviewTests(unittest.TestCase):
    def state(self):
        return {'id':'synthetic', 'plan':{'city':'测试城','start':'2026-10-01','end':'2026-10-15','applicants':3,'template':'测试-template.xlsx'},
                'template_hash':'abc', 'deductions':{'version':'rules'}, 'items':{
                    'delivery_fee':{'label':'配送费','status':'ready','file':'delivery.csv','sha256':'123'},
                    'payment_binding':{'label':'支付绑定','status':'omitted'}}}

    def test_unknown_statistics_are_not_zero_and_partial_batches_are_not_summed_as_complete(self):
        self.assertIsNone(metric_value(None, 'riders'))
        self.assertIsNone(metric_value({'batch_stats':{'a':{'orders':2},'b':{}}}, 'orders'))
        self.assertIsNone(metric_value({'riders':True}, 'riders'))
        self.assertEqual(metric_value({'batch_stats':{'a':{'orders':2},'b':{'orders':3}}}, 'orders'), 5)
        result = build_review(self.state(), None)
        self.assertTrue(any(item['code']=='unknown_no_price' for item in result['issues']))
        self.assertEqual(result['status'], 'pending_review')

    def test_omissions_and_positive_anomalies_always_remain_visible(self):
        value = build_review(self.state(), {'riders':2,'orders':9,'no_price':1,'unbound':0,'intercepted':0})
        codes = {issue['code'] for issue in value['issues']}
        self.assertIn('omitted_payment_binding', codes)
        self.assertIn('no_price', codes)
        self.assertNotIn('unbound', codes)
        self.assertIn('人工', value['money_check'])
        self.assertEqual(value['deduction_version'], 'rules')

    def test_application_rows_and_unique_riders_have_different_grains(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'test-template.xlsx'
            book = Workbook()
            book.active.title = '申请名单'
            book.active.append(['骑手ID','开始日期','结束日期'])
            for row in [('00123','2026-10-01','2026-10-15'),('00123','2026-10-01','2026-10-15'),('00123','2026-10-16','2026-10-31')]:
                book.active.append(row)
            book.save(file)
            book.close()
            before = file.read_bytes()
            value = application_summary(file)
            self.assertEqual(value['records'], 3)
            self.assertEqual(value['unique_riders'], 1)
            self.assertEqual(value['duplicate_rows'], [{'row':3,'same_as':2}])
            self.assertEqual(file.read_bytes(), before)
            review = build_review(self.state(), {}, value)
            self.assertTrue(any(item['code']=='duplicate_application' for item in review['issues']))

    def test_export_keeps_unknown_values_and_csv_cells_literal(self):
        with tempfile.TemporaryDirectory() as temp:
            value = build_review(self.state(), {})
            value['template']['name'] = '=HYPERLINK("example")'
            write_review(Path(temp), value)
            stored = json.loads((Path(temp)/'核算复核摘要.json').read_text(encoding='utf-8'))
            self.assertEqual(stored['status'], 'pending_review')
            rows = list(csv.reader((Path(temp)/'核算复核清单.csv').open(encoding='utf-8-sig')))
            self.assertTrue(any('未统计' in row for row in rows))
            self.assertTrue(any(row[1].startswith("'=") for row in rows if len(row)>1))


if __name__ == '__main__':
    unittest.main()
