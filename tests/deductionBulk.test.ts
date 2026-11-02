import assert from 'node:assert/strict';
import test from 'node:test';
import {fillUnconfigured} from '../src/lib/deductionBulk';
import type {DeductionEntry} from '../src/components/DeductionAmounts';
const make=(key:string,city='001',configured=false):DeductionEntry=>({key,station:{platform:'fengshen',city_id:city,city:'城市'+city,id:key,name:'站点'+key},row:{城市:'城市'+city,团队名称:'站点'+key,团队ID:key,安全基金:null,安全基金_maxDays:null,历史说明:'保留'},configured,zero_confirmed:false});
test('bulk fill preserves site identity, saved overrides, edited drafts and other cities',()=>{
 const source={...make('source'),edited:true,row:{...make('source').row,安全基金:25}};
 const saved={...make('saved','001',true),row:{...make('saved').row,安全基金:90}};
 const edited={...make('edited'),edited:true,row:{...make('edited').row,安全基金:18}};
 const original=[source,make('blank'),saved,edited,make('other','002')];const snapshot=JSON.stringify(original);
 const result=fillUnconfigured(original,source,['安全基金','安全基金_maxDays']);
 assert.equal(result[1].row.安全基金,25);assert.equal(result[1].row.团队ID,'blank');assert.equal(result[1].row.历史说明,'保留');assert.equal(result[1].row.安全基金_maxDays,null);
 assert.equal(result[2],saved);assert.equal(result[3],edited);assert.equal(result[4],original[4]);assert.equal(JSON.stringify(original),snapshot);
});
test('selected synchronization only fills selected targets and preserves explicit zero acknowledgement',()=>{
 const source={...make('source'),zero_confirmed:true,row:{...make('source').row,安全基金:0}};
 const rows=[source,make('a'),make('b')];const result=fillUnconfigured(rows,source,['安全基金'],new Set(['b']));
 assert.equal(result[1],rows[1]);assert.equal(result[2].row.安全基金,0);assert.equal(result[2].zero_confirmed,true);
});
