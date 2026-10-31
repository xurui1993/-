import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DeductionStationPicker} from '../src/components/DeductionStationPicker';
import type {DeductionRow} from '../src/lib/workbench';
import {filterStations,requestStationCatalog,selectDeductionStation,stationCatalogUrl,stationCityOptions,stationCitySelection,stationIdentity,validateStationCatalog,type DeductionStation} from '../src/lib/deductionStations';

const station:DeductionStation={id:'000123456789012345678',name:'测试站',city:'合成市',city_id:'001',platform:'fengshen'};
const catalog=(stations:DeductionStation[]=[station])=>({platform:'fengshen',cities:[{id:'001',name:'合成市'}],stations,fetched_at:'2026-11-01T00:00:00Z',cached:false,scope_note:'当前账号该城市可查询站点',warnings:[]});

test('catalogue preserves long textual IDs and distinguishes same-name stations by identity',()=>{
  const other={...station,id:'0002'};
  const result=validateStationCatalog(catalog([station,other]),'fengshen');
  assert.equal(result.stations[0].id,station.id);
  assert.equal(result.stations.length,2);
  assert.notEqual(stationIdentity(station),stationIdentity(other));
  assert.equal(filterStations(result.stations,'0002')[0].id,'0002');
  assert.equal(filterStations(result.stations,'测试站').length,2);
  assert.equal(filterStations(result.stations,'合成市').length,2);
});

test('unverified numeric IDs, conflicting metadata and a mismatched platform fail closed',()=>{
  assert.throws(()=>validateStationCatalog(catalog([{...station,id:123} as unknown as DeductionStation]),'fengshen'),/编号或归属/);
  assert.throws(()=>validateStationCatalog(catalog([station,{...station,name:'另一个名称'}]),'fengshen'),/不同名称或城市/);
  assert.throws(()=>validateStationCatalog(catalog(),'xiaoxiang'),/当前平台不一致/);
  assert.equal(validateStationCatalog(catalog([station,station]),'fengshen').stations.length,1);
});

test('choosing a station updates only metadata and leaves all financial values and other rows unchanged',()=>{
  const rows:DeductionRow[]=[{城市:'历史城',团队名称:'旧站点',团队ID:'old',保险:3.5,开关:true,说明:'原样保留'}, {城市:'其他城',团队名称:'历史站',团队ID:'009',保险:8}];
  const before=structuredClone(rows);
  const selected=selectDeductionStation(rows,0,station);
  assert.deepEqual(rows,before);
  assert.deepEqual(selected[0],{...before[0],城市:station.city,团队名称:station.name,团队ID:station.id});
  assert.equal(selected[1],rows[1]);
  assert.equal('platform' in selected[0],false);
});

test('same names across cities or a same-city ID conflict are blocked without rewriting historical rules',()=>{
  for(const row of [
    {城市:station.city,团队名称:station.name,团队ID:'different-id'},
    {城市:station.city,团队名称:'不同名称',团队ID:station.id},
    {城市:'其他城',团队名称:station.name,团队ID:'unrelated-id'},
    {城市:'其他城',团队名称:` ${station.name} `,团队ID:'unrelated-id'},
  ])assert.throws(()=>selectDeductionStation([row],null,station,{保险:0}),/同名站点配置|相同站点编号/);
  assert.doesNotThrow(()=>selectDeductionStation([{城市:'其他城',团队名称:'别的站点',团队ID:station.id}],null,station));
  assert.doesNotThrow(()=>selectDeductionStation([{城市:station.city,团队名称:station.name,团队ID:station.id}],0,station));
  const legacy:DeductionRow={城市:'历史城',团队名称:'测试站_新专送',团队ID:'different-id',保险:9};
  const before=structuredClone(legacy);
  assert.throws(()=>selectDeductionStation([legacy],null,station),/核算等价站点名称/);
  assert.throws(()=>selectDeductionStation([{...legacy,团队名称:'测试站'}],null,{...station,name:'测试站新专送'}),/核算等价站点名称/);
  assert.throws(()=>selectDeductionStation([{...legacy,团队名称:'测试_新专送站新专送'}],null,station),/核算等价站点名称/);
  assert.deepEqual(legacy,before);
  assert.equal(selectDeductionStation([legacy],0,station)[0]['团队名称'],station.name);
});

test('same-name cities retain distinct IDs and requests send the selected ID instead of an ambiguous name',()=>{
  const cities=[{id:'agency-001',name:'同名城市'},{id:'agency-002',name:'同名城市'}];
  const options=stationCityOptions(cities);
  assert.deepEqual(options.map(option=>option.value),['agency-001','agency-002']);
  assert.match(options[0].label,/agency-001/);
  assert.match(options[1].label,/agency-002/);
  assert.equal(stationCitySelection('同名城市',cities),'');
  assert.equal(stationCitySelection('agency-002',cities),'agency-002');
  const request=new URL(stationCatalogUrl('fengshen',options[1].value),'http://localhost');
  assert.equal(request.searchParams.get('city'),'agency-002');
  assert.equal(options.filter(option=>option.value==='同名城市').length,0);
  assert.equal(options.find(option=>option.value==='历史配置城'),undefined);
});

