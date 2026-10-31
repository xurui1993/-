import { PayrollReviewSummary, type PayrollReview } from './PayrollReviewSummary';
import { TaskOutcome } from './TaskOutcome';
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
  review?: PayrollReview;
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
              {success ? '文件已生成，请检查异常明细及核算结果。' : result.resultMsg || '查看下方处理建议，按需展开日志定位原因。'}
            </p>
            <p className="text-[11px] font-mono text-slate-500 mt-1.5">
              完成时间 {finishedAt}
              {taskQueue.length > 0 &&
                ` · 子任务 ${doneCount}/${taskQueue.length} 成功${errorCount > 0 ? `，${errorCount} 个失败` : ''}`}
            </p>
          </div>
        </div>

        <TaskOutcome task={{status: success ? (errorCount ? 'partial' : 'success') : 'error', kind:result.action==='core'?'payroll':'download', availableFiles:downloadUrl ? 1 : 0, failedItems:errorCount}}/>
        {success && result.action === 'core' && <PayrollReviewSummary review={result.review}/>}
        {success && result.action === 'core' && <p className="wb-muted">结果可能包含公式，请使用 Excel / WPS 重算并复核。生成完成不代表人工已确认。</p>}
        <div className="wb-row wb-result-primary-actions">
          {downloadUrl && <button type="button" disabled={downloading} onClick={() => void downloadResult()} className="wb-primary"><Download size={16} />{downloading ? '正在下载…' : '下载本批次结果压缩包'}</button>}
          <button type="button" onClick={onDismiss} className="wb-button"><ArrowLeft size={16} />返回本批次准备台</button>
        </div>
        <details className="wb-advanced"><summary>更多结果操作（文件、日志、再次核算）</summary>
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
