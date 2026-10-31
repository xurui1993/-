import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadSource } from '../src/lib/uploadSource';

class RequestStub {
  static last: RequestStub;
  headers: Record<string,string> = {}; upload: any = {}; method = ''; url = ''; sends = 0; body: any;
  status = 200; responseText = '{"success":true}'; onload: any; onerror: any; onabort: any;
  constructor() { RequestStub.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  getAllResponseHeaders() { return 'content-type: application/json\r\nx-test: one\r\n'; }
  send(body: unknown) { this.sends++; this.body = body; }
}
function setup(t: any) {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = RequestStub as any;
  t.after(() => { globalThis.XMLHttpRequest = original; });
}
test('source upload sends once with workspace identity and waits for actual upload completion', async t => {
  setup(t); const progress: (number|null)[] = []; let sent = false; const body = new FormData();
  const result = uploadSource('/api/upload/source_zip', body, '中文 workspace', value => progress.push(value), () => {sent = true;});
  const request = RequestStub.last;
  assert.equal(request.sends,1); assert.equal(request.body,body); assert.equal(request.method,'POST');
  assert.equal(request.headers['x-workspace-id'],encodeURIComponent('中文 workspace')); assert.equal(sent,false);
  request.upload.onprogress({lengthComputable:true,total:10,loaded:4}); assert.deepEqual(progress,[40]); assert.equal(sent,false);
  request.upload.onload(); assert.equal(sent,true); request.onload();
  const response = await result; assert.equal(response.headers.get('content-type'),'application/json'); assert.deepEqual(await response.json(),{success:true});
});
test('unknown transfer totals stay indeterminate and HTTP failure details are preserved', async t => {
  setup(t); const progress: (number|null)[] = [];
  const result = uploadSource('/api/upload/source_zip',new FormData(),'scope',value => progress.push(value),() => {});
  const request = RequestStub.last; request.upload.onprogress({lengthComputable:false,total:0,loaded:20});
  request.status = 413; request.responseText = '{"error":"too large"}'; request.onload();
  const response = await result; assert.equal(response.status,413); assert.deepEqual(await response.json(),{error:'too large'}); assert.deepEqual(progress,[null]); assert.equal(request.sends,1);
});
test('interrupted uploads report unconfirmed state without automatic resubmission', async t => {
  setup(t); const result = uploadSource('/api/upload/source_zip',new FormData(),'scope',() => {},() => {});
  const request = RequestStub.last; request.onerror(); await assert.rejects(result,/未确认/); assert.equal(request.sends,1);
});
