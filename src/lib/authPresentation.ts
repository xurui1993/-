export function loginStatus(value:{state?:string;offline?:boolean;busy?:boolean;cancelling?:boolean;release_state?:string}){
  if(value.offline)return '状态暂不可用';
  if(value.cancelling)return '退出中';
  if(['releasing','timeout','terminated','unconfirmed'].includes(value.release_state || ''))return '登录中';
  if(value.state==='ready')return '已登录';
  if(['starting','checking','refreshing','sending','verifying'].includes(value.state || ''))return '登录中';
  if(['waiting_login','sms_sent','manual_required'].includes(value.state || '') || (value.state==='login_required' && value.busy))return '待验证';
  if(value.state==='saved')return '待验证';
  if(value.state==='partial')return '部分可用';
  if(value.state==='unknown')return '状态待确认';
  return '未登录';
}
export function platformLoginLabel(source:string,value:{state?:string;saved?:boolean;busy?:boolean}){
  return '登录';
}
