import assert from 'node:assert/strict';
import test from 'node:test';
import {batchDownloadBlocker} from '../src/lib/taskCenterView';

test('batch download explains incompatible selections and keeps available partial results eligible',()=>{
  assert.equal(batchDownloadBlocker([{kind:'download',available_files:1},{kind:'generate',available_files:2}]),'');
  assert.match(batchDownloadBlocker([{kind:'payroll',available_files:2}]),/核算队列/);
  assert.match(batchDownloadBlocker([{kind:'price-export',available_files:1}]),/价格结果/);
  assert.match(batchDownloadBlocker([{kind:'download',available_files:0}]),/尚无可用结果/);
  assert.match(batchDownloadBlocker(Array.from({length:21},()=>({kind:'download',available_files:1}))),/最多/);
});
