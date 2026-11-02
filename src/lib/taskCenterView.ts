/** Explain unsupported selections instead of silently dropping business tasks. */
export function batchDownloadBlocker(tasks:{kind:string;available_files:number}[]) {
  if(tasks.length>20)return '每次最多领取20个资料或报表任务，请减少选择。';
  if(tasks.some(task=>!['download','generate','payroll_source'].includes(task.kind)))return '资料与报表可一起领取；薪资请进入核算队列批量下载，价格结果请单独领取。';
  if(tasks.some(task=>task.available_files<1))return '选中任务中有尚无可用结果的任务，请调整选择。';
  return '';
}
