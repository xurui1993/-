import { PayrollReviewSummary } from './PayrollReviewSummary';
import { PayrollPerformancePanel } from './PayrollPerformancePanel';
import React, { useEffect, useRef, useState } from 'react';
import {
  CloudDownload,
  FolderOpen,
  KeyRound,
  Files,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Search,
  RefreshCw,
  X,
  ChevronDown,
  History,
  ShieldCheck,
  Building2,
  SlidersHorizontal,
} from 'lucide-react';
import { AppConfig, LogEntry } from '../types';
import { ControlPanel } from './ControlPanel';
import { ExecutionCockpit } from './ExecutionCockpit';
import { RunResultCard, RunResult } from './RunResultCard';
import { TerminalPanel } from './TerminalPanel';
import { PayrollPreparation, PayrollPreparationState } from './PayrollPreparation';
import { DataReadinessMatrix } from './DataReadinessMatrix';

import { SystemTemplatesPanel } from './SystemTemplatesPanel';
import { WorkbenchDrawer } from './WorkbenchDrawer';
import { OutputExplorer } from './OutputExplorer';
import { FengshenAuthStatus } from './FengshenLoginModal';
import { PAYROLL_MODE_CARDS } from '../lib/workbench';

export interface TaskItem {
  id: string;
  name: string;
  fileCount?: number;
  totalSize?: number;
  estimatedTime?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  outPath?: string;
  mtime?: number;
  isSalaryBind?: boolean;
}

export type RunOverrides = { action: string; [key: string]: any };

interface CorePageProps {
  onOpenSettings?: () => void;
  onOpenDeductions: (defaultOnly?: boolean) => void;
  onOpenConnections: () => void;
  onOpenDownloads: () => void;
  onNavigateDownloadCenter?: () => void;
  deductionVersion: number;
  resumeVersion: number;
  appTheme: 'light' | 'dark';
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
  runningTask: string | null;
  isRiderSourceUploading: boolean;
  progress: number;
  progressText: string;
  logs: LogEntry[];
  taskQueue: TaskItem[];
  payrollPreparation: PayrollPreparationState | null;
  onPreparationChange: (value: PayrollPreparationState) => void;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  uploadExtracted: (file: File) => Promise<{ path: string } | null>;
  onRun: (overrides: RunOverrides) => void;
  onUploadFiles: (files: { file: File; relativePath: string }[]) => Promise<void>;
  onDownloadRiderSources: (file: File) => Promise<void>;
  onDownloadShangyi: () => void;
  onOpenShangyi?: () => void;
  onOpenRiderSources?: () => void;
  onOpenFengshenLogin: () => void;
  fengshenAuthStatus?: FengshenAuthStatus | null;
  lastOutputFolder?: string | null;
  lastRunResult: RunResult | null;
  workspaceId: string;
}

const MODE_OPTIONS = [
  ['fengshen', '淘宝闪购 · 自动齐套（风神+蓝橙）'],
  ['manual', '淘宝闪购 · 手动上传'],
  ['xiaoxiang', '美团灯塔 · 手动上传'],
] as const;

const MODE_LABELS: Record<string, string> = {
  manual: '淘宝闪购 · 手动上传',
  fengshen: '淘宝闪购 · 自动齐套',
  xiaoxiang: '美团灯塔 · 手动上传',
};

