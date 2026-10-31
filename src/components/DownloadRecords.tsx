import { needsAction, prioritizeTasks } from '../lib/taskFlow';
import { readDownloadResponse, saveDownloadBlob, downloadOutput, downloadErrorMessage } from '../lib/outputDownload';
import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ChevronDown, Loader2, FileCheck2, FolderArchive, Activity, FileSpreadsheet, Calculator, FileText } from 'lucide-react';
import { phaseLabel, isLanorange } from '../lib/downloadCenterLogic';
import { TASK_KIND_LABELS, type TaskKind } from '../lib/taskCatalog';
import { inferDatasetSystemTag, SYSTEM_META } from '../lib/workbench';
import { matchesRecordModule,type RecordModule } from '../lib/downloadModules';

interface RecordFile { id: string; run_id: string; name: string; city: string; dataset: string; bytes: number; available: boolean; unavailable_reason?: string; outdated?: boolean }
interface DownloadRecord {
  kind?: TaskKind | 'payroll_source'; batch_id?: string; batch_status?: string; output?: string; applicants?: number; source_files?: RecordFile[];
  id: string; cities: string[]; datasets: string[]; start: string; end: string; status: string; phase?: string;
  created_at: string; updated_at: string; files: RecordFile[]; available_files: number; failed_items: number;
  completed_items: number; total_items: number; action_run_id: string; member_ids: string[];
  attempts: { id: string; status: string; created_at: string; retry_of?: string; recovery_of?: string }[];
  incomplete_lineage?: boolean;
  summary_issue?: boolean;
  lanorange_full_delivery?: boolean;
}
const ACTIVE = new Set(['queued', 'running', 'waiting_login', 'waiting_manual', 'cancelling', 'preparing']);
const ATTENTION = new Set(['waiting_login', 'waiting_manual', 'waiting_materials', 'pending_download', 'ready', 'partial', 'error', 'interrupted']);
const LABELS: Record<string, string> = { queued: '排队中', running: '处理中', waiting_login: '等待认证', waiting_manual: '等待验证', cancelling: '正在停止', success: '已完成', partial: '部分完成', error: '未完成', cancelled: '已取消', interrupted: '已中断', pending_download: '待准备资料', preparing: '准备资料中', waiting_materials: '待处理缺项', ready: '资料已就绪' };
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const recordSystemTags = (record: DownloadRecord): ('风神' | '蓝橙' | '商翼' | '小象灯塔' | '灯塔')[] => {
  if (record.kind === 'payroll') return ['风神', '蓝橙'];
  const tags = new Set<'风神' | '蓝橙' | '商翼' | '小象灯塔' | '灯塔'>();
  for (const id of record.datasets || []) tags.add(inferDatasetSystemTag(id));
  return tags.size ? [...tags] : ['风神'];
};
const sysBadgeClass = (tag: '风神' | '蓝橙' | '商翼' | '小象灯塔' | '灯塔') =>
  tag === '蓝橙' ? 'is-lanorange' : tag === '商翼' ? 'is-baize' : tag === '灯塔' || tag === '小象灯塔' ? 'is-dengta' : 'is-fengshen';


