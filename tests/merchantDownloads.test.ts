import {test} from 'node:test';import assert from 'node:assert/strict';
import {toggleDownloadDataset,selectionKey,isMerchant,datasetGroup} from '../src/lib/downloadCenterLogic.ts';
test('all stations and excluded separation are distinct selections from historical filters',()=>{
 const base={cities:['深圳'],datasets:['delivery_fee'],start:'2026-10-01',end:'2026-10-15'};
 const keys=[selectionKey({...base,exclude_separation:false}),selectionKey({...base,exclude_separation:true}),selectionKey(base),selectionKey({...base,include_separation:true})];
 assert.equal(new Set(keys).size,4);
});
test('invitation and attendance remain selected alongside other city bills',()=>{
 assert.deepEqual(toggleDownloadDataset(['delivery_fee','lanorange_part_price'],'invitation_records'),['delivery_fee','lanorange_part_price','invitation_records']);assert.deepEqual(toggleDownloadDataset(['invitation_records'],'attendance_detail'),['invitation_records','attendance_detail']);assert.deepEqual(toggleDownloadDataset(['invitation_records','attendance_detail'],'delivery_fee'),['invitation_records','attendance_detail','delivery_fee']);assert.deepEqual(toggleDownloadDataset(['invitation_records'],'baize_employees'),['baize_employees']);assert.equal(datasetGroup('invitation_records'),'fengshen');assert(isMerchant('attendance_detail'));
});
test('invitation snapshots ignore irrelevant dates, attendance selection preserves exact requested period',()=>{
 const a={cities:['当前商家'],datasets:['invitation_records'],start:'2026-10-01',end:'2026-10-31'};assert.equal(selectionKey(a),selectionKey({...a,start:'2026-01-01',end:'2026-01-02'}));assert.notEqual(selectionKey({...a,datasets:['attendance_detail']}),selectionKey({...a,datasets:['attendance_detail'],end:'2026-10-30'}));assert.notEqual(selectionKey(a),selectionKey({...a,datasets:['rider_info']}));
});
test('selected city merchants are distinct from legacy current-merchant tasks and each other',()=>{
 const base={cities:['深圳','三亚'],datasets:['invitation_records'],start:'2026-10-01',end:'2026-10-27',merchant_by_city:true};
 assert.equal(selectionKey(base),selectionKey({...base,cities:['三亚','深圳'],start:'2026-01-01'}));
 assert.notEqual(selectionKey(base),selectionKey({...base,cities:['深圳']}));
 assert.notEqual(selectionKey(base),selectionKey({...base,merchant_by_city:false,cities:['当前商家']}));
});

test('xiaoxiang datasets support multi-selection and deterministic key generation',()=>{
 const step1 = toggleDownloadDataset([], 'rider_daily');
 assert.deepEqual(step1, ['rider_daily']);
 const step2 = toggleDownloadDataset(step1, 'detail_orders');
 assert.deepEqual(step2, ['rider_daily', 'detail_orders']);
 const step3 = toggleDownloadDataset(step2, 'detail_kesu');
 assert.deepEqual(step3, ['rider_daily', 'detail_orders', 'detail_kesu']);
 const unselected = toggleDownloadDataset(step3, 'detail_orders');
 assert.deepEqual(unselected, ['rider_daily', 'detail_kesu']);

 const key1 = selectionKey({cities: ['全部城市'], datasets: ['detail_orders', 'rider_daily'], start: '2026-10-01', end: '2026-10-15'});
 const key2 = selectionKey({cities: ['全部城市'], datasets: ['rider_daily', 'detail_orders'], start: '2026-10-01', end: '2026-10-15'});
 assert.equal(key1, key2);
});

