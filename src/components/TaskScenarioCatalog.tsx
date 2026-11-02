import React, {useState} from 'react';
import { Download, FileSpreadsheet, ChevronRight } from 'lucide-react';
import { DOWNLOAD_PLATFORMS, type DownloadPlatform } from '../lib/downloadModules';
import type {ReportDefinition} from '../lib/reportBuilder';

export interface TaskScenario { id:string; label:string; description:string; platform:DownloadPlatform; datasets:string[] }
export function TaskScenarioCatalog({scenarios,reports,onSelect,disabled}:{
  scenarios:TaskScenario[];reports:ReportDefinition[];disabled:boolean;
  onSelect:(selection:{kind:'download'|'generate';platform?:DownloadPlatform;datasets:string[];id:string})=>void;
}) {
  const [kind,setKind]=useState<'download'|'generate'>('download');
  const [platform,setPlatform]=useState<DownloadPlatform|'all'>('all');
  return <div className="tc-scenario-catalog">
    <div className="wb-tabs" role="group" aria-label="任务类型">
      <button className="wb-button" aria-pressed={kind==='download'} onClick={()=>setKind('download')}><Download size={16}/>资料采集</button>
      <button className="wb-button" aria-pressed={kind==='generate'} onClick={()=>setKind('generate')}><FileSpreadsheet size={16}/>专项报表</button>
    </div>
    {kind==='download'?<>
      <div className="tc-scenario-filter" role="group" aria-label="业务包来源">
        <button className="wb-button" aria-pressed={platform==='all'} onClick={()=>setPlatform('all')}>全部平台</button>
        {DOWNLOAD_PLATFORMS.map(row=><button key={row.id} className="wb-button" aria-pressed={platform===row.id} onClick={()=>setPlatform(row.id)}>{row.label}</button>)}
      </div>
      <div className="tc-scenario-grid">{scenarios.filter(row=>platform==='all'||row.platform===platform).map(row=><button key={row.id} type="button" disabled={disabled} className="tc-scenario" onClick={()=>onSelect({kind:'download',platform:row.platform,datasets:row.datasets,id:row.id})}>
        <span className="tc-scenario-source">{DOWNLOAD_PLATFORMS.find(p=>p.id===row.platform)?.label} · {row.datasets.length} 类资料</span>
        <strong>{row.label}</strong><span>{row.description}</span><span className="tc-scenario-next">配置范围<ChevronRight size={14}/></span>
      </button>)}</div>
      <details className="tc-custom-scenarios"><summary>自定义资料 · 查看全部现有下载项目</summary><p className="wb-muted">选择一个平台，在下一步按需勾选资料；保留原平台的组合及范围限制。</p><div className="tc-scenario-filter">{DOWNLOAD_PLATFORMS.map(row=><button key={row.id} className="wb-button" disabled={disabled} onClick={()=>onSelect({kind:'download',platform:row.id,datasets:[],id:`custom:${row.id}`})}>{row.label}自定义</button>)}</div></details>
    </>:<div className="tc-scenario-grid">{reports.map(row=><button key={row.id} type="button" disabled={disabled} className="tc-scenario" onClick={()=>onSelect({kind:'generate',datasets:[row.id],id:row.id})}>
      <span className="tc-scenario-source">{row.systems?.join(' / ')}</span><strong>{row.label}</strong><span>{row.description}</span><span className="tc-scenario-next">{row.scope==='all'?'全部城市 · 当前全量':row.scope==='city_month'?'按城市 · 按月':'按城市 · 按日期'}<ChevronRight size={14}/></span>
    </button>)}</div>}
  </div>;
}
