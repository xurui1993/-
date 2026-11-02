// Mock-only browser regression: every /api/ request is intercepted; no business service is called.
import {createRequire} from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const require=createRequire(import.meta.url);
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=process.env.TASK_HUB_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'task-hub-ui-'));
fs.mkdirSync(work,{recursive:true});
const python=process.env.PYTHON||path.join(repo,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const environment={...process.env,PYTHONPATH:path.join(repo,'backend'),PYTHONIOENCODING:'utf-8'};
const playwrightRoot=execFileSync(python,['-c',"import pathlib,playwright;print(pathlib.Path(playwright.__file__).parent/'driver'/'package')"],{cwd:repo,env:environment,encoding:'utf8'}).trim();
const {chromium}=require(playwrightRoot);
const options=JSON.parse(execFileSync(python,['-c',`import json,task_catalog as catalog,download_service as service
print(json.dumps(dict(cities=[dict(name='武汉',id='city')],datasets=[dict(id=k,label=v) for k,v in service.DATASETS.items()],scenarios=catalog.SCENARIOS,generators=catalog.generators(),timezone='Asia/Shanghai',order_window_days=60),ensure_ascii=False))`],{cwd:repo,env:environment,encoding:'utf8'}));
const root=path.resolve(repo,'dist');
assert.ok(fs.existsSync(path.join(root,'index.html')),'Run npm run build first');
const base={kind:'download',cities:['武汉'],datasets:['delivery_fee'],start:'2026-10-01',end:'2026-10-31',created_at:'2026-11-03T02:00:00Z',systems:['fengshen'],attempts:[],files:[],member_ids:[],available_files:0,failed_items:0,completed_items:0,total_items:1};
let rows=[{...base,id:'1'.repeat(32),title:'已完成采集示例',status:'success',available_files:1,files:[{id:'file1',run_id:'1'.repeat(32),name:'配送费.csv',city:'武汉',bytes:20,available:true}]},{...base,id:'2'.repeat(32),title:'部分完成示例',status:'partial',available_files:1,failed_items:1,files:[{id:'file2',run_id:'2'.repeat(32),name:'配送费.csv',city:'武汉',bytes:20,available:true}]},{...base,id:'3'.repeat(32),title:'等待验证示例',status:'waiting_manual',phase:'waiting_manual'}].map(r=>({...r,member_ids:[r.id],action_run_id:r.id}));
let runs=[];const creates=[],writes=[],errors=[];
let auth={state:'ready',stage:'ready',saved:true,busy:false,challenge_id:null,message:'模拟已连接',phone_mask:'',retry_after:0,can_send:false,can_verify:false,can_recheck:false,session_version:'fixture',phone_required:false};
let sends=0,verifies=0;
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(root,pathname==='/'?'index.html':decodeURIComponent(pathname));if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:process.env.TASK_HUB_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
try{
 const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  let data={success:true};
  if(req.method()!=='GET')writes.push({path:p,body:req.postDataJSON()});
  if(p==='/api/config')data={};
  else if(p==='/api/default_paths')data={dataPath:'fixture-data',outputPath:'fixture-output'};
  else if(p==='/api/parttime/queue')data={tasks:[]};
  else if(p==='/api/workbench/station-directory')data={platform:'fengshen',status:'ready',session_version:'fixture',cities:[{id:'city',name:'武汉',station_count:2,status:'ready'}],stations:[],fetched_at:'2026-11-03T02:00:00Z'};
  else if(p==='/api/fengshen-downloads/options')data=options;
  else if(p==='/api/workbench/task-center'){
    let filtered=rows;if(url.searchParams.get('view')==='results')filtered=filtered.filter(r=>r.available_files>0);
    const counts={all:filtered.length,active:filtered.filter(r=>['queued','running','waiting_manual'].includes(r.status)).length,attention:filtered.filter(r=>['waiting_manual','partial'].includes(r.status)).length,success:filtered.filter(r=>r.status==='success').length};
    const status=url.searchParams.get('status');if(status==='attention')filtered=filtered.filter(r=>['waiting_manual','partial'].includes(r.status));else if(status==='success')filtered=filtered.filter(r=>r.status==='success');else if(status==='active')filtered=filtered.filter(r=>['queued','running','waiting_manual'].includes(r.status));
    const focus=url.searchParams.get('focus');data={records:filtered,total:filtered.length,pages:1,page:1,counts,warnings:[],focused:rows.find(r=>r.id===focus)||null};
  }
  else if(p==='/api/fengshen-downloads/runs'&&req.method()==='POST'){
    const payload=req.postDataJSON();creates.push(payload);const id=String(4+creates.length).repeat(32);
    const run={...payload,id,status:'queued',created_at:'2026-11-03T03:00:00Z',progress:0,phase:'queued',items:[],logs:[],files:[]};runs.unshift(run);
    const scenario=options.scenarios.find(s=>s.id===payload.scenario_id);rows.unshift({...base,...run,kind:payload.task_kind,available_files:0,title:scenario?.label||options.generators.find(r=>r.id===payload.generation_target)?.label||'自定义资料',member_ids:[id],action_run_id:id});data={run};
  }
  else if(p==='/api/fengshen-downloads/runs')data={runs};
  else if(/^\/api\/fengshen-downloads\/runs\/[^/]+$/.test(p)){
    const id=p.split('/').at(-1);data={run:runs.find(r=>r.id===id)||{...base,id,status:'waiting_login',phase:'waiting_manual',progress:0,logs:[{time:'2026-11-03T02:00:00Z',message:'模拟等待平台验证'}],items:[],files:[]}};
  }
  else if(p.includes('/platform-auth/'))data={state:'ready',saved:true,busy:false,session_version:'fixture',message:'模拟已连接'};
  else if(p.includes('/fengshen/auth/')){
    if(p.endsWith('/send')){sends++;auth={...auth,stage:'sms_sent',can_verify:true};data={ok:true,status:auth};}
    else if(p.endsWith('/verify')){verifies++;auth={...auth,state:'ready',stage:'ready',challenge_id:null,can_send:false,can_verify:false};data={ok:true,status:auth};}
    else data=p.endsWith('/status')?auth:{status:auth};
  }
  else if(p.endsWith('/activity'))data={active:false};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'＋ 新建任务',exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.locator('.wb-sidebar .wb-sidebar-text').allTextContents().then(v=>v.join(',')),'任务中心,薪资核算,价格管理,平台连接,扣款规则,模板中心');
 await page.screenshot({path:work+'/task-hub-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'新建任务',exact:true});
 await dialog.getByRole('button',{name:/闪购月度核算资料包/}).click();
 await dialog.locator('.wb-inline-city-chip').filter({hasText:'武汉'}).click();
 assert.equal(await dialog.locator('.tc-dataset-details').getAttribute('open'),null);
 await dialog.getByRole('button',{name:'下一步：确认产出',exact:true}).click();
 await dialog.getByText('预期产出',{exact:true}).waitFor();assert.equal(creates.length,0);
 await page.screenshot({path:work+'/task-hub-confirm.png',fullPage:true});
 await dialog.getByRole('button',{name:'确认并创建任务',exact:true}).click();
 await page.getByRole('dialog',{name:'任务详情',exact:true}).waitFor();assert.equal(creates.length,1);assert.equal(creates[0].scenario_id,'shangou_monthly_payroll');
 await page.getByRole('button',{name:'关闭任务详情',exact:true}).click();
 await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'新建任务',exact:true});
 await dialog.getByRole('button',{name:/闪购月度核算资料包/}).click();
 await dialog.getByRole('button',{name:'查看已有任务',exact:true}).click();
 await page.getByRole('dialog',{name:'任务详情',exact:true}).waitFor();assert.equal(creates.length,1);
 await page.getByRole('button',{name:'关闭任务详情',exact:true}).click();
 await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'新建任务',exact:true});
 await dialog.getByRole('button',{name:/蓝橙人事全量资料包/}).click();
 await dialog.getByRole('button',{name:'下一步：确认产出',exact:true}).waitFor();
 assert.equal(await dialog.locator('.wb-inline-city-chip:visible').count(),0);
 await dialog.getByRole('button',{name:'下一步：确认产出',exact:true}).click();
 await dialog.getByText('全量交付，不按所选日期筛选',{exact:true}).waitFor();
 await page.getByRole('button',{name:'关闭新建任务',exact:true}).click();assert.equal(creates.length,1);
 await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'新建任务',exact:true});
 await dialog.getByRole('button',{name:'专项报表',exact:true}).click();
 await dialog.getByRole('button',{name:/异常骑手整理/}).click();
 await dialog.getByRole('button',{name:'下一步：确认产出',exact:true}).click();
 await dialog.getByRole('button',{name:'确认并创建任务',exact:true}).click();
 await page.getByRole('dialog',{name:'任务详情',exact:true}).waitFor();assert.equal(creates.length,2);assert.equal(creates[1].generation_target,'abnormal_riders');
 await page.getByRole('button',{name:'关闭任务详情',exact:true}).click();
 await page.getByRole('button',{name:'成果下载',exact:true}).click();
 await page.getByRole('button',{name:'已完成采集示例',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'等待验证示例',exact:true}).count(),0);
 for(const width of [1024,390]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:work+`/task-hub-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:'＋ 新建任务',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'新建任务',exact:true});await dialog.getByRole('button',{name:/灯塔骑手档案/}).click();
 assert.equal(await dialog.getByRole('button',{name:'下一步：确认产出',exact:true}).isEnabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:work+'/task-hub-mobile-create.png',fullPage:true});
 await page.getByRole('button',{name:'关闭新建任务',exact:true}).click();
 await page.setViewportSize({width:1440,height:1000});
 auth={...auth,state:'waiting_login',stage:'login_required',busy:true,challenge_id:'fixture-export',purpose:'export',can_send:true};
 await page.getByRole('dialog',{name:'风神导出验证',exact:true}).waitFor({timeout:9000});
 await page.getByRole('button',{name:'收起认证，保留任务',exact:true}).click();
 await page.waitForTimeout(1300);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(sends,0);
 await page.getByRole('button',{name:'任务列表',exact:true}).click();
 await page.locator('tr').filter({hasText:'等待验证示例'}).getByRole('button',{name:'完成验证',exact:true}).click();
 await page.getByRole('dialog',{name:'任务详情',exact:true}).getByRole('button',{name:'打开风神登录',exact:true}).click();
 await page.getByRole('dialog',{name:'风神导出验证',exact:true}).waitFor();
 await page.getByRole('button',{name:'获取验证码',exact:true}).click();
 await page.locator('#fengshen-code').fill('123456');
 await page.getByRole('button',{name:'验证并继续',exact:true}).click();
 await page.waitForTimeout(400);assert.equal(sends,1);assert.equal(verifies,1);
 await page.getByRole('button',{name:'关闭任务详情',exact:true}).click();
 await page.locator('.wb-sidebar').getByRole('button',{name:'薪资核算',exact:true}).click();
 await page.waitForTimeout(300);assert.equal(await page.getByRole('dialog',{name:'新建任务',exact:true}).count(),0);
 await page.locator('.wb-sidebar').getByRole('button',{name:'任务中心',exact:true}).click();
 await page.getByRole('button',{name:'＋ 新建任务',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 const report={simulated_platform:true,real_business_writes:0,frontend_runtime_errors:errors,created_tasks:creates.length,three_step_creation:true,close_does_not_submit:true,full_scope:true,report_creation:true,result_view:true,responsive_widths:[1440,1024,390],verification_auto_open:true,verification_hide_keeps_waiting:true,verification_reopen_from_task:true,sends,verifies,payroll_navigation_no_creation_overlay:true,intercepted_writes:writes.map(r=>r.path)};
 fs.writeFileSync(work+'/task-hub-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,artifacts:work}));
} finally {await context.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
