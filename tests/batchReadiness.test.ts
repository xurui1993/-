import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataReadinessMatrix } from '../src/components/DataReadinessMatrix';
import type { PayrollPreparationState } from '../src/components/PayrollPreparation';

test('readiness requires a real batch and never substitutes demonstration cities', () => {
  const html = renderToStaticMarkup(React.createElement(DataReadinessMatrix, {preparation: null}));
  assert.match(html, /上传薪资申请表/);
  assert.doesNotMatch(html, /142|230|10:25|催办|海口|儋州/);
});

test('readiness renders server batch items and distinguishes omitted from ready', () => {
  const preparation = {id:'a'.repeat(32),mode:'manual',status:'waiting_materials',jobs:[],
    plan:{city:'测试城市',start:'2026-10-01',end:'2026-10-15',month:'2026-10',applicants:2},
    items:{delivery_fee:{label:'配送费',status:'ready'},payment_binding:{label:'支付绑定',status:'omitted'},problem:{label:'问题单',status:'failed',error:'请补传正确文件'}}} as PayrollPreparationState;
  const html=renderToStaticMarkup(React.createElement(DataReadinessMatrix,{preparation}));
  assert.match(html,/测试城市/);
  assert.match(html,/已备齐 1 \/ 3/);
  assert.match(html,/已确认不使用 1/);
  assert.match(html,/请补传正确文件/);
  assert.doesNotMatch(html,/全网齐套率|同步|催办/);
});
