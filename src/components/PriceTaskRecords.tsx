import React,{useEffect,useRef,useState} from 'react';

type PriceTask={id:string;created:number;status:string;rows?:number;message?:string;counts?:Record<string,number>};
const LABELS:Record<string,string>={queued:'排队中',running:'执行中',stopping:'停止中',completed:'已完成',partial:'部分完成',needs_review:'待核实',failed:'失败',error:'失败',stopped:'已停止',cancelled:'已取消',interrupted:'已中断'};
export function PriceTaskRecords({apiFetch,onOpen}:{apiFetch:(url:string,options?:RequestInit)=>Promise<Response>;onOpen:(view:'approval'|'price-export')=>void}) {
  const api=useRef(apiFetch);api.current=apiFetch;
  const [groups,setGroups]=useState<{approval:PriceTask[];exports:PriceTask[]}>({approval:[],exports:[]});
  const [error,setError]=useState('');const [all,setAll]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const read=async()=>{
      const results=await Promise.allSettled([['lanorange-approvals/batches','batches','approval'],['lanorange-prices/exports','exports','exports']].map(async([path,key,group])=>{
        const response=await api.current('/api/fengshen-downloads/'+path,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        const data=await response.json();if(!response.ok||!Array.isArray(data[key]))throw new Error('蓝橙价格任务暂不可读');
        return {group,rows:data[key] as PriceTask[]};
      }));
      if(controller.signal.aborted)return;
      for(const result of results)if(result.status==='fulfilled')setGroups(previous=>({...previous,[result.value.group]:result.value.rows}));
      setError(results.some(value=>value.status==='rejected')?'部分蓝橙价格记录暂不可读，正在重试。':'');
      timer=setTimeout(read,5000);
    };void read();return()=>{controller.abort();clearTimeout(timer);};
  },[]);
  const rows=[...groups.approval.map(value=>({...value,view:'approval' as const})),...groups.exports.map(value=>({...value,view:'price-export' as const}))].sort((a,b)=>b.created-a.created);
  return <section className="wb-card p-4 mb-4" aria-label="蓝橙价格任务记录"><div className="wb-row wb-space"><h2>蓝橙价格任务</h2><span className="wb-muted">{rows.length} 条</span></div>
    {error&&<p role="status" className="wb-notice">{error}</p>}
    {!rows.length&&!error&&<p className="wb-muted">暂无审批或每日价格导出任务。</p>}
    {(all?rows:rows.slice(0,5)).map(row=><div className="wb-row wb-space py-2" key={row.view+row.id}><div><strong>{row.view==='approval'?'价格批量审批':'待审每日价格导出'}</strong><p className="wb-muted">{new Date(row.created*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · {LABELS[row.status]||row.status}{row.rows!==undefined?` · ${row.rows}行`:''} · {row.id.slice(0,8)}</p></div><button type="button" className="wb-button" onClick={()=>onOpen(row.view)}>查看{row.view==='approval'?'审批':'导出'}记录</button></div>)}
    {rows.length>5&&<button type="button" className="wb-link" aria-expanded={all} onClick={()=>setAll(value=>!value)}>{all?'收起记录':'展开全部价格任务'}</button>}
  </section>;
}
