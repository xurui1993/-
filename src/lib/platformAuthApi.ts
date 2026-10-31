export class PlatformAuthError extends Error {
  constructor(message: string, public readonly uncertain = false, public readonly status = 0) { super(message); this.name = 'PlatformAuthError'; }
}

/** Authentication mutations are sent once; an unconfirmed result requires a status read. */
export async function platformAuthRequest<T>(fetcher: (url: string, init?: RequestInit) => Promise<Response>, url: string, body?: object, timeoutMs = 15000): Promise<T> {
  const command = body !== undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {method:command?'POST':'GET', headers:command?{'Content-Type':'application/json'}:undefined, body:command?JSON.stringify(body):undefined, cache:'no-store', signal:controller.signal});
    let value: any;
    try {value=await response.json();} catch {throw new PlatformAuthError('认证响应未能确认，请重新读取状态；不会自动重复提交',command);}
    if (!response.ok) throw new PlatformAuthError(typeof value.detail==='string'?value.detail:typeof value.error==='string'?value.error:'认证操作未完成，请重新读取状态',command && response.status>=500,response.status);
    if(!value || typeof value!=='object' || Array.isArray(value))throw new PlatformAuthError('认证响应格式异常，请重新读取状态',command);
    return value as T;
  } catch (error) {
    if(error instanceof PlatformAuthError)throw error;
    throw new PlatformAuthError(command?'操作结果尚未确认，请重新读取状态，不要重复发送验证码或提交认证':'状态读取失败，请检查网络后重试；原会话保留',command);
  } finally {clearTimeout(timer);}
}
