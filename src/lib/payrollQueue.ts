import type {PayrollPreparationState} from '../components/PayrollPreparation';

export type QueuePreparation=Pick<PayrollPreparationState,'id'|'mode'|'status'|'plan'>&Partial<PayrollPreparationState>;
export interface PayrollQueueTask {
  id: string;
  batch_id: string | null;
  mode: 'fengshen' | 'manual' | 'xiaoxiang';
  template_name: string;
  plan?: PayrollPreparationState['plan'] | null;
  status: string;
  progress?: number;
  current_action?: string;
  created_at?: string;
  elapsed_seconds?: number;
  preparation?: QueuePreparation | null;
  logs?: {text?: string; msg?: string; level?: string; time?: string}[];
  hidden?: boolean;
  legacy?: boolean;
}
export function hasFullPayrollPreparation(value?:QueuePreparation|null):value is PayrollPreparationState {
  return !!value&&!!value.items&&Array.isArray(value.jobs);
}

const STATES:Record<string,{label:string;tone:string}> = {
  queued:{label:'排队中',tone:'muted'}, preparing:{label:'准备资料',tone:'active'},
  calculating:{label:'核算中',tone:'active'}, stopping:{label:'正在停止',tone:'muted'},
  waiting_confirmation:{label:'待确认扣款',tone:'waiting'}, completed:{label:'已完成',tone:'success'},
  error:{label:'任务已结束',tone:'error'}, cancelled:{label:'已停止',tone:'muted'},
  interrupted:{label:'已中断',tone:'waiting'},
};
export function payrollQueueStatus(status:string) {return STATES[status]||{label:'处理中',tone:'muted'};}
export const payrollQueueRunning=(task:PayrollQueueTask)=>['preparing','calculating','stopping'].includes(task.status);
export const payrollModeName=(mode:string)=>mode==='manual'?'闪购手动':mode==='xiaoxiang'?'小象超市':'闪购自动';
export function payrollElapsed(seconds?:number) {
  if (!Number.isFinite(seconds) || seconds! < 0) return '';
  const value=Math.floor(seconds!);
  return value<60?`${value}秒`:`${Math.floor(value/60)}分${value%60}秒`;
}
export function legacyPayrollTask(value:PayrollPreparationState, logs:PayrollQueueTask['logs']=[], progress=0, action=''):PayrollQueueTask {
  const status=value.status==='calculated'?'completed':value.mode!=='fengshen'&&['ready','awaiting_confirmation','waiting_materials'].includes(value.status)?'waiting_confirmation':value.status==='pending_download'?'queued':value.status;
  return {id:'legacy_'+value.id,batch_id:value.id,mode:value.mode,template_name:(value.plan as any).template||`${value.plan.city}-template.xlsx`,plan:value.plan,
    status,progress,current_action:action,created_at:value.created_at,preparation:value,
    logs:[...(value.execution_logs||[]),...logs],legacy:true};
}
