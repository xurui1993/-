import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DeductionAmounts} from '../src/components/DeductionAmounts';
import {stationCountText,type StationDirectory} from '../src/lib/useStationDirectory';
test('unknown station counts stay distinct from verified zero, ambiguous city names stay unresolved',()=>{
 const d={cities:[{id:'1',name:'甲',station_count:0,status:'ready'},{id:'2',name:'乙',station_count:null,status:'pending'}]} as StationDirectory;
 assert.equal(stationCountText(d,'1'),'0站');assert.equal(stationCountText(d,'乙'),'待同步');assert.equal(stationCountText(null,'甲'),'待同步');
 assert.equal(stationCountText({...d,cities:[...d.cities,{id:'3',name:'甲',station_count:9,status:'ready'}]},'甲'),'待同步');
});
test('deduction editor distinguishes pending values, explicit zero and long station IDs',()=>{
 const html=renderToStaticMarkup(React.createElement(DeductionAmounts,{entries:[{key:'x',station:{platform:'xiaoxiang',id:'9007199254740993123',city_id:'001',city:'测试城',name:'测试站'},row:{城市:'测试城',团队名称:'测试站',团队ID:'9007199254740993123',安全基金:null},configured:false,zero_confirmed:false}],columns:['安全基金'],onChange:()=>{}}));
 assert.match(html,/待配置/);assert.match(html,/待填写/);assert.match(html,/确认本站零扣款/);assert.match(html,/保险费（安全基金）/);assert.match(html,/9007199254740993123/);
 assert.doesNotMatch(html,/checked=""/);
});
