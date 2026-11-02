import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {StationAssociations} from '../src/components/StationAssociations';
import {commonChoices,keepAssociationDraft,recommendedKey} from '../src/lib/stationAssociations';
import type {DeductionEntry,StationAssociation} from '../src/components/DeductionAmounts';

const choice=(key:string):DeductionEntry=>({key,station:{id:key,name:`站点${key}`,city:'深圳',city_id:'1',platform:'fengshen'},row:{},configured:false,zero_confirmed:false});
test('uncertain name ranking stays unselected; batch target must be valid for every selected alias',()=>{
  const row:StationAssociation={name:'别名',reason:'名称推荐',candidates:['a','b'],recommendations:[{key:'a',score:.9,reason:''},{key:'b',score:.88,reason:''}]};
  assert.equal(recommendedKey(row),'');
  assert.deepEqual(commonChoices([row,{name:'取分离',reason:'',candidates:['c']}],[choice('a'),choice('c')]),[]);
  assert.deepEqual(commonChoices([row,{name:'另一个名称',reason:'',candidates:['b']}],[choice('a'),choice('b')]).map(e=>e.key),['b']);
});
test('refresh keeps eligible draft choices and drops targets no longer in the verified directory',()=>{
  const rows:StationAssociation[]=[{name:'已确认',key:'a',status:'resolved',reason:'历史已确认',candidates:['a']},{name:'待确认',reason:'',candidates:['b']},{name:'目录移除',reason:'',candidates:[]}];
  assert.deepEqual(keepAssociationDraft(rows,{'已确认':'x','待确认':'b','目录移除':'a'}),{'已确认':'a','待确认':'b','目录移除':''});
});
test('compact association table exposes recommendations without claiming them confirmed',()=>{
  const html=renderToStaticMarkup(React.createElement(StationAssociations,{data:{entries:[],columns:[],version:'v',station_choices:[choice('a')],association_reusable:true,association_rows:[{name:'申请别名',status:'unresolved',reason:'待确认',candidates:['a'],recommendations:[{key:'a',score:.95,reason:'名称相似'}]}]},disabled:false,onSync:()=>{},onConfirm:async()=>{}}));
  assert.match(html,/<table/);assert.match(html,/搜索申请或后台站点/);assert.match(html,/名称推荐 · 待确认/);assert.match(html,/确认所选关联（0）/);assert.match(html,/保存关联，后续核算沿用/);assert.match(html,/选择当前页站点/);
});
