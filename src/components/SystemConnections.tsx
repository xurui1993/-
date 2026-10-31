import React,{useEffect,useRef,useState} from 'react';
import { Compass, Layers, UsersRound, Radar, RefreshCw } from 'lucide-react';
import type {FengshenAuthStatus} from './FengshenLoginModal';
import {SourceLoginPanel,type DesktopAuth} from './SourceLoginPanel';
import {WorkbenchDrawer} from './WorkbenchDrawer';
import {platformAuthRequest} from '../lib/platformAuthApi';
import {platformLoginLabel} from '../lib/authPresentation';
import {getPlatformStatusCluster, getPlatformCardBadge} from '../lib/workbench';

type State=DesktopAuth & {state?:string;message?:string;saved?:boolean;busy?:boolean;offline?:boolean;cancelling?:boolean;release_state?:string;session_id?:string;session_version?:string};
const platforms=[
  {key:'fengshen',label:'风神',icon:Compass},
  {key:'lanorange',label:'蓝橙',icon:Layers},
  {key:'baize',label:'商翼',icon:UsersRound},
  {key:'xiaoxiang',label:'灯塔',icon:Radar},
];
export function SystemConnections({apiFetch,fengshenStatus,onOpenFengshen,hideTrigger=false}:{apiFetch:(url:string,init?:RequestInit)=>Promise<Response>;fengshenStatus:FengshenAuthStatus|null;onOpenFengshen:()=>void;hideTrigger?:boolean}){
  const fetchRef=useRef(apiFetch);fetchRef.current=apiFetch;
  const [states,setStates]=useState<Record<string,State>>({}),[open,setOpen]=useState(false),[authSource,setAuthSource]=useState('');
  const [pending,setPending]=useState<Record<string,string>>({}),[errors,setErrors]=useState<Record<string,string>>({});
  const inflight=useRef(new Set<string>()),verified=useRef(new Set<string>());
  const versions=useRef<Record<string,string>>({});
  function begin(key:string,action:string){if(inflight.current.has(key))return false;inflight.current.add(key);setPending(v=>({...v,[key]:action}));setErrors(v=>({...v,[key]:''}));return true;}
  function end(key:string){inflight.current.delete(key);setPending(v=>{const next={...v};delete next[key];return next;});}
  function accept(key:string,value:State){
    const previous=versions.current[key];
    if(value.session_version)versions.current[key]=value.session_version;
    setStates(v=>({...v,[key]:value}));
    if(previous && value.session_version && previous!==value.session_version)window.dispatchEvent(new CustomEvent('workbench:platform-session-changed',{detail:{source:key}}));
  }
  function fail(key:string,error:unknown){setErrors(v=>({...v,[key]:error instanceof Error?error.message:'操作未完成，请稍候再试。'}));}
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener('workbench:connections',show);return()=>window.removeEventListener('workbench:connections',show);},[]);
  useEffect(()=>{
    let disposed=false;const controller=new AbortController();const timers=new Map<string,ReturnType<typeof setTimeout>>();
    const requestFetch=(url:string,init?:RequestInit)=>fetchRef.current(url,{...init,signal:init?.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal});
    async function poll(key:string){
        try{const value=await platformAuthRequest<State>(requestFetch,`/api/fengshen-downloads/platform-auth/${key}`,undefined,10000);if(!disposed)accept(key,{...value,offline:false});}
        catch{if(!disposed)setStates(v=>({...v,[key]:{...v[key],offline:true}}));}
      // A slow/unavailable platform must not delay the active login's next poll.
      if(!disposed)timers.set(key,setTimeout(()=>void poll(key),key===authSource && ['baize','xiaoxiang'].includes(key)?500:open || authSource?2000:10000));
    }
    platforms.forEach(({key})=>void poll(key));return()=>{disposed=true;controller.abort();timers.forEach(clearTimeout);};
  },[open,authSource]);
  useEffect(()=>{
    for(const {key} of platforms){
      const value=states[key],version=value?.session_version;
      if(!version || !value.saved || value.busy || value.offline || !['saved','partial'].includes(value.state || '') || inflight.current.has(key) || verified.current.has(key+version))continue;
      if(!begin(key,'verify'))continue;verified.current.add(key+version);
      void platformAuthRequest<State>(fetchRef.current,`/api/fengshen-downloads/platform-auth/${key}/check${key==='xiaoxiang'?'?deep=true':''}`,{},key==='xiaoxiang'?45000:20000).then(result=>setStates(current=>current[key]?.session_version===version?{...current,[key]:result}:current)).catch(error=>fail(key,error)).finally(()=>end(key));
    }
  },[states]);
  useEffect(()=>{if(authSource && states[authSource]?.state==='ready' && !states[authSource]?.busy)setAuthSource('');},[states,authSource]);
  async function login(key:string){
    if(!begin(key,'login'))return;
    try{
      const current=await platformAuthRequest<State>(apiFetch,`/api/fengshen-downloads/platform-auth/${key}`,undefined,10000);accept(key,current);
      if(current.state==='ready')return;
      setOpen(false);
      if(key==='fengshen'){onOpenFengshen();return;}
      setAuthSource(key);
      if(['starting','waiting_login','refreshing'].includes(current.state || '') || current.busy)return;
      const value=await platformAuthRequest<State>(apiFetch,`/api/fengshen-downloads/source-auth/${key}/start`,{});accept(key,value);
    }catch(error){fail(key,error);}finally{end(key);}
  }
  async function logout(key:string){
    if(!begin(key,'logout'))return;
    try{
      const current=await platformAuthRequest<State>(apiFetch,`/api/fengshen-downloads/platform-auth/${key}`,undefined,10000);
      if(!current.session_version)throw new Error('登录状态暂未读到，请稍候再点退出。');
      const value=await platformAuthRequest<State>(apiFetch,`/api/fengshen-downloads/platform-auth/${key}/logout`,{confirm:true,session_version:current.session_version},30000);accept(key,value);if(authSource===key)setAuthSource('');
    }catch(error){fail(key,error);}finally{end(key);}
  }
  const waiting=platforms.find(({key})=>['starting','waiting_login','login_required','sms_sent','manual_required'].includes(states[key]?.state || '') && states[key]?.busy);
  const cluster=getPlatformStatusCluster(states,fengshenStatus);
  const source=platforms.find(p=>p.key===authSource),current=states[authSource] || {};
  const readyCount = platforms.filter(p => {
    const val = states[p.key] || (p.key === 'fengshen' ? (fengshenStatus || {}) : {});
    return val.state === 'ready' && !val.offline;
  }).length;

  const refreshAllPlatforms = () => {
    for (const {key} of platforms) {
      const val = states[key];
      const version = val?.session_version;
      if (val?.saved && !val?.busy && !val?.offline && version) {
        if (begin(key, 'verify')) {
          void platformAuthRequest<State>(fetchRef.current, `/api/fengshen-downloads/platform-auth/${key}/check${key==='xiaoxiang'?'?deep=true':''}`, {}, key==='xiaoxiang'?45000:20000)
            .then(result => setStates(current => current[key]?.session_version === version ? { ...current, [key]: result } : current))
            .catch(error => fail(key, error))
            .finally(() => end(key));
        }
      }
    }
  };

  return <>
    {(!hideTrigger || waiting) && (
      <button className="wb-connection-trigger" aria-label="管理系统连接" onClick={()=>setOpen(true)}>
        <span className="wb-connection-title">平台登录</span>
        <span className="wb-connection-sep" aria-hidden="true" />
        <span className="wb-connection-cluster" aria-hidden="true">
          {cluster.map(item=>(
            <span key={item.key} className={`wb-connection-chip is-${item.tone}`} title={`${item.shortLabel}：${item.statusText}`}>
              <span className={`wb-dot ${item.tone==='ready'?'ready':item.tone==='warn'?'offline':item.tone==='busy'?'busy':''}`}/>
              <span>{item.shortLabel}</span>
            </span>
          ))}
        </span>
      </button>
    )}
    {open && <WorkbenchDrawer title="平台登录" onClose={()=>setOpen(false)}>
      <div className="wb-platform-overview-bar">
        <div className="wb-platform-overview-stat">
          <span className="wb-platform-overview-dot" />
          <span>数据源通道 · <strong>{readyCount}</strong> / {platforms.length} 已就绪</span>
        </div>
        <button
          type="button"
          className="wb-platform-refresh-btn"
          title="重新刷新检测平台连接"
          onClick={refreshAllPlatforms}
        >
          <RefreshCw size={12} />
          <span>检测状态</span>
        </button>
      </div>

      <div className="wb-platform-card-list">
        {platforms.map(({key,label,icon:PlatformIcon})=>{
          const value:State=states[key] || (key==='fengshen'?(fengshenStatus || {}):{});
          const ready=value.state==='ready' && !value.offline;
          const canExit=!!value.saved || !!value.busy || ready || ['starting','waiting_login'].includes(value.state || '');
          const badge=getPlatformCardBadge(value, pending[key]);

          return (
            <section className={`wb-platform-login-row is-${key}`} key={key}>
              <div className="wb-platform-login-summary">
                <div className="wb-platform-identity">
                  <span className="wb-platform-avatar" aria-hidden="true">
                    <PlatformIcon size={17} />
                  </span>
                  <h3 className="wb-platform-name">{label}</h3>
                </div>

                <div className="wb-platform-status-area">
                  <span className={`wb-status-badge is-${badge.tone}`}>
                    <span className={`wb-dot ${badge.tone==='ready'?'ready':badge.tone==='warn'?'offline':badge.tone==='busy'?'busy':''}`} />
                    <span>{badge.label}</span>
                  </span>
                </div>

                <div className="wb-platform-actions">
                  {!ready && (
                    <button
                      type="button"
                      className="wb-button wb-btn-login"
                      disabled={!!pending[key]}
                      onClick={()=>void login(key)}
                    >
                      {platformLoginLabel(key,value)}
                    </button>
                  )}
                  {canExit && (
                    <button
                      type="button"
                      className="wb-button wb-btn-logout"
                      disabled={!!pending[key]}
                      onClick={()=>void logout(key)}
                    >
                      退出
                    </button>
                  )}
                </div>
              </div>
              {(errors[key] || value.offline) && (
                <p role="alert" className="wb-error">{errors[key] || '连接状态暂不可用，请稍候再试。'}</p>
              )}
            </section>
          );
        })}
      </div>
    </WorkbenchDrawer>}
    {!!source && <WorkbenchDrawer title={source.key==='lanorange'?'蓝橙扫码登录':`${source.label}登录验证`} closeLabel="收起登录窗口" bodyClassName="wb-auth-session" onClose={()=>setAuthSource('')}>
      {current.message && <p role="status" className="wb-muted">{current.message}</p>}
      {current.state==='waiting_login' && current.session_id && !current.cancelling && <SourceLoginPanel key={source.key+current.session_id} source={source.key} sessionId={current.session_id} desktop={current} apiFetch={apiFetch}/>}
      {!current.busy && !['starting','waiting_login','refreshing','ready'].includes(current.state || '') && <button className="wb-primary" disabled={!!pending[source.key]} onClick={()=>void login(source.key)}>{platformLoginLabel(source.key,current)}</button>}
      {errors[source.key] && <p role="alert" className="wb-error">{errors[source.key]}</p>}
    </WorkbenchDrawer>}
  </>;
}
