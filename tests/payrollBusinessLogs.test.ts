import {test} from 'node:test';
import assert from 'node:assert/strict';
import {businessLogEntries} from '../src/lib/payrollBusinessLogs.ts';

test('business updates keep named source progress and exact failure explanations while engine noise moves to diagnostics',()=>{
  const logs=[
    {text:'[INFO] -> 🎯 成功从申请名单中提取业务城市: 深圳',level:'INFO'},
    {text:'【深圳 · delivery_fee】正在下载',level:'INFO'},
    {text:'[SYS ] >>> 即将执行 GC (垃圾回收) 释放缓存页资源...',level:'SYSTEM'},
    {text:'【深圳 · 骑手支付绑定】需要完成平台验证；未参与本次核算',level:'WARN'},
    {text:'[INFO] -> 🎯 聚合扫描完成：侦测到 870 个活动实体，结算 284745 个子流！',level:'INFO'},
    {text:'[SYS ] >>> 薪资核算完成。',level:'SYSTEM'},
  ];
  const before=JSON.stringify(logs),result=businessLogEntries(logs);
  assert.deepEqual(result.business.map(line=>line.text),['已识别城市：深圳','【深圳 · 配送费】正在下载','【深圳 · 骑手支付绑定】需要完成平台验证；未参与本次核算','核算完成，可以下载结果']);
  assert.equal(result.business[2].level,'WARN');assert.equal(result.technical.length,2);
  assert.equal(JSON.stringify(logs),before);
});

test('waiting refreshes update one row with the latest timestamp without collapsing different materials',()=>{
  const result=businessLogEntries([
    {text:'【配送费】等待平台生成文件 已等待10秒',time:'10:01'},
    {text:'MD5 source unchanged',level:'SYSTEM'},
    {text:'【配送费】等待平台生成文件 已等待20秒',time:'10:02'},
    {text:'【违规扣款】等待平台生成文件 已等待20秒',time:'10:02'},
    {text:'【配送费】下载完成',time:'10:03'},
  ]);
  assert.equal(result.business.length,3);assert.equal(result.business[0].count,2);
  assert.equal(result.business[0].time,'10:02');assert.match(result.business[0].text,/20秒/);
  assert.match(result.business[1].text,/违规扣款/);assert.match(result.business[2].text,/下载完成/);
});

test('technical errors retain a concise visible cause and the full diagnostic without leaking secrets',()=>{
  const raw='[ERRO] 执行错误退出: 配送费.csv 缺少骑手ID\nTraceback (most recent call last):\n  File "H:\\private\\processor.py", line 42, in calculate\n    raise ValueError("missing")\nValueError: 配送费.csv 缺少骑手ID';
  const result=businessLogEntries([{text:raw,level:'ERROR'}]);
  assert.equal(result.business.length,1);assert.match(result.business[0].text,/配送费.csv 缺少骑手ID/);
  assert.doesNotMatch(result.business[0].text,/Traceback|processor.py/);
  assert.equal(result.technical[0].text,raw);
  const secret=businessLogEntries([{text:'下载失败 token=private-value https://private.invalid/?signature=abc',level:'ERROR'}, {text:'Authorization: Bearer private-bearer',level:'ERROR'}, {text:'Cookie: session=private-cookie',level:'WARN'}]);
  const serialized=JSON.stringify(secret);
  for(const value of ['private-value','private.invalid','private-bearer','private-cookie'])assert(!serialized.includes(value));
  assert.match(serialized,/下载失败/);assert.match(serialized,/已隐藏/);
  const jsonSecret=JSON.stringify(businessLogEntries([{text:'认证失败 {"access_token":"private-json-token", "password": "private-json-password"}',level:'ERROR'}]));
  assert.doesNotMatch(jsonSecret,/private-json-token|private-json-password/);
  const bareTrace=businessLogEntries([{text:'Traceback (most recent call last):\n  File "H:\\processor.py", line 1\n    raise ValueError("bad")\nValueError: 配送费文件损坏',level:'ERROR'}]);
  assert.equal(bareTrace.business[0].text,'执行失败：配送费文件损坏');
});

test('legacy phases are readable, user identifiers and unknown business messages remain intact',()=>{
  const result=businessLogEntries([{msg:'资料下载：abcdef waiting_login 14%；123abc queued 0%'},{text:'骑手321522396 的申请周期为2026-10-20至2026-10-31'},{text:'新增站点已按零扣款处理',level:'WARN'}]);
  assert.doesNotMatch(result.business[0].text,/abcdef|waiting_login|14%/);assert.match(result.business[0].text,/等待平台登录/);
  assert.match(result.business[1].text,/321522396/);assert.match(result.business[1].text,/2026-10-20/);
  assert.equal(result.business[2].text,'新增站点已按零扣款处理');
});
