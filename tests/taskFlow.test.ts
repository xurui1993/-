import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { flowStep, needsAction, prioritizeTasks } from '../src/lib/taskFlow';
import { TaskFlowSteps } from '../src/components/TaskFlowSteps';
test('unfinished and partial tasks stay at material handling, final results at delivery',()=>{
 assert.equal(flowStep('create'),0); assert.equal(flowStep('review'),1);
 for(const status of ['running','waiting_login','error','partial','interrupted']) assert.equal(flowStep(status),2);
 assert.equal(flowStep('calculated'),3); assert.equal(flowStep('success'),3);
});
test('selected task and work requiring attention precede history without mutating the list',()=>{
 const rows=[{id:'history',status:'success',member_ids:['old']},{id:'waiting',status:'waiting_login',member_ids:['wait']},{id:'selected',status:'error',member_ids:['current']}];
 assert.deepEqual(prioritizeTasks(rows,'current').map(x=>x.id),['selected','waiting','history']);
 assert.deepEqual(rows.map(x=>x.id),['history','waiting','selected']);
 assert(needsAction('waiting_materials')); assert(!needsAction('success'));
});
test('flow exposes exactly one accessible current step',()=>{
 const markup=renderToStaticMarkup(React.createElement(TaskFlowSteps,{status:'review'}));
 assert.equal((markup.match(/aria-current="step"/g)||[]).length,1);
 assert(markup.includes('确认范围'));assert(markup.includes('领取结果'));
});

import { PayrollPreparation } from '../src/components/PayrollPreparation';
test('preparation first exposes the mandatory gap and folds optional missing materials',()=>{
 const markup=renderToStaticMarkup(React.createElement(PayrollPreparation,{value:{id:'batch',mode:'manual',status:'waiting_materials',plan:{city:'测试',start:'2026-09-01',end:'2026-09-30',month:'2026-09',applicants:1},jobs:[],items:{delivery_fee:{label:'配送费必需样例',status:'failed'},payment_binding:{label:'支付绑定可选样例',status:'failed'}}},busy:false,apiFetch:async()=>new Response('{}'),onChange:()=>{},onContinue:()=>{},upload:async()=>null}));
 assert(markup.includes('配送费必需样例'));assert(!markup.includes('支付绑定可选样例'));
 assert(markup.includes('展开可选待处理资料'));assert.equal((markup.match(/wb-checklist-card /g)||[]).length,1);
});
