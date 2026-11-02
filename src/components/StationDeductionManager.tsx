import {CityDeductionAmounts} from './CityDeductionAmounts';
import React,{useEffect,useState} from 'react';
import {WorkbenchDrawer} from './WorkbenchDrawer';
import {useStationDirectory,stationCountText} from '../lib/useStationDirectory';
import {DeductionAmounts,type DeductionEntry,type DeductionDraft,type Fetcher} from './DeductionAmounts';
export function StationDeductionManager({apiFetch,platform='fengshen',onClose,onSaved}:{apiFetch:Fetcher;platform?:'fengshen'|'xiaoxiang';onClose:()=>void;onSaved:()=>void}){
  const [source,setSource]=useState(platform),[data,setData]=useState<DeductionDraft|null>(null),[rows,setRows]=useState<DeductionEntry[]>([]);
  const [cityRows,setCityRows]=useState<DeductionEntry[]>([]);
  const [city,setCity]=useState(''),[search,setSearch]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0),[confirmClose,setConfirmClose]=useState(false);
  const directory=useStationDirectory(source,apiFetch);
  useEffect(()=>{
    const controller=new AbortController();
    void apiFetch(`/api/workbench/deduction-profiles/${source}`,{signal:controller.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.detail||'扣款读取失败');if(!controller.signal.aborted){setData(previous=>dirty&&previous?previous:v);setRows(previous=>{if(!dirty)return v.entries;const existing=new Map(previous.map(e=>[e.key,e]));return v.entries.map((e:DeductionEntry)=>existing.get(e.key)||e);});setCityRows(previous=>dirty?previous:v.cities||[]);setError('');}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[source,directory.data?.stations.length,directory.data?.fetched_at,reload,dirty]);
  const visible=rows.filter(e=>(!city||e.station.city_id===city)&&`${e.station.name} ${e.station.id} ${e.station.city}`.includes(search.trim())).slice(0,100);
  async function save(){
    if(!data)return;setBusy(true);setError('');
    try{const entries=rows.filter(e=>e.edited),cities=cityRows.filter(e=>e.edited);if(!entries.length&&!cities.length)throw Error('请先配置金额，或明确确认零扣款');const r=await apiFetch(`/api/workbench/deduction-profiles/${source}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:data.version,entries,cities})});const v=await r.json();if(!r.ok)throw Error(v.detail||'保存失败');setData({...data,version:v.version});setDirty(false);setReload(v=>v+1);setMessage('默认扣款已保存，后续核算按站点例外优先、城市默认其次沿用。');onSaved();}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
  }
  const close=()=>{if(dirty)setConfirmClose(true);else onClose();};
  return <WorkbenchDrawer title="站点扣款配置" wide onClose={close}><p className="wb-muted">城市与站点自动读取后台目录；刷新保留金额。新站点需填写金额或明确确认零扣款。</p>
    <div className="wb-row"><label>平台 <select className="wb-select" aria-label="扣款平台" value={source} disabled={dirty||busy} onChange={e=>{setSource(e.target.value as typeof source);setCity('');setData(null);setRows([]);setMessage('');}}><option value="fengshen">风神 / 闪购</option><option value="xiaoxiang">小象超市</option></select></label>
      <label>城市 <select className="wb-select" aria-label="扣款城市" value={city} onChange={e=>setCity(e.target.value)}><option value="">全部城市</option>{directory.data?.cities.map(c=><option key={c.id} value={c.id}>{c.name} · {stationCountText(directory.data,c.id)}</option>)}</select></label>
      <input className="wb-input" aria-label="搜索扣款站点" placeholder="搜索站点名称或编号" value={search} onChange={e=>setSearch(e.target.value)}/><button className="wb-button" onClick={directory.refresh}>刷新目录</button>
    </div><p className="wb-muted">{directory.data?.status==='loading'?'后台站点正在逐步同步。':`${rows.length} 个站点 · ${rows.filter(e=>!e.configured).length} 个待配置`}{directory.data?.fetched_at?` · 更新于 ${new Date(directory.data.fetched_at).toLocaleString('zh-CN')}`:''}</p>
    {(error||directory.error||directory.data?.message)&&<p className="wb-error" role="alert">{error||directory.error||directory.data?.message}</p>}{message&&<p role="status" className="wb-notice">{message}</p>}
    {data&&<section className="city-deduction-default"><h3>城市统一扣款</h3><p className="wb-muted">选择城市后填写一次，普通与取分离站点共同沿用；已保存的站点例外优先。</p>{!city?<p>请先选择一个城市配置默认金额。</p>:<CityDeductionAmounts entries={cityRows.filter(e=>e.station.city_id===city)} columns={data.columns} disabled={busy} onChange={values=>{const map=new Map(values.map(e=>[e.key,e]));setCityRows(previous=>previous.map(e=>map.get(e.key)||e));setDirty(true);setMessage('');}}/>}</section>}
    {data&&<details className="station-exceptions"><summary>站点例外配置（按需展开）</summary><DeductionAmounts entries={visible} columns={data.columns} disabled={busy} onChange={values=>{const map=new Map(values.map(e=>[e.key,e]));setRows(previous=>previous.map(e=>map.get(e.key)||e));setDirty(true);setMessage('');}}/></details>}
    {visible.length===100&&<p className="wb-muted">当前显示前100个匹配站点，请按城市或名称筛选。</p>}<p className="wb-muted">后台暂不可见的历史配置继续保留，不自动删除。</p>
    <footer className="wb-row wb-space"><button className="wb-button" disabled={busy} onClick={close}>关闭</button><button className="wb-primary" disabled={busy||!dirty||directory.data?.status!=='ready'} onClick={()=>void save()}>{busy?'保存中…':'保存后续默认扣款'}</button></footer>
    {confirmClose&&<p className="wb-notice">有未保存的金额调整。<button className="wb-button" onClick={()=>setConfirmClose(false)}>继续编辑</button><button className="wb-button" onClick={onClose}>放弃修改并关闭</button></p>}
  </WorkbenchDrawer>;
}
