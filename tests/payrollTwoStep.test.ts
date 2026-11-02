import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FlashPayrollWorkbench,PayrollQueueTable,PayrollTaskActivity} from '../src/components/FlashPayrollWorkbench';
import {hasFullPayrollPreparation,legacyPayrollTask,type PayrollQueueTask} from '../src/lib/payrollQueue';

const props:any={config:{payrollSourceMode:'fengshen'},onConfigChange:()=>{},progress:0,logs:[],apiFetch:async()=>new Response('{"tasks":[]}'),isRunning:false,onRun:()=>{},onOpenDownloads:()=>{},onOpenConnections:()=>{},onOpenDeductions:()=>{},onOtherMode:()=>{},onPreparationChange:()=>{},onUploadFiles:async()=>{},uploadExtracted:async()=>null};
const plan={city:'深圳',start:'2026-10-01',end:'2026-10-15',month:'2026-10',applicants:3};

test('multiple templates remain available while a historical automatic task is running',()=>{
 const html=renderToStaticMarkup(React.createElement(FlashPayrollWorkbench,{...props,isRunning:true,payrollPreparation:{id:'a'.repeat(32),mode:'fengshen',status:'preparing',plan,items:{},jobs:[]}}));
 assert.match(html,/aria-label="上传薪资申请表"/);assert.match(html,/multiple=""/);
 assert.match(html,/<button[^>]*class="wb-primary"(?![^>]*disabled)[^>]*>选择模板<\/button>/);
 assert.match(html,/aria-label="排除取分离站点"[^>]*checked/);
 assert.doesNotMatch(html,/选择文件夹|fp-steps|资料下载清单|确认扣款并|新建核算/);
 const allStations=renderToStaticMarkup(React.createElement(FlashPayrollWorkbench,{...props,config:{payrollSourceMode:'fengshen',payrollExcludeSeparation:false}}));
 assert.doesNotMatch(allStations,/aria-label="排除取分离站点"[^>]*checked/);
});

test('task rows independently expose download, stop and confirmation without duplicate state cards',()=>{
 const tasks:PayrollQueueTask[]=[{id:'one',batch_id:'a',mode:'fengshen',template_name:'深圳-template.xlsx',plan,status:'preparing',current_action:'正在下载配送费'},
 {id:'two',batch_id:'b',mode:'manual',template_name:'广州-template.xlsx',plan:{...plan,city:'广州'},status:'waiting_confirmation',preparation:{id:'b',mode:'manual',status:'ready',plan}},
 {id:'three',batch_id:'c',mode:'fengshen',template_name:'宁波-template.xlsx',plan:{...plan,city:'宁波'},status:'completed'}];
 const noop=()=>{};
 const html=renderToStaticMarkup(React.createElement(PayrollQueueTable,{tasks,checked:[],onSelect:noop,onCheck:noop,onCheckAll:noop,onStop:noop,onRemove:noop,onDownload:noop,onOpenDirectory:noop,onConfirm:noop,onRestore:noop}));
 assert.match(html,/深圳-template/);assert.match(html,/广州-template/);assert.match(html,/宁波-template/);
 assert.equal((html.match(/>停止<\/button>/g)||[]).length,1);assert.match(html,/确认扣款/);assert.match(html,/打开 宁波-template.xlsx 结果目录/);
 assert.match(html,/下载配送费/);assert.doesNotMatch(html,/0%|fp-status|重试/);
});

test('summary-only preparations are not rendered as a complete manual material editor',()=>{
 const summary:any={id:'b',mode:'manual',status:'ready',plan};
 assert.equal(hasFullPayrollPreparation(summary),false);
 assert.equal(hasFullPayrollPreparation({...summary,items:{},jobs:[]}),true);
});

test('selected-task activity shows five recent business lines and keeps diagnostics collapsed',()=>{
 const logs=[{text:'GC 垃圾回收结束',level:'INFO'},...Array.from({length:6},(_,i)=>({text:`核算阶段 ${i+1} 已完成`,level:'INFO'})),{text:'配送费无法读取',level:'ERROR'}];
 const html=renderToStaticMarkup(React.createElement(PayrollTaskActivity,{logs}));
 const recent=html.slice(html.indexOf('<ol'),html.indexOf('</ol>'));
 assert.equal((recent.match(/<li/g)||[]).length,5);
 assert.match(recent,/配送费无法读取/);assert.doesNotMatch(recent,/垃圾回收|阶段 1 已完成/);
 assert.match(html,/全部业务记录/);assert.match(html,/详细诊断/);
 assert.doesNotMatch(html,/<details[^>]* open/);
});

test('legacy manual batches keep their confirmation route and upload mode is not locked by old batch mode',()=>{
 const prep:any={id:'a'.repeat(32),mode:'manual',status:'ready',plan,items:{},jobs:[]};
 const task=legacyPayrollTask(prep);assert.equal(task.status,'waiting_confirmation');assert.equal(task.batch_id,prep.id);
 const html=renderToStaticMarkup(React.createElement(FlashPayrollWorkbench,{...props,config:{payrollSourceMode:'manual'},payrollPreparation:{...prep,mode:'fengshen',status:'error',execution_logs:[{text:'配送费无法读取',level:'ERROR'}]}}));
 assert.match(html,/模板及补充资料/);assert.match(html,/选择文件夹/);assert.match(html,/配送费无法读取/);
 assert.doesNotMatch(html,/重新上传|资料下载清单|重试并继续/);
});
