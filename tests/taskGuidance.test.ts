import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { taskGuidance, taskHandoffs } from '../src/lib/taskGuidance';
import { TaskOutcome } from '../src/components/TaskOutcome';
import { CollectionScope } from '../src/components/CollectionScope';

test('payroll records distinguish materials, preparation and continuing calculation', () => {
  assert.equal(taskGuidance({status:'awaiting_confirmation',kind:'payroll'}).action,'继续执行');
  assert.equal(taskGuidance({status:'pending_download',kind:'payroll'}).action,'准备资料');
  assert.equal(taskGuidance({status:'waiting_materials',kind:'payroll'}).action,'处理异常');
  assert.equal(taskGuidance({status:'ready',kind:'payroll'}).action,'继续核算');
  assert.equal(taskGuidance({status:'waiting_login'}).action,'完成验证');
  assert.equal(taskGuidance({status:'needs_review'}).action,'核实结果');
});
test('failed or unknown tasks never become successful because files exist', () => {
  for (const status of ['error','failed','interrupted']) {
    const value=taskGuidance({status,availableFiles:2,failedItems:2});
    assert.equal(value.tone,'error');
    assert.equal(value.needsAction,true);
    assert.notEqual(value.label,'已完成');
  }
  assert.equal(taskGuidance({status:'unrecognised',availableFiles:2}).label,'状态待确认');
  assert.equal(taskGuidance({status:'partial',availableFiles:2}).action,'处理未完成项');
  assert.match(taskGuidance({status:'success',summaryIssue:true}).hint,/未完成/);
});
test('successful results explain review without implying payroll acceptance', () => {
  const html=renderToStaticMarkup(React.createElement(TaskOutcome,{task:{status:'success',kind:'payroll',availableFiles:1}}));
  assert.match(html,/Excel \/ WPS/);
  assert.match(html,/复核/);
  assert.doesNotMatch(html,/验收通过|已发薪/);
  assert.equal(taskGuidance({status:'success',availableFiles:0}).action,'查看详情');
});
test('handoffs filter unsupported platforms and do not pass all-cities as a payroll city', () => {
  assert.deepEqual(taskHandoffs('download',['lanorange_rider_leave'],['全部城市']),{generate:true,payroll:true,cities:[]});
  for (const id of ['baize_employees','rider_daily','rider_archive','detail_orders','invitation_records']) {
    const next=taskHandoffs('download',[id],['当前商家']);
    assert.equal(next.generate,false);assert.equal(next.payroll,false);assert.deepEqual(next.cities,[]);
  }
  assert.equal(taskHandoffs('generate',['payment_binding'],['宁波']).generate,false);
  assert.equal(taskHandoffs('generate',['payment_binding'],['宁波']).payroll,true);
});
test('fixed-scope collection is compact and states permission and freshness limits', () => {
  for (const platform of ['baize','lanorange','xiaoxiang']) {
    const html=renderToStaticMarkup(React.createElement(CollectionScope,{platform}));
    assert.match(html,/当前账号权限/);
    assert.match(html,/更新时间以平台返回结果为准/);
    assert.doesNotMatch(html,/无限制|实时快照|<details[^>]*open/);
  }
});