test('only cities verified by the current directory can remain selected after a directory or session change',()=>{
  assert.equal(stationCitySelection('合成市',[{id:'001',name:'合成市'}]),'001');
  assert.equal(stationCitySelection('历史未查到城市',[{id:'001',name:'合成市'}]),'');
  assert.equal(stationCitySelection('北京',[{id:'002',name:'北京市'}]),'');
  assert.equal(stationCitySelection('001',[]),'');
  assert.equal(stationCitySelection('001',[{id:'002',name:'合成市'}]),'');
  assert.equal(stationCitySelection('',[{id:'002',name:'合成市'}]),'');
  assert.deepEqual(stationCityOptions([]),[]);
  assert.throws(()=>validateStationCatalog({...catalog(),cities:[{id:'001',name:'甲城'},{id:'001',name:'乙城'}]},'fengshen'),/同一城市编号/);
});

test('adding a platform station creates a draft using defaults without touching historical rows',()=>{
  const rows=[{城市:'历史城',团队名称:'已停用但保留的站点',团队ID:'009',保险:7}];
  const added=selectDeductionStation(rows,null,station,{保险:0,投诉:0});
  assert.equal(rows.length,1);
  assert.equal(added[0],rows[0]);
  assert.deepEqual(added[1],{保险:0,投诉:0,城市:station.city,团队名称:station.name,团队ID:station.id});
  assert.throws(()=>selectDeductionStation(rows,null,{...station,city:''}),/缺少城市或编号/);
  assert.throws(()=>selectDeductionStation(rows,10,station),/配置行已变化/);
});

test('directory requests are read-only, encoded and can explicitly bypass cache',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const fetcher=async(url:string,init?:RequestInit)=>{calls.push({url,init});return new Response(JSON.stringify(catalog()),{status:200});};
  const result=await requestStationCatalog(fetcher,'fengshen',' 合成市 ',true);
  const url=new URL(calls[0].url,'http://localhost');
  assert.equal(url.pathname,'/api/workbench/deduction-stations');
  assert.equal(url.searchParams.get('city'),'合成市');
  assert.equal(url.searchParams.get('platform'),'fengshen');
  assert.equal(url.searchParams.get('refresh'),'1');
  assert.equal(calls[0].init?.method,undefined);
  assert.equal(result.stations[0].id,station.id);
  assert.equal(new URL(stationCatalogUrl('xiaoxiang',''),'http://localhost').searchParams.has('refresh'),false);
});

test('login errors remain actionable instead of being represented as an empty successful directory',async()=>{
  await assert.rejects(()=>requestStationCatalog(async()=>new Response(JSON.stringify({detail:'请先登录风神'}),{status:401}),'fengshen','合成市'),/请先登录风神/);
  await assert.rejects(()=>requestStationCatalog(async()=>new Response('<html>login</html>',{status:200}),'fengshen','合成市'),/格式无效/);
});

test('picker exposes manual recovery and read-only controls without triggering requests on render',()=>{
  let requests=0;
  const html=renderToStaticMarkup(React.createElement(DeductionStationPicker,{apiFetch:async()=>{requests++;return new Response();},current:{city:'历史城',name:'历史站',id:'001'},disabled:true,onSelect:()=>{},onClose:()=>{},onManual:()=>{}}));
  assert.equal(requests,0);
  assert.match(html,/历史站/);
  assert.match(html,/不代表历史配置已失效/);
  assert.match(html,/手动填写/);
  assert.match(html,/平台登录/);
  assert.match(html,/<select[^>]*aria-label="站点来源平台"[^>]*disabled/);
  assert.match(html,/<button[^>]*disabled[^>]*>手动填写/);
  for(const platform of ['fengshen','xiaoxiang'] as const){
    const initial=renderToStaticMarkup(React.createElement(DeductionStationPicker,{platform,apiFetch:async()=>{requests++;return new Response();},current:{city:'北京',name:'历史站',id:'old-account-id'},onSelect:()=>{},onClose:()=>{},onManual:()=>{}}));
    const citySelect=initial.match(/<select[^>]*aria-label="后台站点城市"[^>]*>[\s\S]*?<\/select>/)?.[0];
    assert.ok(citySelect);
    assert.match(citySelect,/<select[^>]*disabled/);
    assert.equal((citySelect.match(/<option/g)||[]).length,1);
    assert.match(citySelect,/<option value="" selected="">/);
    assert.doesNotMatch(citySelect,/北京|old-account-id/);
    assert.match(initial,/当前配置：北京 · 历史站/);
    assert.match(initial,platform==='fengshen'?/获取城市列表/:/获取站点/);
  }
  assert.equal(requests,0);
});
