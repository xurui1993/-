import assert from 'node:assert/strict';
import test from 'node:test';
import { itemKey, newRequestId, phaseLabel, recoverable, retainAttempt, selectionKey } from '../src/lib/downloadCenterLogic.ts';

test('Baize employee snapshots ignore unused dates and cities but stay distinct from Blue Orange', () => {
  const selection = {cities: [], datasets: ['baize_employees'], start: '', end: ''};
  assert.equal(selectionKey(selection), selectionKey({...selection, cities: ['泉州'], start: '2026-10-01', end: '2026-10-26'}));
  assert.notEqual(selectionKey(selection), selectionKey({...selection, datasets: ['lanorange_rider_archive']}));
});

test('global Blue selections ignore irrelevant city and business dates', () => {
  const a = {cities: [], datasets: ['lanorange_rider_archive'], start: '', end: ''};
  const b = {...a, cities: ['全部城市'], start: '2026-10-18', end: '2026-10-18'};
  assert.equal(selectionKey(a), selectionKey(b));
  assert.notEqual(selectionKey(a), selectionKey({...a, datasets: ['lanorange_rider_quit']}));
});

test('unconfirmed create and retry retain original request and immutable payload', () => {
  const selection = { cities: ['泉州'], datasets: ['rider_detail'], start: '2026-09-20', end: '2026-10-10' };
  const original = retainAttempt(null, selection);
  selection.cities.push('广州');
  assert.deepEqual(original.payload.cities, ['泉州']);
  const changed = { cities: ['宁波'], datasets: ['rider_info'], start: '2026-10-01', end: '2026-10-17' };
  assert.strictEqual(retainAttempt(original, changed), original);
  assert.match(original.request_id, /^[A-Za-z0-9_-]{8,128}$/);
  assert.notEqual(retainAttempt(null, selection).request_id, original.request_id);
  const retry = retainAttempt(null, { runId: 'old-run', items: [{ city: '泉州', dataset: 'rider_detail', start: '2026-09-20', end: '2026-10-10' }] });
  assert.strictEqual(retainAttempt(retry, { runId: 'different-run', items: [] }), retry);
});

test('equivalent selections match independent of city and dataset checkbox order', () => {
  const base = { cities: ['泉州', '广州'], datasets: ['delivery_fee', 'penalty'], start: '2026-10-01', end: '2026-10-10' };
  assert.equal(selectionKey(base), selectionKey({ ...base, cities: [...base.cities].reverse(), datasets: [...base.datasets].reverse() }));
  assert.notEqual(selectionKey(base), selectionKey({ ...base, end: '2026-10-11' }));
  assert.notEqual(selectionKey(base), selectionKey({ ...base, datasets: ['penalty'] }));
  assert.equal(selectionKey(base), selectionKey({ ...base, refresh_history: false }));
  assert.notEqual(selectionKey(base), selectionKey({ ...base, refresh_history: true }));
});

test('recovery selection excludes success, running and blocked unknown submissions', () => {
  assert.equal(recoverable({ status: 'success', recovery: { mode: 'resume_existing', reason: '' } }), false);
  assert.equal(recoverable({ status: 'running', recovery: { mode: 'resume_existing', reason: '' } }), false);
  assert.equal(recoverable({ status: 'error', recovery: { mode: 'blocked', reason: '提交结果不明' } }), false);
  assert.equal(recoverable({ status: 'interrupted', recovery: { mode: 'resume_existing', reason: '已有凭据' } }), true);
  assert.equal(recoverable({ status: 'cancelled', recovery: { mode: 'retry_unsubmitted', reason: '未提交' } }), true);
  assert.equal(recoverable({ status: 'error' }), false);
});

test('item selections distinguish covered monthly periods and phase labels cover waiting causes', () => {
  const base = { city: '泉州', dataset: 'rider_monthly', start: '2026-09-01', end: '2026-09-30' };
  assert.notEqual(itemKey(base), itemKey({ ...base, start: '2026-10-01', end: '2026-10-31' }));
  assert.match(phaseLabel('waiting_login'), /登录/);
  assert.match(phaseLabel('waiting_manual'), /平台验证/);
  assert.match(phaseLabel('waiting_export'), /平台生成/);
  assert.match(phaseLabel('waiting_collection'), /主机采集会话/);
  assert.equal(phaseLabel(), '');
  assert.equal(phaseLabel('future-phase'), '正在处理');
});

test('LAN HTTP request identifiers use cryptographic fallback when randomUUID is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const crypto = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: crypto.getRandomValues.bind(crypto) } });
    const first = newRequestId(), second = newRequestId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  }
});


test('new city Blue selections distinguish cities but ignore unused dates and legacy global tasks', () => {
  const a = {cities:['泉州'], datasets:['lanorange_rider_archive'],start:'2026-09-01',end:'2026-09-30',lanorange_by_city:true};
  assert.notEqual(selectionKey(a),selectionKey({...a,cities:['韶关']}));
  assert.equal(selectionKey(a),selectionKey({...a,start:'2026-10-01',end:'2026-10-18'}));
  assert.notEqual(selectionKey(a),selectionKey({...a,lanorange_by_city:false}));
});


test('full delivery ignores Fengshen city/date selection and distinguishes old scope', () => {
  const selection={cities:['泉州'],datasets:['lanorange_part_price'],start:'2026-09-01',end:'2026-09-30',lanorange_full_delivery:true};
  assert.equal(selectionKey(selection),selectionKey({...selection,cities:['上海','韶关'],start:'bad',end:'bad'}));
  assert.notEqual(selectionKey(selection),selectionKey({...selection,lanorange_full_delivery:false}));
});
