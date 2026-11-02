import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PayrollDownloadProgress} from '../src/components/PayrollDownloadProgress';
import type {PayrollPreparationState} from '../src/components/PayrollPreparation';
const value:PayrollPreparationState={id:'test',mode:'fengshen',status:'preparing',jobs:['run'],plan:{city:'测试城',start:'2026-10-01',end:'2026-10-15',month:'2026-10',applicants:1},items:{fee:{label:'配送费',status:'pending'}},downloads:[{key:'fee',label:'配送费',status:'running',detail:'等待平台生成文件',completed_groups:1,total_groups:2,groups:[{scope:'normal',label:'普通资料',status:'success',detail:'文件已下载',files:['配送费.csv']},{scope:'200',label:'取分离资料',status:'running',detail:'等待平台生成文件',files:[]}]}]};
test('download list shows committed groups and actual phase without invented percentage',()=>{
 const html=renderToStaticMarkup(React.createElement(PayrollDownloadProgress,{value}));
 assert.match(html,/资料下载清单/);assert.match(html,/等待平台生成文件/);assert.match(html,/1\/2 组已下载/);assert.match(html,/配送费.csv/);assert.doesNotMatch(html,/%/);
 assert.match(html,/已校验 0 项/);
});
test('completed input list shows verified completion and keeps delayed processing distinct',()=>{
 const html=renderToStaticMarkup(React.createElement(PayrollDownloadProgress,{value:{...value,status:'calculating',downloads:value.downloads!.map(v=>({...v,status:'ready',detail:'已下载并校验'}))}}));
 assert.match(html,/已下载 1 \/ 1 项/);assert.match(html,/正在核算/);assert.match(html,/已下载并校验/);
});
