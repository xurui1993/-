export const FLOW_STEPS = ['选择业务','确认范围','处理资料','领取结果'];
export function flowStep(status: string) {
 if (['success','calculated'].includes(status)) return 3;
 if (status === 'create') return 0;
 if (status === 'review') return 1;
 return 2;
}
export const needsAction = (status: string) => ['queued','running','waiting_login','waiting_manual','cancelling','preparing','pending_download','waiting_materials','ready','error','partial','interrupted'].includes(status);
export function prioritizeTasks<T extends {status: string; member_ids?: string[]}>(records: T[], selectedId: string): T[] {
 const rank=(item:T)=>item.member_ids?.includes(selectedId)?0:needsAction(item.status)?1:2;
 return records.map((item,index)=>({item,index})).sort((a,b)=>rank(a.item)-rank(b.item)||a.index-b.index).map(x=>x.item);
}
