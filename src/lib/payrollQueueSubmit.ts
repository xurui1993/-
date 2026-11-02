import {newRequestId} from './downloadCenterLogic';

export interface QueueSubmission {
  source_path: string;
  mode: 'fengshen' | 'manual' | 'xiaoxiang';
  config: Record<string, unknown>;
  request_id: string;
}
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function queueUploadFiles(files:{file:File;relativePath:string}[],mode:string){
  // File pickers lose directory names. Distinct templates with the same basename
  // need distinct internal paths without changing their original file contents.
  return mode==='fengshen'?files.map((entry,index)=>({...entry,relativePath:`templates/${String(index+1).padStart(4,'0')}/${entry.file.name}`})):files;
}
const key=(workspace:string)=>`payroll-queue-submission:${workspace}`;
export function pendingQueueSubmission(workspace:string,storage:Store):QueueSubmission|null {
  try {
    const value=JSON.parse(storage.getItem(key(workspace))||'null');
    return value?.request_id&&value?.source_path&&['fengshen','manual','xiaoxiang'].includes(value.mode)&&value.config?value:null;
  } catch {return null;}
}
export function prepareQueueSubmission(workspace:string,payload:Omit<QueueSubmission,'request_id'>,storage:Store):QueueSubmission {
  if(pendingQueueSubmission(workspace,storage))throw Error('上一批任务提交结果尚未确认，请刷新页面查看队列后再添加。');
  const attempt:QueueSubmission=JSON.parse(JSON.stringify({...payload,request_id:newRequestId()}));
  storage.setItem(key(workspace),JSON.stringify(attempt));
  return attempt;
}
export async function sendQueueSubmission(workspace:string,attempt:QueueSubmission,apiFetch:(url:string,init?:RequestInit)=>Promise<Response>,storage:Store) {
  let response:Response;
  try {
    response=await apiFetch('/api/parttime/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(attempt)});
  } catch {throw Error('任务提交结果尚未确认，刷新页面会沿用原提交编号查询，不会重复创建任务。');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status>=400&&response.status<500)storage.removeItem(key(workspace));
    throw Error(typeof data.detail==='string'?data.detail:typeof data.error==='string'?data.error:'任务提交未完成，请刷新查看原队列。');
  }
  if(!Array.isArray(data.tasks))throw Error('任务提交结果尚未确认，请刷新页面查看原队列。');
  storage.removeItem(key(workspace));
  return data as {tasks:unknown[]};
}
