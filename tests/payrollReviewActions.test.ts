import assert from 'node:assert/strict';
import test from 'node:test';
import {deductionIssues,applyCityAmounts,nextReviewAction} from '../src/lib/payrollReviewActions';
import type {DeductionEntry,DeductionDraft} from '../src/components/DeductionAmounts';
const entry=(key:string,amount:number|null=25):DeductionEntry=>({key,station:{platform:'fengshen',city:'测试城',city_id:'001',id:key,name:key},row:{城市:'测试城',团队名称:key,团队ID:key,安全基金:amount,安全基金_maxDays:null},configured:false,zero_confirmed:false});
const draft=(patch:Partial<DeductionDraft>={}):DeductionDraft=>({entries:[entry('a')],columns:['安全基金','安全基金_maxDays'],version:'v1',unresolved:[],differences:[],...patch});
test('next action progresses through separation, associations, amounts, differences and execution',()=>{
 const value=draft({separation_stations:['取分离'],separation_enabled:false,unresolved:[{name:'x',reason:'missing'}]});
 assert.equal(nextReviewAction(value,[entry('a',null)],[],'fengshen').kind,'separation');value.separation_enabled=true;
 assert.equal(nextReviewAction(value,[entry('a',null)],[],'fengshen').label,'处理站点关联（1）');value.unresolved=[];
 assert.equal(nextReviewAction(value,[entry('a',null)],[],'fengshen').kind,'amounts');
 value.differences=[{id:'d',row:2,application:'x',bill:['y'],reason:'差异'}];
 assert.equal(nextReviewAction(value,[entry('a')],[],'fengshen').kind,'differences');assert.equal(nextReviewAction(value,[entry('a')],['d'],'fengshen').kind,'execute');
});
test('zero requires explicit acknowledgement while nullable thresholds retain original meaning',()=>{
 assert.equal(deductionIssues(entry('a',0),draft().columns).zero,true);
 assert.deepEqual(deductionIssues({...entry('a',0),zero_confirmed:true},draft().columns),{fields:[],zero:false});
 assert.deepEqual(deductionIssues(entry('a'),draft().columns),{fields:[],zero:false});
 assert.deepEqual(deductionIssues(entry('a',NaN),draft().columns).fields,['安全基金']);
});
test('city edits apply automatically to inherited and unconfigured entries without replacing site exceptions or edited drafts',()=>{
 const city={...entry('*',35),edited:true};const rows=[entry('new'),{...entry('inherited'),configured:true,inherited_city:true},{...entry('override',90),configured:true},{...entry('edited',18),edited:true}];
 const result=applyCityAmounts(rows,[city],draft().columns);
 assert.equal(result[0].row.安全基金,35);assert.equal(result[1].row.安全基金,35);assert.equal(result[2],rows[2]);assert.equal(result[3],rows[3]);
 assert.equal(rows[0].row.安全基金,25);
 assert.equal(applyCityAmounts(rows,[{...city,row:{...city.row,安全基金:null}}],draft().columns)[0],rows[0]);
});
