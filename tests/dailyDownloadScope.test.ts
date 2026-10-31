import test from 'node:test';
import assert from 'node:assert/strict';
import {datasetGroup, selectionKey, isGlobalDataset} from '../src/lib/downloadCenterLogic';

test('daily range stays all-cities and is keyed by the whole period',()=>{
 const range={cities:['全部城市'],datasets:['rider_daily'],start:'2026-10-01',end:'2026-10-30'};
 assert.equal(selectionKey(range),selectionKey({...range,cities:['泉州']}));
 assert.notEqual(selectionKey(range),selectionKey({...range,start:'2026-10-02'}));
 assert.notEqual(selectionKey(range),selectionKey({...range,end:'2026-10-29'}));
});

test('daily scope is independent of city selection but changes for a different business day',()=>{
 const base={cities:['全部城市'],datasets:['rider_daily'],start:'2026-10-25',end:'2026-10-25'};
 assert.equal(selectionKey(base),selectionKey({...base,cities:['泉州']}));
 assert.notEqual(selectionKey(base),selectionKey({...base,start:'2026-10-26',end:'2026-10-26'}));
 assert.equal(datasetGroup('rider_daily'),'xiaoxiang');
 assert.equal(isGlobalDataset('rider_daily'),false); // Unlike snapshots, one specific day matters.
});

test('detail exports are independent xiaoxiang items with their own date range key',()=>{
 for(const dataset of ['detail_orders','detail_kesu','detail_reviews']){
  const base={cities:['全部城市'],datasets:[dataset],start:'2026-10-25',end:'2026-10-25'};
  assert.equal(datasetGroup(dataset),'xiaoxiang');
  assert.equal(isGlobalDataset(dataset),false);
  assert.equal(selectionKey(base),selectionKey({...base,cities:['泉州']}));
  assert.notEqual(selectionKey(base),selectionKey({...base,start:'2026-10-26',end:'2026-10-26'}));
  assert.notEqual(selectionKey(base),selectionKey({...base,datasets:['rider_daily']}));
 }
});

test('rider archive is a date-insensitive snapshot in the xiaoxiang group',()=>{
 const base={cities:['全部城市'],datasets:['rider_archive'],start:'2026-10-30',end:'2026-10-30'};
 assert.equal(datasetGroup('rider_archive'),'xiaoxiang');
 assert.equal(isGlobalDataset('rider_archive'),false);
 assert.equal(selectionKey(base),selectionKey({...base,cities:['泉州']}));
 assert.equal(selectionKey(base),selectionKey({...base,start:'2026-10-01',end:'2026-10-30'}));
 assert.notEqual(selectionKey(base),selectionKey({...base,datasets:['rider_daily']}));
});
