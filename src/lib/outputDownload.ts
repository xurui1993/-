/** Read and validate the actual response before offering a browser download. */
export async function readDownloadResponse(response: Response, filename: string): Promise<Blob> {
  if (response.status === 204) throw new Error('下载通道返回空响应（204），未取得文件；原文件仍保留，可改为逐个下载成品文件');
  if (!response.ok) throw new Error(`结果下载失败（${response.status}），文件仍保留，请检查后重新下载`);
  const type = response.headers.get('content-type')?.toLowerCase() || '';
  if (type.includes('text/html') || (type.includes('application/json') && !filename.toLowerCase().endsWith('.json')))
    throw new Error('服务返回了提示页面，未取得文件，请检查任务状态后重试');
  const blob = await response.blob();
  if (!blob.size) throw new Error('下载响应中的文件为空；原文件仍保留，请查看输出文件并逐个下载');
  const length = response.headers.get('content-length');
  if (length && !response.headers.get('content-encoding') && Number(length) !== blob.size)
    throw new Error('文件传输不完整，请重新下载；原文件仍保留');
  if (/\.(zip|xlsx)$/i.test(filename)) {
    const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (magic.length < 4 || magic[0] !== 80 || magic[1] !== 75 || !((magic[2] === 3 && magic[3] === 4) || (magic[2] === 5 && magic[3] === 6)))
      throw new Error('返回内容不是有效的压缩文件，未保存，请检查成品后重试');
  }
  return blob;
}
export function saveDownloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = objectUrl;
  link.download = filename.replace(/[\\/\x00-\x1f]/g, '_');
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); }
}
export function downloadErrorMessage(error: unknown) {
  if (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) return '下载等待超时或已取消，请重新下载；原文件仍保留';
  if (error instanceof TypeError) return '下载连接中断，请检查网络后重新下载；原文件仍保留';
  return error instanceof Error ? error.message : '下载失败，请检查任务后重试';
}
export async function downloadOutput(url: string, workspaceId: string, filename: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch) {
  try {
    const response = await fetcher(url, {headers: {'x-workspace-id': encodeURIComponent(workspaceId)}, cache: 'no-store', signal: AbortSignal.timeout(120000)});
    saveDownloadBlob(await readDownloadResponse(response, filename), filename);
  } catch (error) { throw new Error(downloadErrorMessage(error)); }
}
