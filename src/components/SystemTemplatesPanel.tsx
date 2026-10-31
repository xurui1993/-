import React, { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { classifyTemplateCategory } from '../lib/workbench';

export function SystemTemplatesPanel({onNavigatePayroll}: {onNavigatePayroll?:()=>void}) {
  const [templates, setTemplates] = useState<{ filename: string; size: number; available?:boolean; error?:string; scope?:string; business_line?:string; mtime?:number; content_version?:string }[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | '淘宝闪购' | '美团小象' | '通用模板'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const loaded = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (!loaded.current) setLoading(true);
      try {
        const response = await fetch('/api/templates/list', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.templates)) throw new Error('模板列表读取失败');
        if (!controller.signal.aborted) { setTemplates(data.templates); setError(''); loaded.current = true; }
      } catch { if (!controller.signal.aborted) setError('模板列表暂不可用，请刷新重试。'); }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(refresh, 15000); } }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [version]);
  const visible = templates.filter(item => {
    const matchesSearch = item.filename.toLowerCase().includes(search.trim().toLowerCase());
    if (!matchesSearch) return false;
    if (category === 'all') return true;
    return classifyTemplateCategory(item.filename).tag === category;
  });
  return <section className="wb-template-library" aria-label="系统模板库">
    <div className="wb-template-toolbar">
      <div className="wb-row gap-2">
        <div className="wb-segment" role="group" aria-label="模板业务线分类">
          {(['all', '淘宝闪购', '美团小象', '通用模板'] as const).map(cat => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {cat === 'all' ? '全部模板' : cat}
            </button>
          ))}
        </div>
        <span className="wb-muted">{search.trim() || category !== 'all' ? `找到 ${visible.length} / ${templates.length} 个模板` : `共 ${templates.length} 个标准核算模板`}</span>
      </div>
      <div className="wb-row"><input className="wb-input" aria-label="搜索模板" placeholder="搜索城市或模板名称" value={search} onChange={event => setSearch(event.target.value)} /><button className="wb-icon" aria-label="刷新模板列表" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div>
    </div>
    {error && <p role="alert" className="wb-error">{error}</p>}
    <div className="wb-template-list" tabIndex={0} aria-label="可下载模板">
      {loading ? <p role="status" className="wb-empty">正在加载模板…</p> : !visible.length ? <p className="wb-empty">{templates.length ? '没有匹配的模板。' : '暂无可用模板。'}</p> : visible.map(item => {
        const meta = classifyTemplateCategory(item.filename);
        return (
          <article className="wb-template-item" key={item.filename}>
            <FileSpreadsheet size={21} className="wb-template-icon" />
            <div>
              <div className="wb-row gap-1.5 mb-0.5">
                <span className={`wb-sys-badge ${meta.badgeClass}`}>{meta.tag}</span>
                <h3>{item.filename}</h3>
              </div>
              <p className="wb-muted">{item.scope||meta.tag} · {(item.size / 1024).toFixed(1)} KB{item.content_version&&` · 内容标识 ${item.content_version}`}</p>
            </div>
            {item.available===false?<div><p className="wb-error">{item.error||'模板不可用，请恢复正确版本'}</p><button className="wb-button" disabled>不可下载</button></div>:<a className="wb-button" aria-label={`下载 ${item.filename}`} href={`/api/download/template?file=${encodeURIComponent(item.filename)}`} download><Download size={15} />下载</a>}
          </article>
        );
      })}
    </div>
    {onNavigatePayroll&&<footer className="wb-template-next"><span>填写好薪资申请表后，到薪资核算上传。</span><button type="button" className="wb-button" onClick={onNavigatePayroll}>去薪资核算</button></footer>}
  </section>;
}

