import {test} from 'node:test';
import assert from 'node:assert/strict';
import {payrollLogText} from '../src/lib/payrollLogText';
test('legacy progress is readable without presenting guessed dataset names or percentages',()=>{
 const text=payrollLogText('资料下载：abcdef waiting_login 14%；123abc queued 0%',['abcdef00','123abc00'],{'abcdef00':'normal','123abc00':'200'});
 assert.match(text,/普通站点资料：等待平台登录/);assert.match(text,/取分离站点资料：排队中/);assert.doesNotMatch(text,/abcdef|14%|queued/);
 assert.equal(payrollLogText('【配送费 · 普通资料】正在下载'),'【配送费 · 普通资料】正在下载');
});
