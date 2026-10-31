import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollReviewSummary, type PayrollReview } from '../src/components/PayrollReviewSummary';

const review:PayrollReview={version:1,status:'pending_review',batch_id:'synthetic',
  metrics:[{key:'applicants',label:'申请记录数',value:3,unit:'条',note:'预检申请行'},
    {key:'no_price',label:'无单价记录',value:null,unit:'条',note:'未提供统计'},
    {key:'unbound',label:'未绑定记录',value:0,unit:'条',note:'本项原统计'}],
  issues:[{code:'omitted_binding',label:'本批次确认不提供：支付绑定'}],sources:[],
  template:{name:'测试-template.xlsx',sha256:'template-hash'},deduction_version:'rules-v1',
  input_check:'运行前校验输入',money_check:'待Excel/WPS重算及人工核对'};
test('review keeps unknown counters distinct from known zero and never implies acceptance',()=>{
  const html=renderToStaticMarkup(React.createElement(PayrollReviewSummary,{review}));
  assert.match(html,/已生成 · 待人工复核/);
  assert.match(html,/未统计/);
  assert.match(html,/0 条/);
  assert.match(html,/本批次确认不提供/);
  assert.doesNotMatch(html,/验收通过|全部正常|已发薪/);
  assert.doesNotMatch(html,/<details[^>]*open/);
});
test('historical results without a review explain the evidence gap',()=>{
  const html=renderToStaticMarkup(React.createElement(PayrollReviewSummary,{}));
  assert.match(html,/未保存统一复核摘要/);
  assert.match(html,/未统计不代表零异常/);
});
test('duplicate application rows can be traced without showing personal identifiers',()=>{
  const value={...review,issues:[{code:'duplicate_application',label:'申请行重复',count:1,location:'测试-template.xlsx / 申请名单',rows:[{row:3,same_as:2}]}]};
  const html=renderToStaticMarkup(React.createElement(PayrollReviewSummary,{review:value}));
  assert.match(html,/申请名单/);
  assert.match(html,/第 3 行与第 2 行相同/);
});
