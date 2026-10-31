import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  Download,
  FileText,
  RotateCcw,
  ArrowLeft,
} from 'lucide-react';
import type { TaskItem } from './CorePage';
import { downloadOutput } from '../lib/outputDownload';

export interface RunResult {
  action: string;
  status: 'success' | 'error';
  resultMsg: string;
  outPath?: string;
  finishedAt: number;
  stats?: Record<string, any>;
}

const ACTION_LABELS: Record<string, string> = {
  core: '兼职薪资核算',
  download_rider_sources: '骑手资料下载',
  download_shangyi_employees: '商翼员工下载',
};

interface RunResultCardProps {
  result: RunResult;
  taskQueue: TaskItem[];
  workspaceId: string;
  onOpenOutput: (path: string, title: string) => void;
  onRerun?: () => void;
  onDismiss: () => void;
  onToggleLog: () => void;
  logOpen: boolean;
}

export const RunResultCard = React.memo(function RunResultCard({
  result,
  taskQueue,
  workspaceId,
  onOpenOutput,
  onRerun,
  onDismiss,
  onToggleLog,
  logOpen,
}: RunResultCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const success = result.status === 'success';
  const label = ACTION_LABELS[result.action] || result.action;
  const doneCount = taskQueue.filter(t => t.status === 'completed').length;
  const errorCount = taskQueue.filter(t => t.status === 'error').length;
  const finishedAt = new Date(result.finishedAt).toLocaleTimeString();
  const statistics = result.stats?.batch_stats ? Object.values(result.stats.batch_stats).reduce<Record<string, number>>((total, item: any) => {
    for (const [key, value] of Object.entries(item || {})) if (typeof value === 'number') total[key] = (total[key] || 0) + value;
    return total;
  }, {}) : result.stats;
  const downloadUrl = result.outPath
    ? `/api/download?path=${encodeURIComponent(result.outPath)}&workspace_id=${encodeURIComponent(workspaceId)}`
    : null;
  const downloadResult = async () => {
    if (!downloadUrl || downloading) return;
    setDownloading(true); setDownloadError('');
    try {
      await downloadOutput(downloadUrl, workspaceId, '核算结果.zip');
    } catch (error) { setDownloadError(error instanceof Error ? error.message : '结果下载失败'); }
    finally { setDownloading(false); }
  };

  return (
    <section
      className={`shrink-0 rounded-xl border overflow-hidden bg-white ${
        success
          ? 'border-emerald-200'
          : 'border-rose-200'
      }`}
      aria-label="核算结果"
    >
      <div
        className={`h-1.5 w-full ${success ? 'bg-emerald-500' : 'bg-rose-500'}`}
      />
      <div className="p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          {success ? (
            <CheckCircle2 className="w-9 h-9 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-9 h-9 text-rose-600 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900">
              {success ? '任务完成' : '任务失败'} · {label}
            </h2>
            <p
              className={`text-sm mt-1 break-all ${success ? 'text-slate-600' : 'text-rose-600'}`}
            >
              {success ? '文件已生成，请检查异常明细及核算结果。' : result.resultMsg || '请展开日志查看失败原因。'}
            </p>
            <p className="text-[11px] font-mono text-slate-500 mt-1.5">
              完成时间 {finishedAt}
              {taskQueue.length > 0 &&
                ` · 子任务 ${doneCount}/${taskQueue.length} 成功${errorCount > 0 ? `，${errorCount} 个失败` : ''}`}
            </p>
          </div>
        </div>

        <details className="wb-verification-summary"><summary className="wb-button">查看本批次核验摘要</summary><p>任务：{label} · 完成于 {finishedAt}。子任务成功 {doneCount} 项、失败 {errorCount} 项。未提供的统计不视为零异常。</p>
        {success && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-slate-500">核算覆盖人数</span>
              <span className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                {statistics?.riders != null ? Number(statistics.riders).toLocaleString() : '未提供'} 人
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-slate-500">配送与对账单量</span>
              <span className="text-lg font-bold text-sky-700 font-mono tabular-nums">
                {statistics?.orders != null ? Number(statistics.orders).toLocaleString() : '未提供'} 单
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-slate-500">齐套对账状态</span>
              <span className="text-sm font-bold text-emerald-700 flex items-center gap-1 mt-1">
                查看本批次资料清单
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-slate-500">核算校验异常数</span>
              <span className={`text-lg font-bold font-mono tabular-nums ${
                (statistics?.intercepted || 0) + (statistics?.no_price || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}>
                {statistics?.intercepted == null && statistics?.no_price == null ? '未提供' : (statistics?.intercepted || 0) + (statistics?.no_price || 0)} 项
              </span>
            </div>
          </div>
        )}

        {success && statistics && (
          <div className="wb-result-stats">
            {[
              ['riders', '核算人数'],
              ['orders', '配送记录'],
              ['no_price', '无单价记录'],
              ['unbound', '未绑定记录'],
              ['intercepted', '拦截记录'],
            ]
              .filter(([key]) => typeof statistics[key] === 'number')
              .map(([key, label]) => {
                const count = statistics[key];
                const isAnomalyKey = ['no_price', 'unbound', 'intercepted'].includes(key);
                const hasAnomaly = isAnomalyKey && count > 0;
                const isClean = isAnomalyKey && count === 0;
                return (
                  <div
                    key={key}
                    className={`${hasAnomaly ? 'is-alert ring-1 ring-rose-400' : isClean ? 'is-safe' : ''}`}
                  >
                    <strong>
                      {count.toLocaleString()}
                      {hasAnomaly && <span className="ml-1 text-[10px] text-rose-600">⚠ 需排查</span>}
                      {isClean && <span className="ml-1 text-[10px] text-emerald-600 font-normal">正常</span>}
                    </strong>
                    <span>{label}</span>
                  </div>
                );
              })}
          </div>
        )}
        <p>文件生成不代表业务审批通过；请复核异常明细及工资结果。</p></details>
        {success && result.action === 'core' && <p className="wb-muted">结果可能包含公式，请使用 Excel / WPS 重算并复核。生成完成不代表人工已确认。</p>}
        <div className="wb-row wb-result-primary-actions">
          {downloadUrl && <button type="button" disabled={downloading} onClick={() => void downloadResult()} className="wb-primary"><Download size={16} />{downloading ? '正在下载…' : '下载本批次结果压缩包'}</button>}
          <button type="button" onClick={onDismiss} className="wb-button"><ArrowLeft size={16} />返回本批次准备台</button>
        </div>
        <details className="wb-advanced" open={!success}><summary>更多结果操作（文件、日志、再次核算）</summary>
          <div className="wb-row">
            {result.outPath && <button type="button" onClick={() => onOpenOutput(result.outPath!, `输出目录: ${label}`)} className="wb-button"><FolderOpen size={16} />查看本批次输出文件</button>}
            <button type="button" onClick={onToggleLog} className="wb-button"><FileText size={16} />{logOpen ? '收起日志' : '查看日志'}</button>
            {success && onRerun && result.action === 'core' && <button type="button" onClick={onRerun} className="wb-button"><RotateCcw size={16} />再次发起核算</button>}
          </div>
        </details>
        {downloadError && <div role="alert" className="wb-error"><p>{downloadError}</p>{result.outPath && <button type="button" className="wb-button mt-2" onClick={() => onOpenOutput(result.outPath!, `输出目录: ${label}`)}>改为逐个下载结果文件</button>}</div>}
      </div>
    </section>
  );
});
