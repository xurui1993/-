import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { deliveryDownloadAlias } from '../server/deliveryDownloadAlias.ts';

test('payroll alias forwards only delivery-root descendants to authenticated manifest matching',()=>{
  const root=path.resolve('outputs/fengshen_downloads');const middleware=deliveryDownloadAlias(root);
  function run(target:string,method='GET'){
    const req:any={method,path:'/api/download',url:'/api/download?original',query:{path:target,workspace_id:'shared'},headers:{}};
    let called=false;middleware(req,{} as any,()=>{called=true;});assert.equal(called,true);return req;
  }
  const req=run(path.join(root,'task'));
  assert.match(req.url,/^\/api\/fengshen-downloads\/delivery-download\?/);assert.equal(req.headers['x-workspace-id'],'shared');
  assert.equal(run(root).url,'/api/download?original');
  assert.equal(run(path.join(root,'..','private')).url,'/api/download?original');
  assert.equal(run(path.join(root+'-other','task')).url,'/api/download?original');
  assert.equal(run(path.join(root,'task'),'POST').url,'/api/download?original');
});
