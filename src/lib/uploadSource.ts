/** One upload request, with real browser transfer progress and no automatic retry. */
export function uploadSource(url: string, body: FormData, workspaceId: string, onProgress: (percent: number | null) => void, onSent: () => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.setRequestHeader('x-workspace-id', encodeURIComponent(workspaceId));
    request.upload.onprogress = event => onProgress(event.lengthComputable && event.total > 0 ? Math.min(100, Math.round(event.loaded / event.total * 100)) : null);
    request.upload.onload = () => onSent();
    request.onerror = () => reject(new Error('上传连接中断，未确认服务器接收状态，请先检查资料。'));
    request.onabort = () => reject(new Error('上传已中断，请检查资料后重试。'));
    request.onload = () => {
      const headers = new Headers();
      request.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
        const split = line.indexOf(':');
        if (split > 0) headers.append(line.slice(0, split).trim(), line.slice(split + 1).trim());
      });
      resolve(new Response(request.responseText, { status: request.status, headers }));
    };
    request.send(body);
  });
}