export function CorePage({
  onOpenSettings, onOpenDeductions, onOpenConnections, onOpenDownloads, onNavigateDownloadCenter, deductionVersion, resumeVersion,
  appTheme,
  config,
  onConfigChange,
  runningTask,
  isRiderSourceUploading,
  progress,
  progressText,
  logs,
  taskQueue,
  payrollPreparation,
  onPreparationChange,
  apiFetch,
  uploadExtracted,
  onRun,
  onUploadFiles,
  onDownloadRiderSources,
  onDownloadShangyi,
  onOpenShangyi,
  onOpenRiderSources,
  onOpenFengshenLogin,
  fengshenAuthStatus,
  lastOutputFolder,
  lastRunResult,
  workspaceId,
}: CorePageProps) {
  const [deductionSummary, setDeductionSummary] = useState('使用默认扣款配置');
  const [newUpload, setNewUpload] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [view, setView] = useState<'prepare' | 'run' | 'result'>('prepare');
  const [runKey, setRunKey] = useState(0);
  const [resultLogOpen, setResultLogOpen] = useState(false);
  const [viewing, setViewing] = useState<{ path: string; title: string } | null>(null);
  const [showReadinessMatrix, setShowReadinessMatrix] = useState(false);
  const prevRunning = useRef(false);
  useEffect(() => {const open=()=>setMoreOpen(true);window.addEventListener('workbench:payroll-more',open);return()=>window.removeEventListener('workbench:payroll-more',open);}, []);

  const [shangyiAvailable, setShangyiAvailable] = useState(false);
  const riderTemplateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const url = payrollPreparation && !newUpload ? `/api/workbench/batches/${payrollPreparation.id}/deductions` : '/api/workbench/deductions';
    
    void apiFetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      const summaryText = `${data.scope === 'batch' ? '本次独立配置' : '默认配置'} · ${data.rows.length} 个站点${data.frozen ? ' · 已固定' : ''}`;
      setDeductionSummary(summaryText);
    }).catch(() => { if (!controller.signal.aborted) setDeductionSummary('扣款配置读取失败，请检查设置'); });
    return () => controller.abort();
  }, [payrollPreparation?.id, payrollPreparation?.status, deductionVersion, newUpload, workspaceId]);

  const isRunning =
    runningTask === 'core' ||
    runningTask === 'download_rider_sources' ||
    runningTask === 'download_shangyi_employees' ||
    isRiderSourceUploading;
  const mode = config.payrollSourceMode || 'fengshen';

  useEffect(() => {
    let disposed = false;
    fetch('/api/parttime/shangyi/status', { signal: AbortSignal.timeout(10000) })
      .then(response => {
        if (!response.ok) throw new Error('status unavailable');
        return response.json();
      })
      .then(data => { if (!disposed) setShangyiAvailable(data.available === true); })
      .catch(() => { if (!disposed) setShangyiAvailable(false); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (isRunning) {
      if (!prevRunning.current) {
        setRunKey(k => k + 1);
        setResultLogOpen(false);
      }
      prevRunning.current = true;
      setView('run');
    } else {
      if (prevRunning.current) {
        const waiting =
          payrollPreparation?.status === 'waiting_materials' ||
          payrollPreparation?.status === 'ready';
        const fresh = lastRunResult && Date.now() - lastRunResult.finishedAt < 8000;
        setView(!fresh && waiting ? 'run' : 'result');
      }
      prevRunning.current = false;
    }
  }, [isRunning]);

  useEffect(() => { setNewUpload(false); if (payrollPreparation && !isRunning) setView('prepare'); }, [payrollPreparation?.id, resumeVersion]);
  const cockpitTitle =
    runningTask === 'download_rider_sources'
      ? '骑手资料下载'
      : runningTask === 'download_shangyi_employees'
        ? '商翼员工下载'
        : '兼职薪资核算';

  const cockpitSubtitle = [
    payrollPreparation?.plan.city || config.city,
    payrollPreparation ? `${payrollPreparation.plan.start} 至 ${payrollPreparation.plan.end}` : '',
    runningTask === 'download_rider_sources' || runningTask === 'download_shangyi_employees'
      ? '资料下载'
      : MODE_LABELS[mode],
  ]
    .filter(Boolean)
    .join(' · ');

  const paused =
    !isRunning &&
    (payrollPreparation?.status === 'waiting_materials' || payrollPreparation?.status === 'ready');

  const preparationCard = payrollPreparation ? (
    <div className="wb-preparation-wrap">
      <PayrollPreparation
        value={payrollPreparation}
        busy={isRunning}
        apiFetch={apiFetch}
        onChange={onPreparationChange}
        upload={uploadExtracted}
        onContinue={() => {
          onRun({ action: 'core', payrollPreparationId: payrollPreparation.id, payrollSourceMode: payrollPreparation.mode, city: payrollPreparation.plan.city, preparationOnly: false, deductionConfigVersion: '' });
        }}
      />
    </div>
  ) : null;

  if (viewing) {
    return (
      <div className="flex-1 min-h-0 flex flex-col w-full h-full relative">
        <div className="absolute top-2 left-2 z-30">
          <button
            onClick={() => setViewing(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
          >
            <ChevronDown className="w-4 h-4 rotate-90" />
            返回
          </button>
        </div>
        <OutputExplorer
          path={viewing.path}
          appTheme={appTheme}
          onClose={() => setViewing(null)}
          title={viewing.title}
        />
      </div>
    );
  }

  const openViewing = (path: string, title: string) => setViewing({ path, title });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ============ 执行态：驾驶舱 ============ */}
      {view === 'run' && (
        <ExecutionCockpit
          appTheme={appTheme}
          runKey={runKey}
          running={isRunning}
          paused={paused}
          title={paused ? '兼职薪资核算' : cockpitTitle}
          subtitle={cockpitSubtitle}
          progress={progress}
          progressText={progressText}
          logs={logs}
          taskQueue={runningTask === 'core' || paused ? taskQueue : []}
          preparationSlot={preparationCard}
          onOpenOutput={openViewing}
          onBack={paused ? () => setView('prepare') : undefined}
        />
      )}

      {/* ============ 完成态：结果卡 + 可展开日志 ============ */}
      {view === 'result' && lastRunResult && (
        <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
          <RunResultCard
            result={lastRunResult}
            taskQueue={taskQueue}
            workspaceId={workspaceId}
            onOpenOutput={openViewing}
            onRerun={() => setView('prepare')}
            onDismiss={() => setView('prepare')}
            onToggleLog={() => setResultLogOpen(v => !v)}
            logOpen={resultLogOpen}
          />
          {resultLogOpen && (
            <div className="shrink-0 h-[320px] rounded-xl overflow-hidden border border-slate-200">
              <TerminalPanel
                appTheme={appTheme}
                logs={logs}
                progress={progress}
                progressText={progressText}
                isRunning={false}
                showFooterProgress={false}
              />
            </div>
          )}
        </div>
      )}

      {(view === 'prepare' || (view === 'result' && !lastRunResult)) && (() => {
        const activeStep = !payrollPreparation || newUpload ? 1 : payrollPreparation.status === 'calculated' ? 3 : 2;
        const effectiveMode = payrollPreparation && !newUpload ? payrollPreparation.mode : mode;
        const isXiaoxiang = effectiveMode === 'xiaoxiang';
        return (
        <div className="wb-payroll wb-task-form wb-payroll-simple">
          <div className="wb-form-heading wb-row wb-space">
            <div>
              <h2>兼职薪资核算</h2>
              <p className="wb-muted">上传申请表后自动识别范围、准备资料并核算；有缺项时暂停。</p>
            </div>
            <button type="button" className="wb-button" onClick={() => setMoreOpen(true)}>
              更多设置
            </button>
          </div>

          <div className="wb-payroll-stepper" aria-label="薪资核算流程步骤">
            <div className={`wb-step-item ${activeStep === 1 ? 'is-active' : activeStep > 1 ? 'is-done' : ''}`}>
              <span className="wb-step-num">{activeStep > 1 ? '✓' : '1'}</span>
              <div><strong>1. 上传申请表</strong><small>识别申请城市、周期与人数</small></div>
            </div>
            <div className="wb-step-divider" />
            <div className={`wb-step-item ${activeStep === 2 ? 'is-active' : activeStep > 2 ? 'is-done' : ''}`}>
              <span className="wb-step-num">{activeStep > 2 ? '✓' : '2'}</span>
              <div><strong>2. 自动准备与核算</strong><small>缺项暂停，补齐后继续</small></div>
            </div>
            <div className="wb-step-divider" />
            <div className={`wb-step-item ${activeStep === 3 ? 'is-active' : payrollPreparation?.status === 'calculated' && !newUpload ? 'is-done' : ''}`}>
              <span className="wb-step-num">{payrollPreparation?.status === 'calculated' && !newUpload ? '✓' : '3'}</span>
              <div><strong>3. 下载结果</strong><small>查看结果与实际采用的规则</small></div>
            </div>
          </div>

          <section className="wb-form-body">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-sm">核算方式：</h3>
                <div className="wb-segment wb-payroll-modes" role="tablist" aria-label="核算方式">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveMode === 'fengshen'}
                    aria-pressed={effectiveMode === 'fengshen'}
                    title="自动获取风神账单与蓝橙档案，缺项可手动补传"
                    disabled={isRunning || (!!payrollPreparation && !newUpload)}
                    onClick={() => onConfigChange({ payrollSourceMode: 'fengshen', payrollPreparationId: '' })}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${effectiveMode === 'fengshen' ? 'is-active' : ''}`}
                  >
                    <span>闪购自动</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveMode === 'manual'}
                    aria-pressed={effectiveMode === 'manual'}
                    title="手动上传闪购核算资料"
                    disabled={isRunning || (!!payrollPreparation && !newUpload)}
                    onClick={() => onConfigChange({ payrollSourceMode: 'manual', payrollPreparationId: '' })}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${effectiveMode === 'manual' ? 'is-active' : ''}`}
                  >
                    <span>闪购手动</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveMode === 'xiaoxiang'}
                    aria-pressed={effectiveMode === 'xiaoxiang'}
                    title="手动上传灯塔账单与配送数据"
                    disabled={isRunning || (!!payrollPreparation && !newUpload)}
                    onClick={() => onConfigChange({ payrollSourceMode: 'xiaoxiang', payrollPreparationId: '' })}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${effectiveMode === 'xiaoxiang' ? 'is-active' : ''}`}
                  >
                    <span>灯塔超市</span>
                  </button>
                </div>
              </div>

            </div>
            {payrollPreparation && !newUpload ? (
              <div className="wb-batch-summary flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 mb-3">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold text-slate-900 bg-white px-2.5 py-1 rounded border border-slate-300">
                    已载入申请表 · {payrollPreparation.plan.city}
                  </span>
                  <span className="text-slate-600">{payrollPreparation.plan.start} 至 {payrollPreparation.plan.end}</span>
                  <span className="text-slate-600">{payrollPreparation.plan.applicants} 条记录</span>
                </div>
                <button
                  type="button"
                  className="wb-button text-xs py-1 px-3 border border-slate-300 hover:bg-slate-100 font-medium"
                  disabled={isRunning || payrollPreparation.status === 'calculating'}
                  onClick={() => setNewUpload(true)}
                >
                  重新上传/替换申请表
                </button>
              </div>
            ) : null}
            {payrollPreparation && !newUpload && payrollPreparation.status !== 'calculated' ? preparationCard : null}
            {payrollPreparation?.status === 'calculated' && !newUpload && <div className="wb-notice">本批次已生成结果。<a className="wb-link" href={`/api/download?path=${encodeURIComponent(payrollPreparation.result?.output || '')}&workspace_id=${encodeURIComponent(workspaceId)}`}>下载结果</a> · 重新上传薪资申请表可新建批次。</div>}
            {payrollPreparation?.status === 'calculated' && !newUpload && <PayrollReviewSummary review={payrollPreparation.result?.review_summary}/>}
            {payrollPreparation?.status === 'calculated' && !newUpload && <details className="wb-advanced"><summary>核算性能记录</summary><PayrollPerformancePanel value={payrollPreparation.performance}/></details>}
            {!payrollPreparation || newUpload ? <ControlPanel payrollSourceMode={mode} onUploadFiles={onUploadFiles} onOpenTemplates={() => setTemplatesOpen(true)} isRunning={isRunning || payrollPreparation?.status === 'calculating'} /> : null}
            <div className="wb-row wb-space mt-3"><span className="wb-muted">已有资料可随薪资申请表一并上传，缺项可逐项补传。</span><button className="wb-link" onClick={onOpenDownloads}>查看任务记录</button></div>
          </section>

        </div>
        );
      })()}

      {moreOpen && <WorkbenchDrawer title="核算更多设置" onClose={() => setMoreOpen(false)}>
        <p className="wb-muted">以下为按需使用的辅助功能，不影响默认自动处理流程。</p>
        <div className="wb-more-actions">
          <button className="wb-button" onClick={() => {setMoreOpen(false);setShowReadinessMatrix(true);}}>本批次资料清单</button>
          <div><p>站点扣款规则：{deductionSummary}</p><button className="wb-button" onClick={() => {setMoreOpen(false);onOpenDeductions(newUpload || !payrollPreparation);}}>查看或调整扣款规则</button></div>
          <button className="wb-button" onClick={() => {setMoreOpen(false);onNavigateDownloadCenter ? onNavigateDownloadCenter() : onOpenDownloads();}}>资料采集中心</button>
          <button className="wb-button" onClick={() => {setMoreOpen(false);onOpenConnections();}}>系统连接</button>
          <button className="wb-button" onClick={() => {setMoreOpen(false);setTemplatesOpen(true);}}>标准模板</button>
          {onOpenSettings && <button className="wb-button" onClick={() => {setMoreOpen(false);onOpenSettings();}}>工作台设置</button>}
        </div>
      </WorkbenchDrawer>}

      {showReadinessMatrix && (
        <WorkbenchDrawer
          title="本批次资料清单"
          wide
          onClose={() => setShowReadinessMatrix(false)}
        >
          <DataReadinessMatrix
            preparation={newUpload ? null : payrollPreparation}
          />
        </WorkbenchDrawer>
      )}

      {templatesOpen && <WorkbenchDrawer title="系统模板" wide bodyClassName="wb-template-body" onClose={() => setTemplatesOpen(false)}><SystemTemplatesPanel onNavigatePayroll={()=>setTemplatesOpen(false)} /></WorkbenchDrawer>}

    </div>
  );
}
