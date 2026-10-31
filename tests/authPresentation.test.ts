import test from 'node:test';
import assert from 'node:assert/strict';
import {loginStatus,platformLoginLabel} from '../src/lib/authPresentation.ts';

test('All platforms uniformly display 登录 action label',()=>{
  for(const key of ['lanorange','fengshen','baize','xiaoxiang']){
    assert.equal(platformLoginLabel(key,{state:'signed_out'}),'登录');
    assert.equal(platformLoginLabel(key,{state:'login_required',saved:true}),'登录');
    assert.equal(platformLoginLabel(key,{state:'waiting_login',busy:true}),'登录');
  }
});
test('only verified ready is logged in',()=>{
  assert.equal(loginStatus({state:'ready'}),'已登录');
  assert.equal(loginStatus({state:'partial'}),'部分可用');
  for(const state of ['signed_out','unknown','error'])assert.notEqual(loginStatus({state}),'已登录');
});
test('offline status does not reuse a green ready status',()=>assert.equal(loginStatus({state:'ready',offline:true}),'状态暂不可用'));
test('saved credentials still require background validation',()=>assert.equal(loginStatus({state:'saved'}),'待验证'));
test('SMS stages remain waiting and do not imply success',()=>{
  assert.equal(loginStatus({state:'waiting_login'}),'待验证');assert.equal(loginStatus({state:'sms_sent'}),'待验证');
});
test('explicit logout differs from normal login cleanup',()=>{
  assert.equal(loginStatus({state:'ready',cancelling:true}),'退出中');
  assert.equal(loginStatus({state:'ready',release_state:'releasing'}),'登录中');
  assert.equal(loginStatus({state:'ready',release_state:'released'}),'已登录');
});
