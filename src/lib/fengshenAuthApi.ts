type ErrorKind = 'request' | 'endpoint' | 'service' | 'timeout' | 'network';

export class FengshenAuthApiError extends Error {
  constructor(message: string, public readonly kind: ErrorKind, public readonly status?: number) {
    super(message);
    this.name = 'FengshenAuthApiError';
  }
}

const ENDPOINT_MESSAGE = '登录接口未更新或访问地址不正确，请确认使用当前系统地址并重启主机服务';
const SERVICE_MESSAGE = '主机登录服务暂不可用，请检查主机后端服务，稍后重新检查登录状态';
const TIMEOUT_MESSAGE = '登录请求超时，操作结果尚未确认，请先重新检查登录状态，不要重复获取验证码';

function serverMessage(data: Record<string, unknown>) {
  for (const key of ['detail', 'message', 'error']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** Send a single request. Authentication commands must never retry automatically. */
export async function requestFengshenAuth<T = Record<string, any>>(
  workspaceId: string,
  path: string,
  body?: object,
  fetcher: typeof fetch = fetch,
  downloadAccount = false,
): Promise<T> {
  const command = body !== undefined;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, command ? 100000 : 8000);

  try {
    const response = await fetcher(`/api/parttime/fengshen/auth/${path}`, {
      method: command ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: {
        'x-workspace-id': encodeURIComponent(workspaceId),
        ...(downloadAccount ? { 'x-download-account': '1' } : {}),
        ...(command ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(command ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    if (response.status === 502 || response.status === 503) {
      throw new FengshenAuthApiError(SERVICE_MESSAGE, 'service', response.status);
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (response.status === 404 || !(contentType.includes('application/json') || /\+json(?:\s*;|\s*$)/.test(contentType))) {
      throw new FengshenAuthApiError(ENDPOINT_MESSAGE, 'endpoint', response.status);
    }

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch (error) {
      if (timedOut || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) throw error;
      throw new FengshenAuthApiError(ENDPOINT_MESSAGE, 'endpoint', response.status);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new FengshenAuthApiError(ENDPOINT_MESSAGE, 'endpoint', response.status);
    }
    if (!response.ok) {
      throw new FengshenAuthApiError(serverMessage(data) || `登录请求未完成（HTTP ${response.status}），请重新检查登录状态`, 'request', response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof FengshenAuthApiError) throw error;
    if (timedOut || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) {
      throw new FengshenAuthApiError(TIMEOUT_MESSAGE, 'timeout');
    }
    throw new FengshenAuthApiError('无法连接主机登录服务，请检查网络和主机服务，再重新检查登录状态', 'network');
  } finally {
    clearTimeout(timeout);
  }
}
