import React,{useEffect,useRef,useState} from 'react';
import {platformAuthRequest,PlatformAuthError} from '../lib/platformAuthApi';
import {OfficialVerification} from './OfficialVerification';
import {reconcileAuthDraft,type AuthDraftScope} from '../lib/authInputDraft';

type Field={id:string;type:string;label:string;role?:string;filled:boolean};
type Control={issuer?:string;id:string;label:string;kind:string;enabled?:boolean;retry_after?:number};
export type DesktopAuth={window_visible?:boolean;lighthouse_reused?:boolean;board_reused?:boolean;login_mode?:'qr'|'sms';has_qr?:boolean;qr_stage?:'lighthouse'|'board';qr_state?:string;qr_version?:string;has_challenge?:boolean;challenge_id?:string;challenge_version?:string;form_detection?:string;official_feedback?:string;official_feedback_kind?:string;official_feedback_detail?:string;input_seq?:number;input_completed?:number;input_pending?:boolean;form_id?:string;fields?:Field[];controls?:Control[];input_error?:string;input_result?:string;sms_retry_after?:number;consent_auto?:boolean;math_captcha?:{field_id:string;id?:string;state:string;image?:string;expression?:string;answer?:string}};

function fieldLabel(field:Field){
  return ({phone:'手机号码',password:'密码',sms_code:'短信验证码',voice_code:'语音验证码',math:'算式答案'} as Record<string,string>)[field.role || ''] || (field.type==='checkbox'?field.label: /[\u4e00-\u9fff]/.test(field.label)?field.label.replace(/^请输入|^请填写/,'').slice(0,24):'账号');
}

