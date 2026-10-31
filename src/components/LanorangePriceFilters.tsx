import React,{useEffect,useRef,useState} from 'react';
import {platformAuthRequest} from '../lib/platformAuthApi';
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
type Options={cities:string[];stations:{id:string;name:string;city:string}[];months:string[];session_version:string};
export function LanorangePriceFilters({apiFetch,workspaceId,city,station,month,onChange,disabled=false,requiredMonth=false}:{apiFetch:Fetcher;workspaceId:string;city:string;station:string;month:string;onChange:(value:{city:string;station:string;month:string})=>void;disabled?:boolean;requiredMonth?:boolean}){
  const fetchRef=useRef(apiFetch);fetchRef.current=apiFetch;
  const changeRef=useRef(onChange);changeRef.current=onChange;
  const disabledRef=useRef(disabled);disabledRef.current=disabled;
  const [options,setOptions]=useState<Options|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    const changed=(event:Event)=>{if((event as CustomEvent).detail?.source==='lanorange'){setOptions(null);if(!disabledRef.current)changeRef.current({city:'',station:'',month:''});setReload(v=>v+1);}};
    window.addEventListener('workbench:platform-session-changed',changed);return()=>window.removeEventListener('workbench:platform-session-changed',changed);
  },[]);
  useEffect(()=>{
    let disposed=false;const controller=new AbortController();setOptions(null);setBusy(true);setError('');
    const fetcher=(url:string,init?:RequestInit)=>fetchRef.current(url,{...init,signal:init?.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal});
    void platformAuthRequest<Options>(fetcher,'/api/fengshen-downloads/lanorange-approvals/filter-options'+(reload?'?refresh=true':''),undefined,60000).then(value=>{if(!disposed)setOptions(value);}).catch(err=>{if(!disposed)setError(err instanceof Error?err.message:'筛选条件读取失败');}).finally(()=>{if(!disposed)setBusy(false);});
    return()=>{disposed=true;controller.abort();};
  },[workspaceId,reload]);
  const stations=Array.from(new Set((options?.stations || []).filter(s=>!city || s.city===city).map(s=>s.name)));
  const waiting=disabled || busy || !options;
  return <>
    <label>城市<select className="wb-select" aria-label="城市" disabled={waiting} value={city} onChange={e=>changeRef.current({city:e.target.value,station:'',month})}><option value="">全部城市</option>{city && !options?.cities.includes(city) && <option value={city} disabled>{city}（原选择，请重新选择）</option>}{options?.cities.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    <label>站点<select className="wb-select" aria-label="站点" disabled={waiting} value={station} onChange={e=>changeRef.current({city,station:e.target.value,month})}><option value="">全部站点</option>{station && !stations.includes(station) && <option value={station} disabled>{station}（原选择，请重新选择）</option>}{stations.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
    <label>结算月份<select className="wb-select" aria-label="结算月份" required={requiredMonth} disabled={disabled || busy || !options} value={month} onChange={e=>changeRef.current({city,station,month:e.target.value})}><option value="">{requiredMonth?'请选择结算月份':'全部月份'}</option>{month && !options?.months.includes(month) && <option value={month} disabled>{month}（原选择，请重新选择）</option>}{options?.months.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
    <button type="button" className="wb-button" disabled={disabled || busy} onClick={()=>setReload(v=>v+1)}>{busy?'读取筛选条件…':'刷新筛选条件'}</button>
    {error && <p className="wb-error" role="alert">{error}</p>}
  </>;
}
