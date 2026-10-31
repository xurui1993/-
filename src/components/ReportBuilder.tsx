import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
import { monthBounds, reportRange, type ReportDefinition } from '../lib/reportBuilder';

interface City { id:string; name:string; disabled?:boolean; note?:string }
interface Props {
  reports:ReportDefinition[]; selectedId:string; onSelect:(id:string)=>void;
  cities:City[]; selectedCities:string[]; onCities:(cities:string[])=>void;
  start:string; end:string; today:string; onStart:(value:string)=>void; onEnd:(value:string)=>void;
  includeSeparation:boolean; onSeparation:(value:boolean)=>void;
  locked:boolean; creating:boolean; disabled:boolean; submitLabel:string; onSubmit:()=>void;
  uncertain:boolean; duplicate:boolean; recollect:boolean; onRecollect:(value:boolean)=>void;
  refreshing:boolean; onRefreshCities:()=>void;
}

/** Scope controls follow the server catalog; report-specific business logic stays in its generator. */
export function ReportBuilder(props:Props) {
  const {reports,selectedId,cities,selectedCities,locked}=props;
  const report=reports.find(item=>item.id===selectedId);
  const range=reportRange(report,props.start,props.end,props.today);
  const [reportSearch,setReportSearch]=useState('');
  const [cityOpen,setCityOpen]=useState(false),[citySearch,setCitySearch]=useState('');
  const picker=useRef<HTMLDivElement>(null);
  useEffect(()=>{setCityOpen(false);setCitySearch('');},[selectedId,locked]);
  useEffect(()=>{
    const outside=(event:MouseEvent)=>{if(!picker.current?.contains(event.target as Node))setCityOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setCityOpen(false);};
    document.addEventListener('mousedown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',escape);};
  },[]);
  const selectable=cities.filter(city=>!city.disabled);
  const chooseCity=(name:string)=>props.onCities(selectedCities.includes(name)?selectedCities.filter(value=>value!==name):[...selectedCities,name]);
  const chooseMonth=(month:string,start:boolean)=>{
    if(!month){if(start)props.onStart('');else props.onEnd('');return;}
    const bounds=monthBounds(month);
    if(!bounds)return;
    if(start)props.onStart(bounds.start);else props.onEnd(bounds.end);
  };
  const quickMonth=(offset:number)=>{
    const [year,month]=props.today.slice(0,7).split('-').map(Number);
    const date=new Date(Date.UTC(year,month-1+offset,1));
    const bounds=monthBounds(date.toISOString().slice(0,7));
    if(bounds){props.onStart(bounds.start);props.onEnd(bounds.end);}
  };
  const citySummary=selectedCities.length?`${selectedCities.slice(0,3).join('、')}${selectedCities.length>3?`等 ${selectedCities.length} 城`:''}`:'请选择城市';
  const hint=!report?'请选择报表':!range?'请选择有效的时间范围':report.scope==='all'?'全部城市 · 当前全量':!selectedCities.length?'请选择至少一个城市':report.scope==='city_month'?`${selectedCities.length} 个城市 × ${range.months} 个月份`:`${selectedCities.length} 个城市 · ${range.start} 至 ${range.end}`;
  return <section className="rb-builder" aria-label="专项报表生成">
    <aside className="rb-catalog" aria-label="报表目录">
      <h2>专项报表</h2>
      {reports.length>6&&<label className="rb-report-search"><Search size={14}/><input aria-label="搜索报表" placeholder="搜索报表" value={reportSearch} onChange={e=>setReportSearch(e.target.value)}/></label>}
      <div className="rb-report-list" role="radiogroup" aria-label="选择业务报表">
        {reports.filter(item=>item.label.includes(reportSearch.trim())).map(item=><button type="button" key={item.id} role="radio" aria-checked={selectedId===item.id} disabled={locked} onClick={()=>props.onSelect(item.id)} className={selectedId===item.id?'is-selected':''}>
          <FileSpreadsheet size={18}/><span><strong>{item.label}</strong><small>{item.scope==='city_month'?'按城市 · 按月':item.scope==='city_range'?'按城市 · 按日期':'全部城市 · 全量'}</small></span>{selectedId===item.id&&<Check size={15}/>}</button>)}
      </div>
      {!reports.length&&<p className="rb-muted">暂无可用报表。</p>}
    </aside>
    <div className="rb-configuration">
      <header className="rb-heading"><div><h3>{report?.label||'选择业务报表'}</h3><p>{report?.description||'从左侧选择需要生成的报表。'}</p></div><span className="rb-systems">{report?.systems?.join(' / ')}</span></header>
      {report&&<>
        <div className="rb-fields">
          {report.scope==='all'?<div className="rb-fixed-scope"><div><span>城市范围</span><strong>全部城市</strong></div><div><span>资料范围</span><strong>当前全量 · 不按日期筛选</strong></div></div>:<>
            <div className="rb-field rb-city-field" ref={picker}>
              <label id="report-city-label">处理城市</label>
              <button type="button" className="rb-city-trigger" aria-labelledby="report-city-label" aria-expanded={cityOpen} disabled={locked} onClick={()=>setCityOpen(!cityOpen)}><span className={selectedCities.length?'':'rb-muted'}>{citySummary}</span><span>{selectedCities.length>0&&<small>{selectedCities.length} 城</small>}<ChevronDown size={15}/></span></button>
              {cityOpen&&<div className="rb-city-picker">
                <label className="rb-city-search"><Search size={14}/><input autoFocus aria-label="搜索报表城市" placeholder="搜索城市" value={citySearch} onChange={e=>setCitySearch(e.target.value)}/></label>
                <div className="rb-city-tools"><button type="button" disabled={locked||!selectable.length} onClick={()=>props.onCities(selectable.map(city=>city.name))}>全选可用城市</button><button type="button" disabled={locked} onClick={()=>props.onCities([])}>清空</button><button type="button" disabled={locked||props.refreshing} onClick={props.onRefreshCities}><RefreshCw size={12}/>{props.refreshing?'刷新中…':'刷新城市'}</button></div>
                <div className="rb-city-options" role="group" aria-label="报表城市列表">{cities.filter(city=>city.name.includes(citySearch.trim())).map(city=><label key={city.id} title={city.note}><input type="checkbox" disabled={locked||city.disabled} checked={!city.disabled&&selectedCities.includes(city.name)} onChange={()=>chooseCity(city.name)}/><span>{city.name}</span>{city.disabled&&<small>{city.note||'不可用'}</small>}</label>)}</div>
                {!selectable.length&&<p className="rb-muted">暂无可用城市，请刷新城市或检查平台连接。</p>}
                <div className="rb-city-picker-footer"><span>已选 {selectedCities.length} 城</span><button type="button" onClick={()=>setCityOpen(false)}>完成</button></div>
              </div>}
            </div>
            <div className="rb-field rb-period-field">
              <div className="rb-label-row"><label>{report.scope==='city_month'?'业务月份':'业务日期'}</label>{report.scope==='city_month'&&<span><button type="button" disabled={locked} onClick={()=>quickMonth(-1)}>上月</button><button type="button" disabled={locked} onClick={()=>quickMonth(0)}>本月</button></span>}</div>
              <div className="rb-period-inputs"><label><span className="sr-only">{report.scope==='city_month'?'开始月份':'开始日期'}</span><input aria-label={report.scope==='city_month'?'报表开始月份':'报表开始日期'} max={report.scope==='city_month'?props.today.slice(0,7):props.today} type={report.scope==='city_month'?'month':'date'} value={report.scope==='city_month'?props.start.slice(0,7):props.start} disabled={locked} onChange={e=>report.scope==='city_month'?chooseMonth(e.target.value,true):props.onStart(e.target.value)}/></label><span>至</span><label><span className="sr-only">{report.scope==='city_month'?'结束月份':'结束日期'}</span><input aria-label={report.scope==='city_month'?'报表结束月份':'报表结束日期'} max={report.scope==='city_month'?props.today.slice(0,7):props.today} type={report.scope==='city_month'?'month':'date'} value={report.scope==='city_month'?props.end.slice(0,7):props.end} disabled={locked} onChange={e=>report.scope==='city_month'?chooseMonth(e.target.value,false):props.onEnd(e.target.value)}/></label></div>
              {range&&report.scope==='city_month'&&<small className="rb-muted">{range.start} 至 {range.end} · 按月份生成</small>}
              {!range&&<small role="alert" className="rb-invalid">开始时间不能晚于结束时间，请填写有效范围。</small>}
            </div>
          </>}
          {report.station_rule==='separation'&&report.scope!=='all'&&<label className="rb-field rb-station-field">站点范围<select aria-label="报表站点范围" disabled={locked} value={props.includeSeparation?'only':'exclude'} onChange={e=>props.onSeparation(e.target.value==='only')}><option value="exclude">排除取分离站点</option><option value="only">仅取分离站点</option></select></label>}
        </div>
        <details className="rb-explanation" key={report.id}><summary>报表说明与来源（{report.sources.length}）</summary><ul>{report.sources.map(source=><li key={source}>{source.replaceAll('白泽','商翼')}</li>)}</ul><p>资料不足时暂停生成，已取得的资料保留。</p></details>
      </>}
      {props.uncertain&&<p className="rb-notice" role="status">上次提交结果尚未确认，范围已锁定。请确认原请求，避免重复创建。</p>}
      {props.duplicate&&!props.uncertain&&<div className="rb-notice"><p>相同范围已有结果，可直接查看。</p><label><input type="checkbox" checked={props.recollect} disabled={locked} onChange={e=>props.onRecollect(e.target.checked)}/>重新采集，生成新版本</label></div>}
      <footer className="rb-footer"><div><strong>{hint}</strong>{report?.station_rule==='separation'&&report.scope!=='all'&&<small>{props.includeSeparation?'仅取分离站点':'排除取分离站点'}</small>}</div><button type="button" className="wb-primary" disabled={props.disabled||!report||!range} onClick={props.onSubmit}><FileSpreadsheet size={16}/>{props.creating?'提交中…':props.submitLabel}</button></footer>
    </div>
  </section>;
}
