"""Task hub contracts using isolated metadata and result packages only."""
import asyncio
import copy
import datetime as dt
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import task_catalog as catalog
import download_service as service
import download_records
import task_center as center
from fastapi import HTTPException
from test_task_center import request, record


class ScenarioTests(unittest.TestCase):
    def test_every_scenario_is_a_complete_legal_platform_selection(self):
        for scenario in catalog.SCENARIOS:
            with self.subTest(scenario=scenario['id']), patch.object(service.city_catalog,'selectable_cities',return_value={'武汉':'city'}):
                payload={'task_kind':'download','source_platform':scenario['platform'],'scenario_id':scenario['id'],
                    'datasets':scenario['datasets'],'cities':['武汉'],'start':'2026-10-01','end':'2026-10-31',
                    'lanorange_full_delivery':True,'exclude_separation':True}
                config=service.validate_request(payload,today=dt.date(2026,11,3))
                self.assertEqual(config['scenario_label'],scenario['label'])
                self.assertEqual(config['source_platform'],scenario['platform'])
                self.assertEqual(set(config['datasets']),set(scenario['datasets']))

    def test_cross_platform_and_modified_packages_are_rejected_without_silent_omission(self):
        for payload in (
            {'source_platform':'fengshen','datasets':['delivery_fee','lanorange_rider_archive']},
            {'source_platform':'fengshen','scenario_id':'shangou_monthly_payroll','datasets':['delivery_fee']},
            {'source_platform':['fengshen'],'datasets':['delivery_fee']},
        ):
            with self.subTest(payload=payload),self.assertRaises(ValueError):catalog.intent({'task_kind':'download',**payload})
        value=catalog.intent({'task_kind':'download','source_platform':'fengshen','datasets':['delivery_fee'],'scenario_label':'forged'})
        self.assertEqual(value['scenario_label'],'自定义资料 · 风神')
        self.assertEqual(catalog.intent({'task_kind':'download','datasets':['delivery_fee']}),{'task_kind':'download'})

    def test_attempts_keep_one_business_task_and_frozen_scenario_title(self):
        base=dict(id='root',status='error',task_kind='download',cities=['武汉'],datasets=['delivery_fee'],
            start='2026-10-01',end='2026-10-31',created_at='2026-11-03',scenario_id='saved',scenario_label='已冻结业务包',
            items=[dict(city='武汉',dataset='delivery_fee',start='2026-10-01',end='2026-10-31',status='error')],files=[])
        retry={**base,'id':'retry','retry_of':'root','created_at':'2026-11-04','scenario_label':'other','status':'success',
            'items':[{**base['items'][0],'status':'success'}]}
        rows=download_records.group_records([base,retry])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['title'],'已冻结业务包')
        self.assertEqual(rows[0]['member_ids'],['root','retry'])
        self.assertEqual(rows[0]['total_items'],1)


class HubResultTests(unittest.TestCase):
    def test_exact_attempt_focus_resolves_original_task_outside_the_page(self):
        rows=[record(str(index),available_files=1) for index in range(45)]
        rows[0]['member_ids']=['0','historic-attempt']
        with tempfile.TemporaryDirectory() as folder,patch.object(center,'ROOT',Path(folder)),patch.object(center,'collect',return_value=(rows,[])):
            result=center.listing(request(query='focus=historic-attempt'),page=2)
            self.assertEqual(result['focused']['id'],'0')
            self.assertNotIn('0',[row['id'] for row in result['records']])

    def test_result_view_filters_before_counts_and_tasks_prioritize_attention(self):
        rows=[record('done',available_files=1),record('waiting','waiting_manual',available_files=0),
              record('partial','partial',available_files=1),record('empty',available_files=0)]
        ordered,counts=center.select_records(copy.deepcopy(rows),set(),{})
        self.assertEqual({r['id'] for r in ordered[:2]},{'waiting','partial'})
        results,counts=center.select_records(copy.deepcopy(rows),set(),{'view':'results'})
        self.assertEqual({r['id'] for r in results},{'done','partial'})
        self.assertEqual(counts,dict(all=2,active=0,attention=1,success=1))

    def test_batch_results_are_streamed_into_separate_task_folders(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            rows=[record(key,available_files=1,title='同名业务任务') for key in ('a'*32,'a'*31+'b')]
            def bundle(manager,owner,key):
                path=base/(key+'.zip')
                with zipfile.ZipFile(path,'w') as archive:archive.writestr('工资表.xlsx',key.encode())
                return path,'result.zip'
            with patch.object(center,'collect',return_value=(rows,[])),patch.object(center,'require_account',return_value={'owner':'test','role':'user'}),patch('download_jobs.get_manager',return_value=SimpleNamespace(db_path=base/'tasks.sqlite3')),patch.object(download_records,'record_bundle',side_effect=bundle):
                response=center.batch_bundle({'ids':[row['id'] for row in rows]},request('POST'))
                try:
                    with zipfile.ZipFile(response.path) as archive:
                        names=archive.namelist()
                        self.assertEqual(len(names),2)
                        self.assertEqual(len({name.split('/')[0] for name in names}),2)
                        self.assertTrue(all(name.endswith('/工资表.xlsx') for name in names))
                        self.assertEqual({archive.read(name).decode() for name in names},{row['id'] for row in rows})
                        self.assertIsNone(archive.testzip())
                finally:asyncio.run(response.background())

    def test_invalid_package_paths_abort_and_clean_up(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);key='a'*32
            def bundle(*args):
                path=base/'source.zip'
                with zipfile.ZipFile(path,'w') as archive:archive.writestr('../outside.xlsx',b'no')
                return path,'source.zip'
            with patch.object(center,'collect',return_value=([record(key,available_files=1)],[])),patch.object(center,'require_account',return_value={'owner':'test','role':'user'}),patch('download_jobs.get_manager',return_value=SimpleNamespace(db_path=base/'tasks.sqlite3')),patch.object(download_records,'record_bundle',side_effect=bundle):
                with self.assertRaises(HTTPException):center.batch_bundle({'ids':[key]},request('POST'))
            self.assertFalse(list((base/'bundles').glob('*.zip')))
            self.assertFalse((base/'source.zip').exists())


if __name__=='__main__':unittest.main()
