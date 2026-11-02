export type AuthDraftField={id:string;type:string;role?:string};
export type AuthDraftScope={source:string;sessionId:string;fields:AuthDraftField[];captchaId?:string};
export function reconcileAuthDraft(values:Record<string,string>,previous:AuthDraftScope|undefined,next:AuthDraftScope):Record<string,string>{
  if(!previous||previous.source!==next.source||previous.sessionId!==next.sessionId)return {};
  const old=new Map(previous.fields.map(field=>[field.id,field]));
  return Object.fromEntries(next.fields.flatMap(field=>{
    const before=old.get(field.id);
    if(!before||before.type!==field.type||before.role!==field.role||values[field.id]===undefined)return [];
    if(field.role==='math'&&previous.captchaId!==next.captchaId)return [];
    return [[field.id,values[field.id]]];
  }));
}
