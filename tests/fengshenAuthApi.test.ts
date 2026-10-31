import assert from 'node:assert/strict';
import test from 'node:test';
import { FengshenAuthApiError, requestFengshenAuth } from '../src/lib/fengshenAuthApi.ts';

function jsonResponse(payload: unknown, status = 200, contentType = 'application/json') {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': contentType } });
}

function mockFetch(response: Response | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetcher };
}

test('status uses same-origin route and encoded workspace without a request body', async () => {
  const mock = mockFetch(jsonResponse({ state: 'ready', saved: true }));
  const result = await requestFengshenAuth('测试小组', 'status', undefined, mock.fetcher);
  assert.equal(result.state, 'ready');
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].url, '/api/parttime/fengshen/auth/status');
  assert.equal(mock.calls[0].init?.method, 'GET');
  assert.equal(mock.calls[0].init?.credentials, 'same-origin');
  assert.equal(new Headers(mock.calls[0].init?.headers).get('x-workspace-id'), encodeURIComponent('测试小组'));
  assert.equal(mock.calls[0].init?.body, undefined);
  assert.ok(mock.calls[0].init?.signal instanceof AbortSignal);
});

test('command posts JSON exactly once and preserves logical failure result', async () => {
  const mock = mockFetch(jsonResponse({ ok: false, message: '验证码已发送，请勿重复获取' }));
  const result = await requestFengshenAuth('tester', 'send', { challenge_id: 'mock-challenge', phone: 'mock-phone' }, mock.fetcher);
  assert.equal(result.ok, false);
  assert.equal(result.message, '验证码已发送，请勿重复获取');
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].init?.method, 'POST');
  assert.equal(new Headers(mock.calls[0].init?.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(String(mock.calls[0].init?.body)), { challenge_id: 'mock-challenge', phone: 'mock-phone' });
});

for (const entry of [
  { status: 400, payload: { detail: '缺少有效工作区标识' }, expected: '缺少有效工作区标识' },
  { status: 403, payload: { detail: '不允许外部网页操作主机会话', message: '其他消息' }, expected: '不允许外部网页操作主机会话' },
  { status: 409, payload: { message: '另一工作区正在使用会话，请等待其结束' }, expected: '另一工作区正在使用会话，请等待其结束' },
  { status: 415, payload: { detail: '登录请求必须使用 JSON' }, expected: '登录请求必须使用 JSON' },
  { status: 401, payload: { error: '登录已过期' }, expected: '登录已过期' },
]) {
  test(`HTTP ${entry.status} preserves the server reason`, async () => {
    const mock = mockFetch(jsonResponse(entry.payload, entry.status));
    await assert.rejects(requestFengshenAuth('tester', 'status', undefined, mock.fetcher), error => {
      assert.ok(error instanceof FengshenAuthApiError);
      assert.equal(error.message, entry.expected);
      assert.equal(error.status, entry.status);
      assert.equal(error.kind, 'request');
      return true;
    });
    assert.equal(mock.calls.length, 1);
  });
}

test('JSON problem detail is accepted for permission errors', async () => {
  const mock = mockFetch(jsonResponse({ detail: '访问来源不允许' }, 403, 'application/problem+json; charset=utf-8'));
  await assert.rejects(requestFengshenAuth('tester', 'status', undefined, mock.fetcher), /访问来源不允许/);
});

for (const entry of [
  { name: '404 JSON', response: () => jsonResponse({ detail: 'Not Found' }, 404) },
  { name: 'HTML fallback', response: () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }) },
  { name: 'malformed JSON', response: () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }) },
  { name: 'unexpected JSON array', response: () => jsonResponse([]) },
]) {
  test(`${entry.name} reports interface/address mismatch`, async () => {
    const mock = mockFetch(entry.response());
    await assert.rejects(requestFengshenAuth('tester', 'status', undefined, mock.fetcher), error => {
      assert.ok(error instanceof FengshenAuthApiError);
      assert.equal(error.kind, 'endpoint');
      assert.match(error.message, /接口未更新或访问地址不正确/);
      return true;
    });
  });
}

for (const entry of [
  { status: 502, response: () => jsonResponse({ error: 'Backend starting up or unavailable.' }, 502) },
  { status: 503, response: () => new Response('Service unavailable', { status: 503 }) },
]) {
  test(`HTTP ${entry.status} identifies unavailable backend`, async () => {
    const mock = mockFetch(entry.response());
    await assert.rejects(requestFengshenAuth('tester', 'status', undefined, mock.fetcher), error => {
      assert.ok(error instanceof FengshenAuthApiError);
      assert.equal(error.kind, 'service');
      assert.equal(error.status, entry.status);
      assert.match(error.message, /主机登录服务暂不可用/);
      return true;
    });
  });
}

for (const name of ['AbortError', 'TimeoutError']) {
  test(`${name} leaves command result unconfirmed and never retries`, async () => {
    const error = new Error('mock timeout');
    error.name = name;
    const mock = mockFetch(error);
    await assert.rejects(requestFengshenAuth('tester', 'send', { challenge_id: 'mock' }, mock.fetcher), failure => {
      assert.ok(failure instanceof FengshenAuthApiError);
      assert.equal(failure.kind, 'timeout');
      assert.match(failure.message, /操作结果尚未确认/);
      assert.match(failure.message, /不要重复获取验证码/);
      return true;
    });
    assert.equal(mock.calls.length, 1);
  });
}

test('network failure gives connection guidance without repeating a command', async () => {
  const mock = mockFetch(new TypeError('Failed to fetch'));
  await assert.rejects(requestFengshenAuth('tester', 'start', {}, mock.fetcher), error => {
    assert.ok(error instanceof FengshenAuthApiError);
    assert.equal(error.kind, 'network');
    assert.match(error.message, /检查网络和主机服务/);
    return true;
  });
  assert.equal(mock.calls.length, 1);
});


test('download account uses cookie scope header and retains existing payroll scope behavior', async () => {
  const mock = mockFetch(jsonResponse({ state: 'ready' }));
  await requestFengshenAuth('测试小组', 'status', undefined, mock.fetcher, true);
  const headers = new Headers(mock.calls[0].init?.headers);
  assert.equal(headers.get('x-download-account'), '1');
  assert.equal(mock.calls[0].init?.credentials, 'same-origin');
  assert.equal(mock.calls[0].url, '/api/parttime/fengshen/auth/status');
  assert.equal(mock.calls[0].init?.body, undefined);
  const payroll = mockFetch(jsonResponse({ state: 'ready' }));
  await requestFengshenAuth('测试小组', 'status', undefined, payroll.fetcher);
  assert.equal(new Headers(payroll.calls[0].init?.headers).has('x-download-account'), false);
});