export function SourceLoginPanel({source,sessionId,apiFetch,desktop={}}:{source:string;sessionId:string;desktop?:DesktopAuth;apiFetch:(url:string,init?:RequestInit)=>Promise<Response>}){
  const fetchRef=useRef(apiFetch);fetchRef.current=apiFetch;
  const [values,setValues]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const [lastCommand,setLastCommand]=useState(0),[lastSms,setLastSms]=useState(0),[seconds,setSeconds]=useState(0);
  const [qr,setQr]=useState({key:'',url:'',error:''});
  const [qrRetry,setQrRetry]=useState(0);
  const deadline=useRef(0),inflight=useRef(false),issuer=useRef<string|undefined>(undefined);
  const fields=desktop.fields || [],controls=desktop.controls || [];
  const previousDraft=useRef<AuthDraftScope|undefined>(undefined);
  const fieldShape=JSON.stringify(desktop.fields?.map(({id,type,role})=>({id,type,role})));
  const sms=controls.find(c=>c.kind==='sms'),submit=controls.find(c=>c.kind==='submit');
  const captcha=desktop.math_captcha;
  const consentField=fields.find(f=>f.role==='consent'),voiceField=fields.find(f=>f.role==='voice_code');
  const boardQr=source==='xiaoxiang' && !!desktop.has_qr && desktop.qr_stage==='board';
  const lighthouseQr=source==='xiaoxiang' && !!desktop.has_qr && !boardQr;
  const qrMode=source==='lanorange' || boardQr || lighthouseQr;
  const qrKey=qrMode && desktop.has_qr && desktop.qr_version?sessionId+':'+desktop.qr_version:'';
  const refresh=controls.find(c=>c.kind==='qr_refresh');
  useEffect(()=>{setValues({});setError('');setUncertain(false);setLastCommand(0);setLastSms(0);},[source,sessionId]);
  useEffect(()=>{
    // form_id authorizes commands, but captcha/control revisions are not a new password field.
    // A poll without field metadata must not erase the user's unfinished draft.
    if(desktop.fields===undefined)return;
    const next:AuthDraftScope={source,sessionId,fields:desktop.fields,captchaId:desktop.math_captcha?.id};
    const previous=previousDraft.current;
    setValues(values=>reconcileAuthDraft(values,previous,next));previousDraft.current=next;
  },[source,sessionId,fieldShape,desktop.math_captcha?.id]);
  useEffect(()=>{if(issuer.current!==sms?.issuer){deadline.current=0;issuer.current=sms?.issuer;}deadline.current=Math.max(deadline.current,Date.now()+1000*Math.max(desktop.sms_retry_after || 0,sms?.retry_after || 0));},[desktop.sms_retry_after,sms?.retry_after,sms?.issuer]);
  useEffect(()=>{const tick=()=>setSeconds(Math.max(0,Math.ceil((deadline.current-Date.now())/1000)));tick();const timer=setInterval(tick,500);return()=>clearInterval(timer);},[]);
  const endpoint=`/api/fengshen-downloads/source-auth/${source}`;
  useEffect(()=>{
    if(!qrKey){setQr({key:'',url:'',error:''});return;}
    let disposed=false,objectUrl='';const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10000);
    void (async()=>{
      try{
        const response=await fetchRef.current(`${endpoint}/qr?session_id=${encodeURIComponent(sessionId)}&v=${encodeURIComponent(desktop.qr_version || '')}`,{cache:'no-store',signal:controller.signal});
        if(!response.ok || !response.headers.get('content-type')?.startsWith('image/png'))throw new Error('二维码暂未就绪，正在等待更新。');
        const blob=await response.blob();if(!blob.size || blob.size>512*1024)throw new Error('二维码暂不可用，请重新读取。');
        if(!disposed){objectUrl=URL.createObjectURL(blob);setQr({key:qrKey,url:objectUrl,error:''});}
      }catch{if(!disposed)setQr({key:qrKey,url:'',error:'二维码读取未完成，请重新读取。'});}
      finally{clearTimeout(timer);}
    })();
    return()=>{disposed=true;clearTimeout(timer);controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[endpoint,sessionId,qrKey,qrRetry]);
  const pending=!!lastCommand && (desktop.input_completed || 0)<lastCommand;
  const initialValue=(f:Field):string|undefined=>f.role==='math' && captcha?.state==='solved'?(captcha.answer ?? ''):undefined;
  const inputValues=()=>fields.flatMap(f=>{
    const text=values[f.id] ?? initialValue(f);
    return text!==undefined?[{id:f.id,text}]:[];
  });
  async function send(control?:Control,inspect=false){
    if(inflight.current || pending)return;
    inflight.current=true;setBusy(true);setError('');
    try{
      if(uncertain){
        const current=await platformAuthRequest<DesktopAuth>(fetchRef.current,endpoint,undefined,10000);
        if(current.input_pending){setError('上次操作仍在处理中，请稍候。');return;}
        setUncertain(false);setError('状态已确认，请再次点击所需操作。');return;
      }
      const command=inspect?{action:'inspect'}:control?{action:'control',id:control.id,values:['captcha_refresh','qr_refresh'].includes(control.kind)?[]:inputValues()}:{action:'fill_fields',values:inputValues(),submit_id:submit?.id};
      const response=await platformAuthRequest<{command_id?:number}>(fetchRef.current,endpoint+'/interact',{...command,session_id:sessionId,form_id:desktop.form_id});
      setLastCommand(response.command_id || 0);
      if(control?.kind==='sms'){setLastSms(response.command_id || 0);deadline.current=Date.now()+60000;setSeconds(60);}
      if(!control)setValues(previous=>Object.fromEntries(fields.filter(f=>!['password','sms_code','voice_code','math'].includes(f.role || '') && f.type!=='password' && previous[f.id]!==undefined).map(f=>[f.id,previous[f.id]])));
    }catch(err){if(err instanceof PlatformAuthError && err.uncertain)setUncertain(true);setError(err instanceof Error?err.message:'操作未完成，请稍候重试。');}
    finally{inflight.current=false;setBusy(false);}
  }
  const disabled=busy || pending || !!desktop.has_challenge;
  const mathReady=fields.filter(f=>f.role==='math').every(f=>f.filled || !!(values[f.id] ?? (captcha?.state==='solved'?captcha.answer:''))?.trim());
  const phoneEntered=fields.some(f=>f.role==='phone' && !!values[f.id]?.trim());
  const smsButton=sms && <button type="button" className="wb-button" disabled={disabled || seconds>0 || (sms.enabled===false && !phoneEntered)} onClick={()=>void send(sms)}>{seconds?`${seconds}秒后可重发`:'获取验证码'}</button>;
  return <div className="wb-auth-session">
    {desktop.official_feedback && <p role="alert" className={desktop.official_feedback_kind==='sms_sent'?'wb-success':desktop.official_feedback_kind==='voice_required'?'wb-muted':'wb-error'}>{desktop.official_feedback}</p>}
    {desktop.official_feedback_detail && <p className="wb-muted">{desktop.official_feedback_detail}</p>}
    {source==='xiaoxiang' && desktop.window_visible===false && <p className="wb-muted">{boardQr?'认证在后台自动进行，请用大象扫描面板中的二维码完成看板登录。':desktop.board_reused?'认证在后台自动进行；本机保留知了看板登录态，本次只需用美团App扫描面板中的二维码，完成后自动连接看板。':'认证在后台自动进行，请用美团App扫描面板中的二维码；如官方页面无法在后台操作，系统会自动打开登录窗口。'}</p>}
    {source==='xiaoxiang' && consentField && <p className="wb-muted">{consentField.filled?'用户协议已由系统自动勾选，可取消勾选；取消后本轮不会再次自动勾选。':'用户协议尚未勾选；勾选后系统会继续官方登录流程。'}</p>}
    {source==='xiaoxiang' && voiceField && <p className="wb-muted">官方已进入语音二次验证；语音验证码是动态码，请按提示接听语音电话后填入，系统无法预先知道。</p>}
    {source==='xiaoxiang' && desktop.has_challenge && desktop.challenge_id && desktop.challenge_version && <OfficialVerification key={sessionId+desktop.challenge_id} apiFetch={apiFetch} sessionId={sessionId} challengeId={desktop.challenge_id} version={desktop.challenge_version} disabled={busy || pending || !!desktop.input_pending} onCommand={setLastCommand}/>}
    {qrMode?<div className="wb-dingtalk-qr">
      <div className="wb-dingtalk-qr-image">{qr.key===qrKey && qr.url?<img className={lighthouseQr||boardQr?'wb-qr-sharp':undefined} src={qr.url} alt={lighthouseQr?'美团App登录二维码':boardQr?'知了看板登录二维码':'钉钉登录二维码'}/>:<p role="status" className="wb-muted">{qr.key===qrKey && qr.error?qr.error:lighthouseQr?(desktop.qr_state==='expired'?'二维码已过期，请点击刷新重新获取。':'正在准备美团登录二维码…'):boardQr?(desktop.qr_state==='expired'?'二维码已过期，请点击刷新重新获取。':'正在准备知了看板二维码…'):'正在准备钉钉二维码…'}</p>}</div>
      <p role="status" className={desktop.qr_state==='expired'?'wb-error':'wb-muted'}>{lighthouseQr?(desktop.qr_state==='expired'?'二维码已过期，请点击刷新后重新扫码。':desktop.board_reused?'请用美团App扫码完成灯塔登录；本机保留知了看板登录态，完成后自动连接看板，无需再扫大象。':'请打开美团App，使用扫一扫扫描二维码完成灯塔登录；如官方要求安全验证，可在认证面板或自动打开的官方窗口中完成。'):boardQr?(desktop.qr_state==='expired'?'二维码已过期，请点击刷新后重新扫码，无需重新发送短信。':desktop.lighthouse_reused?'灯塔会话仍有效，已跳过美团扫码；请用大象扫码完成知了看板登录。':desktop.board_reused?'本机保留的看板登录态已失效；请用大象扫码完成知了看板登录。':'灯塔登录已完成；请用大象或美团扫码完成知了看板登录，无需再发送短信。'):(desktop.qr_state==='expired'?'二维码已过期，请刷新后重新扫码。':'使用手机钉钉扫一扫，确认后自动连接。')}</p>
      <div className="wb-row"><button type="button" className="wb-button" disabled={disabled || refresh?.enabled===false} onClick={()=>refresh?void send(refresh):setQrRetry(value=>value+1)}>{refresh?'刷新二维码':'重新读取二维码'}</button></div>
      {pending && <p role="status" className="wb-muted">操作已提交，正在等待平台确认。</p>}
    </div>:<>
    {!fields.length ? <p role="status" className="wb-muted">{source==='xiaoxiang' && desktop.form_detection==='not_detected'?'正在等待官方登录页面就绪；如窗口已关闭，请重新点击登录（灯塔登录已保留，无需重新发送短信）。':desktop.form_detection==='not_detected' || desktop.form_detection==='qr_only'?'暂未识别到可用的内部登录表单；不会自动打开外部页面或发送验证码。':'正在准备登录表单…'}</p> : <form className="wb-internal-login-form" onSubmit={event=>{event.preventDefault();void send();}}>
      {fields.map(field=>field.type==='checkbox'?<label className="wb-auth-consent" key={field.id}><input type="checkbox" checked={values[field.id]!==undefined?values[field.id]==='true':initialValue(field)!==undefined?initialValue(field)==='true':field.filled} disabled={disabled} onChange={event=>setValues(v=>({...v,[field.id]:String(event.target.checked)}))}/>{field.label || '同意平台登录授权'}</label>:<label className="wb-auth-field" key={field.id}>{fieldLabel(field)}
        <div className="wb-auth-input-row"><input aria-label={fieldLabel(field)} type={field.type==='password' || field.role==='password'?'password':field.role==='phone'?'tel':'text'} inputMode={['phone','sms_code','voice_code','math'].includes(field.role || '')?'numeric':undefined} value={values[field.id] ?? initialValue(field) ?? ''} autoComplete="off" maxLength={4096} disabled={disabled} placeholder={field.filled?'留空保留平台已有内容':fieldLabel(field)} onChange={event=>setValues(v=>({...v,[field.id]:event.target.value}))}/>{field.role==='phone' && smsButton}</div>
        {field.role==='math' && <div className="wb-auth-math">
          {captcha?.image && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(captcha.image) && captcha.image.length<360000 && <img src={captcha.image} alt="商翼算式验证码"/>}
          {captcha?.state==='solved'?<span className="wb-muted">{captcha.expression} = {captcha.answer}，已自动计算，可修改。</span>:<span className="wb-muted">{captcha?.state==='recognizing'?'正在自动识别，也可直接填写答案。':captcha?.state==='unavailable'?'算式暂未加载，请刷新后填写。':'未能可靠识别，请填写算式答案。'}</span>}
          {controls.find(c=>c.kind==='captcha_refresh') && <button type="button" className="wb-button" disabled={disabled} onClick={()=>void send(controls.find(c=>c.kind==='captcha_refresh'))}>刷新算式</button>}
        </div>}
      </label>)}
      {!fields.some(f=>f.role==='phone') && smsButton}
      <button className="wb-primary" type="submit" disabled={disabled || !mathReady || !submit || submit.enabled===false}>{disabled?'正在处理…':submit?.label || '登录'}</button>
      {pending && <p role="status" className="wb-muted">操作已提交，正在等待平台确认。</p>}
    </form>}
    {!!lastSms && !pending && !desktop.official_feedback && <p role="status" className="wb-muted">已操作验证码发送请求，尚未读到官方发送结果。倒计时仅限制重复操作，不代表短信已发送。</p>}
    </>}
    {(error || desktop.input_error) && <p role="alert" className="wb-error">{error || desktop.input_error}</p>}
    {uncertain && <p className="wb-muted">操作结果尚未确认；再次操作时会先读取状态，不会自动重发验证码。</p>}
  </div>;
}