export function DownloadRecords({ apiFetch, workspaceId, selectedRunId, onOpenAttempt, execution, datasetLabel, refreshVersion = 0, unified = false,recordModule,onOpenPayroll, onNavigateGenerate, onNavigatePayroll }: {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>; workspaceId: string; selectedRunId: string;
  onOpenAttempt: (id: string) => void; execution: React.ReactNode; datasetLabel: (id: string) => string; refreshVersion?: number; unified?: boolean; onOpenPayroll?: (id: string) => void;
  onNavigateGenerate?: (cities: string[], start: string, end: string) => void;
  onNavigatePayroll?: (city?: string) => void; recordModule?: RecordModule;
}) {
  const api = useRef(apiFetch); api.current = apiFetch;
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [expanded, setExpanded] = useState('');
  const [summaryRecord, setSummaryRecord] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => { const query=window.matchMedia('(max-width: 700px)'); const update=()=>setMobile(query.matches); query.addEventListener('change',update); return ()=>query.removeEventListener('change',update); }, []);
  const resumedRecordId = records.find(record => record.member_ids?.includes(selectedRunId))?.id;
  useEffect(() => { if (resumedRecordId) setExpanded(resumedRecordId); }, [resumedRecordId]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedBundle, setFailedBundle] = useState<DownloadRecord | null>(null);
  const [pollError, setPollError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [systemTag, setSystemTag] = useState<'' | '风神' | '蓝橙' | '商翼' | '小象灯塔' | '灯塔'>('');
  const [kind, setKind] = useState('');
  const [city, setCity] = useState('');
  const [dataset, setDataset] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const [bundleCity, setBundleCity] = useState<Record<string, string>>({});
  useEffect(() => () => { for (const controller of controllers.current) controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let stopped = false;
    const poll = async () => {
      try {
        const response = await api.current(unified ? '/api/workbench/tasks' : '/api/fengshen-downloads/records', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        const data = await response.json(); if (!response.ok) throw new Error(data.detail || '下载记录读取失败');
        if (!stopped) { setRecords(data.records.filter((record:DownloadRecord)=>matchesRecordModule(record,recordModule))); setPollError(''); setLoading(false); }
      } catch (error) { if (!stopped) { setPollError(error instanceof Error ? error.message : '记录读取失败'); setLoading(false); } }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    void poll(); return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [version, selectedRunId, refreshVersion, unified,recordModule]);
  const download = async (record: DownloadRecord, file?: RecordFile, city = '', sources = false) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(file ? file.id : record.id); setError(''); setFailedBundle(null);
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const query = new URLSearchParams(); if (city) query.set('city', city); if (sources) query.set('purpose', 'sources');
      const url = file ? `/api/fengshen-downloads/runs/${file.run_id}/files/${file.id}` : `/api/fengshen-downloads/records/${record.id}/bundle${query.size ? `?${query}` : ''}`;
      const response = await api.current(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || data.error || '文件领取失败，请刷新记录后检查'); }
      const filename = file ? file.name : `${sources ? '来源资料' : '任务结果'}_${record.id.slice(0, 8)}${city ? `_${city}` : ''}.zip`;
      const blob = await readDownloadResponse(response, filename);
      if (!controller.signal.aborted) saveDownloadBlob(blob, filename);
    } catch (error) { if (!controller.signal.aborted) { setError(downloadErrorMessage(error)); if (!file) { setFailedBundle(record); setExpanded(record.id); } setVersion(value => value + 1); } }
    finally { controllers.current.delete(controller); busyRef.current = false; setBusy(''); }
  };
  const open = (record: DownloadRecord, attempt = record.action_run_id) => {
    setExpanded(record.id);
    if (attempt) onOpenAttempt(attempt);
  };
  const query = search.trim().toLowerCase();
  const visible = records.filter(record => (!query || [...record.cities, ...record.datasets.map(datasetLabel), ...record.files.map(file => file.name)].join(' ').toLowerCase().includes(query))
    && (!kind || record.kind === kind)
    && (!systemTag || recordSystemTags(record).includes(systemTag))
    && (!status || (status === 'active' ? ACTIVE.has(record.status) : status === 'attention' ? ATTENTION.has(record.status) : record.status === status))
    && (!city || record.cities.includes(city)) && (!dataset || record.datasets.includes(dataset)) && (!availableOnly || record.available_files > 0)
    && (!dateFrom || record.created_at.slice(0, 10) >= dateFrom) && (!dateTo || record.created_at.slice(0, 10) <= dateTo));

  const hasFilters = !!(search || status || systemTag || kind || city || dataset || dateFrom || dateTo || availableOnly);
  const prioritized = prioritizeTasks(visible, selectedRunId);
  const currentTasks = prioritized.filter(record => needsAction(record.status) || record.member_ids.includes(selectedRunId)).slice(0, 5);
  const displayedRecords = mobile && !showHistory && !hasFilters ? (currentTasks.length ? currentTasks : prioritized.slice(0,1)) : prioritized;
  const focusedRecord = visible.find(item => item.id === expanded) || visible.find(item => item.member_ids?.includes(selectedRunId)) || visible[0] || null;
  const activeCount = records.filter(item => ACTIVE.has(item.status)).length;
  const attentionCount = records.filter(item => ATTENTION.has(item.status)).length;
  const completedCount = records.filter(item => item.status === 'success').length;

  return <section className="wb-records" aria-label={unified ? '任务记录' : '下载记录'}>
    <div className="wb-row wb-space"><input className="wb-input wb-record-search" aria-label="搜索下载记录" placeholder="搜索任务、城市或文件名" value={search} onChange={event => setSearch(event.target.value)} /><div className="wb-row"><details className="wb-record-filter"><summary className="wb-button">更多筛选{status || systemTag || kind || city || dataset || dateFrom || dateTo || availableOnly ? ' · 已启用' : ''}</summary><div className="wb-card wb-record-filter-panel">
      {unified && !recordModule && <select className="wb-select" aria-label="按任务类型筛选" value={kind} onChange={event => setKind(event.target.value)}><option value="">全部任务类型</option>{Object.entries(TASK_KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>}
      <select className="wb-select" aria-label="按状态筛选下载记录" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option><option value="active">进行中</option><option value="attention">待处理</option>{['pending_download', 'waiting_materials', 'ready', 'success', 'partial', 'error', 'cancelled', 'interrupted'].map(value => <option value={value} key={value}>{LABELS[value]}</option>)}</select>
      <select className="wb-select" aria-label="按城市筛选下载记录" value={city} onChange={event => setCity(event.target.value)}><option value="">全部城市</option>{[...new Set(records.flatMap(record => record.cities))].sort().map(value => <option key={value}>{value}</option>)}</select>
      <select className="wb-select" aria-label="按资料筛选下载记录" value={dataset} onChange={event => setDataset(event.target.value)}><option value="">全部资料</option>{[...new Set(records.flatMap(record => record.datasets))].map(value => <option value={value} key={value}>{datasetLabel(value)}</option>)}</select>
      <label className="wb-muted">下载日期从<input className="wb-input w-full" type="date" aria-label="下载日期从" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label>
      <label className="wb-muted">下载日期到<input className="wb-input w-full" type="date" aria-label="下载日期到" value={dateTo} onChange={event => setDateTo(event.target.value)} /></label>
      <label className="wb-row"><input type="checkbox" checked={availableOnly} onChange={event => setAvailableOnly(event.target.checked)} />有可下载文件</label>
      <button className="wb-link" onClick={() => { setSearch(''); setStatus(''); setSystemTag(''); setKind(''); setCity(''); setDataset(''); setAvailableOnly(false); setDateFrom(''); setDateTo(''); }}>清除筛选</button>
    </div></details><button className="wb-icon" aria-label="刷新下载记录" onClick={() => setVersion(value => value + 1)}><RefreshCw size={16} /></button></div></div>
    <div className="wb-records-filter-bars">
      <div className="wb-quick-filters" role="group" aria-label="任务状态快捷筛选">
        {[['', '全部'], ['active', '进行中'], ['attention', '待处理'], ['success', '已完成']].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>
      {(!recordModule||recordModule==='generate')&&<div className="wb-quick-filters" role="group" aria-label="业务来源筛选">
        <button type="button" aria-pressed={systemTag === ''} onClick={() => setSystemTag('')}>全部系统</button>
        {SYSTEM_META.filter((sys, idx, arr) => arr.findIndex(item => item.label === sys.label) === idx).map(sys => (
          <button
            key={sys.key}
            type="button"
            aria-pressed={systemTag === sys.label}
            title={`${sys.label}（${sys.businessLine}）`}
            onClick={() => setSystemTag(prev => prev === sys.label ? '' : sys.label)}
          >
            {sys.label}
          </button>
        ))}
      </div>}
    </div>
    {pollError && <p role="status" className="wb-notice">{pollError}。连接恢复后会自动更新。</p>}
    {error && <div role="alert" className="wb-error"><p>{error}</p>{failedBundle && <button type="button" className="wb-button mt-2" onClick={() => open(failedBundle)}>查看任务并逐个下载成品</button>}</div>}
    <section className="wb-mobile-task-focus" aria-label="手机当前任务">
      <strong>{showHistory || hasFilters ? '任务记录' : '当前与待处理任务优先'}</strong>
      <p>{showHistory || hasFilters ? `共 ${visible.length} 条匹配记录` : `先展示 ${displayedRecords.length} 条；历史任务仍完整保留`}</p>
      <button type="button" className="wb-button" aria-expanded={showHistory} onClick={() => setShowHistory(value=>!value)}>{showHistory ? '收起历史，回到当前任务' : `展开全部历史记录（${visible.length}）`}</button>
    </section>
    <div className="wb-records-master-detail">
      <div className="wb-records-master">
        {loading ? <p role="status" className="wb-empty">正在读取任务记录…</p> : !visible.length && !pollError ? <p className="wb-empty">{records.length ? '没有符合条件的任务。' : '暂无任务。新建任务后，可在这里查看进度和领取结果。'}</p> : null}
        {displayedRecords.map(record => record.kind === 'payroll' ? <PayrollTaskCard key={record.id} record={record} focused={focusedRecord?.id === record.id} workspaceId={workspaceId} onFocus={() => setExpanded(record.id)} onOpen={() => { if (record.batch_id) onOpenPayroll?.(record.batch_id); }} /> : <article key={record.id} data-task-ids={record.member_ids.join(' ')} className={`wb-card wb-record ${focusedRecord?.id === record.id ? 'is-focused' : ''}`} aria-label={`${record.cities.join('、')}下载记录`} onClick={() => open(record)}>
          <div className="wb-record-summary">
            <div className="wb-record-description"><h3>{recordSystemTags(record).map(tag => <span key={tag} className={`wb-sys-badge mr-1.5 ${sysBadgeClass(tag)}`}>{tag}</span>)}{record.datasets.slice(0, 2).map(datasetLabel).join('、').replaceAll('（生成表）', '')}{record.datasets.length > 2 ? `等 ${record.datasets.length} 类资料` : ''}<span className="wb-kind-badge">{record.kind === 'generate' ? '业务表生成' : '资料下载'}</span></h3>
              <p className="wb-muted">{record.cities.length > 2 ? `${record.cities.slice(0, 2).join('、')}等 ${record.cities.length} 个城市` : record.cities.join('、')} · {record.datasets.every(isLanorange) ? record.lanorange_full_delivery ? '全量范围' : '原任务范围' : `${record.start} 至 ${record.end}`}</p>
              <p className="wb-muted">{timestamp(record.created_at)} · {record.available_files} 个结果文件{record.failed_items ? ` · ${record.failed_items} 项未完成` : ''}{record.files.some(file => !file.available && !file.outdated) ? ' · 部分文件不可访问' : ''}</p>
            </div>
            <span className={`wb-record-status ${record.status === 'success' ? 'wb-success' : 'wb-muted'}`}>{LABELS[record.status] || record.status}{record.phase && ACTIVE.has(record.status) ? ` · ${phaseLabel(record.phase)}` : ''}</span>
            <div className="wb-row wb-record-actions" onClick={e => e.stopPropagation()}>
              {ACTIVE.has(record.status) || record.failed_items > 0 || record.summary_issue ? <button type="button" className="wb-primary" onClick={() => open(record)}>{['waiting_login', 'waiting_manual'].includes(record.phase || record.status) ? '完成验证' : ACTIVE.has(record.status) ? '查看进度' : record.summary_issue && !record.failed_items ? '查看汇总问题' : '处理未完成项'}</button> : record.available_files > 0 ? <button type="button" className="wb-primary" disabled={!!busy} onClick={() => void download(record)}>{busy === record.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}下载本批次结果</button> : null}
              {record.status === 'success' && !record.datasets.includes('baize_employees') && ((onNavigateGenerate && record.kind !== 'generate') || onNavigatePayroll) && <details className="wb-next-business"><summary className="wb-link">其他业务操作</summary>              {record.status === 'success' && !record.datasets.includes('baize_employees') && onNavigateGenerate && record.kind !== 'generate' && record.cities?.length > 0 && (
                <button type="button" className="wb-button text-xs py-1 px-2.5 text-sky-700 hover:bg-sky-50" title="以此数据生成报表" onClick={() => onNavigateGenerate(record.cities, record.start, record.end)}>
                  <FileSpreadsheet size={13} className="inline mr-1" />生成报表
                </button>
              )}
              {record.status === 'success' && !record.datasets.includes('baize_employees') && onNavigatePayroll && record.cities?.length > 0 && (
                <button type="button" className="wb-button text-xs py-1 px-2.5 text-emerald-700 hover:bg-emerald-50" title="以此数据发起兼职结算" onClick={() => onNavigatePayroll(record.cities[0])}>
                  <Calculator size={13} className="inline mr-1" />兼职结算
                </button>
              )}
</details>}
              {record.available_files > 0 && <button type="button" className="wb-button" onClick={() => { open(record); setSummaryRecord(record.id); }}>查看核验摘要</button>}
              <button type="button" className="wb-link wb-row" aria-expanded={expanded === record.id} onClick={() => { if (expanded === record.id) setExpanded(''); else open(record); }}>{expanded === record.id ? '收起详情' : '查看详情'}<ChevronDown size={14} /></button>
            </div>
          </div>
          {expanded === record.id && <div className="wb-record-expanded" onClick={e => e.stopPropagation()}>
            <VerificationSummary record={record} open={summaryRecord === record.id} />
            {record.files.length ? <><h4 className="wb-section-label">结果文件</h4><div className="wb-row"><select className="wb-select" aria-label={`选择${record.cities.join('、')}领取城市`} value={bundleCity[record.id] || ''} onChange={event => setBundleCity(previous => ({ ...previous, [record.id]: event.target.value }))}><option value="">全部城市</option>{[...new Set(record.files.filter(file => file.available).map(file => file.city))].map(value => <option key={value}>{value}</option>)}</select><button className="wb-button" disabled={!!busy || !record.available_files} onClick={() => void download(record, undefined, bundleCity[record.id] || '')}>下载所选城市结果</button></div>
              <div className="wb-record-file-list">{record.files.map(file => <div key={`${file.run_id}:${file.id}`} className="wb-row wb-space"><div className="wb-record-filename"><span>{file.name}</span><small className="wb-muted">{file.available ? `${file.city} · ${(file.bytes / 1024).toFixed(1)} KB` : file.unavailable_reason || '文件已不存在'}</small></div><button className="wb-button" disabled={!!busy || !file.available} aria-label={`下载文件 ${file.name}`} onClick={() => void download(record, file)}><Download size={14} />下载本文件</button></div>)}</div></> : <p className="wb-muted">本次记录尚无产出文件。</p>}
            {record.incomplete_lineage && <p className="wb-notice">较早的来源记录缺失，本记录单独保留，未与其他下载合并。</p>}
            {!!record.source_files?.length && <details className="wb-generation-sources"><summary>来源资料 · {record.source_files.length} 个文件</summary><div className="wb-record-file-list">{record.source_files.map(file => <div className="wb-row wb-space" key={`${file.run_id}:${file.id}`}><span className="wb-record-filename">{file.name}{!file.available && <small className="wb-muted">{file.unavailable_reason}</small>}</span><button className="wb-button" disabled={!!busy || !file.available} onClick={() => void download(record, file)}>下载来源</button></div>)}</div><button className="wb-button" disabled={!!busy || !record.source_files.some(file => file.available)} onClick={() => void download(record, undefined, '', true)}>打包来源资料</button></details>}
            <details className="wb-record-attempts" open={record.member_ids.includes(selectedRunId)}><summary>处理记录{record.attempts.length > 1 ? ` · ${record.attempts.length} 次` : ''}</summary>
              {record.attempts.length > 1 && <div className="wb-attempt-list">{record.attempts.map((attempt, index) => <button className="wb-button" key={attempt.id} aria-pressed={selectedRunId === attempt.id} onClick={() => open(record, attempt.id)}>{index === 0 ? '首次下载' : `后续处理 ${index}`} · {LABELS[attempt.status] || attempt.status}</button>)}</div>}
              {record.member_ids.includes(selectedRunId) ? execution : <p className="wb-muted">正在读取执行明细…</p>}
            </details>
          </div>}
        </article>)}
      </div>
      <aside className="wb-records-detail-pane" aria-label="任务巡检与产出驾驶舱">
        <div className="wb-detail-cockpit-header">
          <div className="flex items-center gap-2">
            <Activity size={17} className="text-sky-600" />
            <h4>任务巡检与详情分屏</h4>
          </div>
          <span className="wb-muted">共 {records.length} 条记录</span>
        </div>
        <div className="wb-preview-metrics">
          <div><strong>{activeCount}</strong><span>进行中</span></div>
          <div><strong>{attentionCount}</strong><span>待处理</span></div>
          <div><strong>{completedCount}</strong><span>已完成</span></div>
        </div>
        {focusedRecord ? (
          <div className="wb-detail-focused-body">
            <div className="wb-detail-focused-title">
              <div>
                {recordSystemTags(focusedRecord).map(tag => <span key={tag} className={`wb-sys-badge mr-1.5 ${sysBadgeClass(tag)}`}>{tag}</span>)}
                <span className="wb-kind-badge ml-0 mr-2">{focusedRecord.kind === 'payroll' ? '薪资核算' : focusedRecord.kind === 'generate' ? '业务表生成' : '资料下载'}</span>
                <strong>{focusedRecord.kind === 'payroll' ? '兼职薪资核算批次' : focusedRecord.datasets.slice(0, 3).map(datasetLabel).join('、').replaceAll('（生成表）', '')}</strong>
              </div>
              <span className={focusedRecord.status === 'success' ? 'wb-success' : 'wb-muted'}>{LABELS[focusedRecord.status] || focusedRecord.status}</span>
            </div>
            <VerificationSummary record={focusedRecord} open={summaryRecord === focusedRecord.id} />
            <dl className="wb-preview-dl">
              <div><dt>数据来源</dt><dd>{recordSystemTags(focusedRecord).join(' + ')}</dd></div>
              <div><dt>覆盖城市</dt><dd>{focusedRecord.cities.join('、') || '全部城市'}</dd></div>
              <div><dt>业务周期</dt><dd className="font-mono">{focusedRecord.start} ~ {focusedRecord.end}</dd></div>
              <div><dt>执行进度</dt><dd className="font-mono">已完成 {focusedRecord.completed_items}/{focusedRecord.total_items} 项{focusedRecord.failed_items ? `（异常 ${focusedRecord.failed_items} 项）` : ''}</dd></div>
              <div><dt>可用产出</dt><dd className="font-mono">{focusedRecord.available_files} 个结果文件</dd></div>
            </dl>

            {/* 跨业务流水线联动 */}
            {!focusedRecord.datasets.includes('baize_employees') && focusedRecord.cities?.length > 0 && (onNavigateGenerate || onNavigatePayroll) && (
              <details className="wb-next-business p-3 mb-3 rounded-lg border border-sky-200"><summary>其他业务操作</summary>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-900 mb-1">
                  <span>⚡</span>
                  <span>跨页面流水线联动</span>
                </div>
                <p className="text-[11px] text-slate-600 mb-2">
                  自动将本次城市（{focusedRecord.cities.slice(0, 3).join('、')}{focusedRecord.cities.length > 3 ? `等${focusedRecord.cities.length}城` : ''}）与业务周期带入下游：
                </p>
                <div className="flex flex-wrap gap-2">
                  {onNavigateGenerate && focusedRecord.kind !== 'generate' && (
                    <button
                      type="button"
                      className="wb-button text-xs py-1.5 px-2.5 bg-white border-sky-300 text-sky-700 hover:bg-sky-50 font-medium inline-flex items-center gap-1 shadow-xs"
                      onClick={() => onNavigateGenerate(focusedRecord.cities, focusedRecord.start, focusedRecord.end)}
                    >
                      <FileSpreadsheet size={13} />
                      以此数据生成报表
                    </button>
                  )}
                  {onNavigatePayroll && focusedRecord.kind !== 'payroll' && (
                    <button
                      type="button"
                      className="wb-button text-xs py-1.5 px-2.5 bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-medium inline-flex items-center gap-1 shadow-xs"
                      onClick={() => onNavigatePayroll(focusedRecord.cities[0])}
                    >
                      <Calculator size={13} />
                      以此数据发起兼职结算
                    </button>
                  )}
                </div>
              </details>
            )}

            {focusedRecord.kind === 'payroll' ? (
              <div className="wb-detail-actions-box">
                <p className="wb-muted">当前聚焦为兼职薪资核算批次（{focusedRecord.applicants || 0} 条申请记录）。</p>
                <div className="wb-row mt-2">
                  <button type="button" className="wb-button" onClick={() => { if (focusedRecord.batch_id) onOpenPayroll?.(focusedRecord.batch_id); }}>在核算台打开此批次</button>
                </div>
              </div>
            ) : (() => {
              const primaryDeliverables = focusedRecord.files.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
              const otherFiles = focusedRecord.files.filter(f => !f.name.endsWith('.xlsx') && !f.name.endsWith('.xls'));
              return (
              <>
                <div className="wb-detail-files-box">
                  <div className="wb-row wb-space mb-2">
                    <h5 className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                      <FileSpreadsheet size={14} className="text-emerald-600" />
                      最终成品工作簿 ({primaryDeliverables.length})
                    </h5>
                    {focusedRecord.available_files > 0 && (
                      <button type="button" className="wb-link text-xs" disabled={!!busy} onClick={() => void download(focusedRecord)}>
                        <FolderArchive size={13} className="inline mr-1" />下载本批次全部结果 ({focusedRecord.available_files})
                      </button>
                    )}
                  </div>
                  {focusedRecord.files.length > 0 && (
                    <div className="wb-row mb-2.5">
                      <select
                        className="wb-select ml-0 flex-1 text-xs py-1.5"
                        aria-label={`分屏选择${focusedRecord.cities.join('、')}领取城市`}
                        value={bundleCity[focusedRecord.id] || ''}
                        onChange={event => setBundleCity(previous => ({ ...previous, [focusedRecord.id]: event.target.value }))}
                      >
                        <option value="">全部城市</option>
                        {[...new Set(focusedRecord.files.filter(file => file.available).map(file => file.city))].map(value => <option key={value}>{value}</option>)}
                      </select>
                      <button type="button" className="wb-button text-xs py-1.5 px-3 min-h-[32px]" disabled={!!busy || !focusedRecord.available_files} onClick={() => void download(focusedRecord, undefined, bundleCity[focusedRecord.id] || '')}>下载所选城市结果</button>
                    </div>
                  )}
                  {primaryDeliverables.length > 0 ? (
                    <ul className="wb-detail-file-ul">
                      {primaryDeliverables.map(file => (
                        <li key={`${file.run_id}:${file.id}`} className="border-emerald-200 bg-emerald-50/40">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5">.xlsx 成品</span>
                              <p className="truncate font-medium text-slate-900">{file.name}</p>
                            </div>
                            <small className="wb-muted">{file.available ? `${file.city} · ${(file.bytes / 1024).toFixed(1)} KB` : file.unavailable_reason || '文件不可访问'}</small>
                          </div>
                          <button type="button" className="wb-primary text-xs py-1 px-2.5" disabled={!!busy || !file.available} onClick={() => void download(focusedRecord, file)}>
                            <Download size={13} className="mr-1" />下载成品
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="wb-muted py-2 text-xs">当前批次暂无 .xlsx 成品工作簿。</p>
                  )}

                  {otherFiles.length > 0 && (
                    <details className="wb-generation-sources mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-slate-600">中间与原始数据文件 ({otherFiles.length} 个)</summary>
                      <ul className="wb-detail-file-ul mt-2">
                        {otherFiles.map(file => (
                          <li key={`${file.run_id}:${file.id}`}>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-xs">{file.name}</p>
                              <small className="wb-muted">{file.available ? `${file.city} · ${(file.bytes / 1024).toFixed(1)} KB` : file.unavailable_reason || '文件不可访问'}</small>
                            </div>
                            <button type="button" className="wb-button text-xs py-1" disabled={!!busy || !file.available} onClick={() => void download(focusedRecord, file)}>下载</button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {!!focusedRecord.source_files?.length && (
                  <details className="wb-generation-sources">
                    <summary>来源资料 · {focusedRecord.source_files.length} 个文件</summary>
                    <ul className="wb-detail-file-ul mt-2">
                      {focusedRecord.source_files.map(file => (
                        <li key={`${file.run_id}:${file.id}`}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{file.name}</p>
                            {!file.available && <small className="wb-muted">{file.unavailable_reason}</small>}
                          </div>
                          <button type="button" className="wb-button" disabled={!!busy || !file.available} onClick={() => void download(focusedRecord, file)}>下载来源</button>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="wb-button mt-2 w-full" disabled={!!busy || !focusedRecord.source_files.some(file => file.available)} onClick={() => void download(focusedRecord, undefined, '', true)}>打包来源资料</button>
                  </details>
                )}
                <details className="wb-record-attempts" open={focusedRecord.member_ids.includes(selectedRunId) || ACTIVE.has(focusedRecord.status) || focusedRecord.failed_items > 0 || focusedRecord.summary_issue}>
                  <summary>执行明细与技术诊断{focusedRecord.attempts.length > 1 ? ` · ${focusedRecord.attempts.length} 次记录` : ''}</summary>
                  {focusedRecord.attempts.length > 1 && (
                    <div className="wb-attempt-list mt-2">
                      {focusedRecord.attempts.map((attempt, index) => (
                        <button type="button" className="wb-button text-xs" key={attempt.id} aria-pressed={selectedRunId === attempt.id} onClick={() => open(focusedRecord, attempt.id)}>
                          {index === 0 ? '首次下载' : `后续处理 ${index}`} · {LABELS[attempt.status] || attempt.status}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2">
                    {focusedRecord.member_ids.includes(selectedRunId) ? execution : (
                      <button type="button" className="wb-link text-xs" onClick={() => open(focusedRecord)}>加载此批次完整执行诊断与分项重试</button>
                    )}
                  </div>
                </details>
              </>
              );
            })()}
          </div>
        ) : (
          <div className="wb-detail-empty">
            <p className="wb-muted">新建或选中左侧任务记录后，此处将固定展示该批次的产出文件清单、分项执行状态与快捷打包入口。</p>
          </div>
        )}
      </aside>
    </div>
  </section>;
}

function VerificationSummary({record, open}: {record: DownloadRecord; open: boolean}) {
  return <details className="wb-verification-summary" open={open}><summary>核验摘要 · 本批次</summary>
    <p>范围：{record.cities.join('、')} · {record.start} 至 {record.end}</p>
    <p>可领取成品 {record.available_files} 个 · 不可访问文件 {record.files.filter(file=>!file.available).length} 个 · 未完成资料 {record.failed_items} 项</p>
    <p>任务编号：{record.id.slice(0,8).toUpperCase()} · 处理记录 {record.attempts.length} 次</p>
    <p className="wb-muted">这是任务与文件状态摘要，不代表正式工资已获人工确认；来源资料、原始版本及日志在次级区域。</p>
  </details>;
}

function PayrollTaskCard({ record, focused, workspaceId, onFocus, onOpen }: {record: DownloadRecord; focused?: boolean; workspaceId: string; onFocus?: () => void; onOpen: () => void}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const downloadBusy = useRef(false);
  const downloadResult = async () => {
    if (!record.output || downloadBusy.current) return;
    downloadBusy.current = true; setDownloading(true); setDownloadError('');
    try { await downloadOutput(`/api/download?path=${encodeURIComponent(record.output)}&workspace_id=${encodeURIComponent(workspaceId)}`, workspaceId, '核算结果.zip'); }
    catch (error) { setDownloadError(error instanceof Error ? error.message : '下载失败，请重试'); }
    finally { downloadBusy.current = false; setDownloading(false); }
  };
  const link = new URL(window.location.href); link.searchParams.set('workspace', workspaceId); link.searchParams.set('batch', record.batch_id || '');
  return <article className={`wb-card wb-record ${focused ? 'is-focused' : ''}`} aria-label={`${record.cities.join('、')}核算任务`} onClick={onFocus}>
    <div className="wb-record-summary">
      <div className="wb-record-description"><h3><span className="wb-sys-badge mr-1.5 is-fengshen">风神</span><span className="wb-sys-badge mr-1.5 is-lanorange">蓝橙</span>兼职薪资核算<span className="wb-kind-badge">核算</span></h3><p className="wb-muted">{record.cities.join('、')} · {record.start} 至 {record.end}</p><p className="wb-muted">{record.created_at ? timestamp(record.created_at) : ''} · {record.applicants || 0} 条申请 · 资料 {record.completed_items}/{record.total_items} 项已处理</p>
      {record.status === 'success' && !record.available_files && <p className="wb-muted">结果文件暂不可访问，批次记录保留。</p>}</div>
      <span className={`wb-record-status ${record.status === 'success' ? 'wb-success' : 'wb-muted'}`}>{record.status === 'success' ? '已生成 · 待复核' : LABELS[record.status] || record.status}</span>
      <div className="wb-row wb-record-actions" onClick={e => e.stopPropagation()}>
        {record.available_files > 0 && record.output ? <><button type="button" className="wb-primary" disabled={downloading} onClick={() => void downloadResult()}><Download size={15} />{downloading ? '下载中…' : '下载结果'}</button><button type="button" className="wb-link" onClick={onOpen}>查看详情</button></> : <button type="button" className="wb-primary" onClick={onOpen}>{record.status === 'ready' ? '打开批次' : record.status === 'pending_download' ? '准备资料' : record.status === 'waiting_materials' ? '处理资料缺项' : ACTIVE.has(record.status) ? '查看进度' : '查看核算资料'}</button>}
      </div>
    </div>
    {downloadError && <div role="alert" className="wb-notice"><p>{downloadError}</p><button type="button" className="wb-button mt-2" onClick={onOpen}>打开批次查看结果文件</button></div>}
    <details className="wb-generation-sources" onClick={e => e.stopPropagation()}><summary>在手机继续此任务</summary><p className="wb-muted">在同一 Wi-Fi 的手机上打开此链接，可恢复相同工作区和批次。</p><input className="wb-input w-full" aria-label="手机继续核算链接" readOnly value={link.href} onFocus={event => event.target.select()} /></details>
  </article>;
}

