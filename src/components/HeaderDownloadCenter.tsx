import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  Download,
  ExternalLink,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { saveDownloadBlob } from '../lib/outputDownload';
import {
  computeDownloadCapsuleState,
  filterNotificationTasks,
  getDefaultSeedNotifications,
  inferDatasetSystemTag,
  toggleNotificationFilterTab,
  type NotificationFilterTab,
  type NotificationTaskItem,
} from '../lib/workbench';

interface HeaderDownloadCenterProps {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  runningTask?: string | null;
  progress?: number;
  progressText?: string;
  onNavigateHistory: () => void;
  onOpenPlatformAuth: (platformKey?: string) => void;
  onShowToast?: (msg: string, type?: 'info' | 'success' | 'warn' | 'error') => void;
}

function sysBadgeClass(tag: NotificationTaskItem['systemTag']): string {
  if (tag === '风神') return 'is-fengshen';
  if (tag === '蓝橙') return 'is-lanorange';
  if (tag === '商翼') return 'is-baize';
  if (tag === '小象灯塔' || tag === '灯塔') return 'is-xiaoxiang';
  return 'is-fengshen';
}

export function HeaderDownloadCenter({
  apiFetch,
  runningTask,
  progress = 0,
  progressText = '',
  onNavigateHistory,
  onOpenPlatformAuth,
  onShowToast,
}: HeaderDownloadCenterProps) {
  const [open, setOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<NotificationFilterTab>('all');
  const [seedTasks, setSeedTasks] = useState<NotificationTaskItem[]>(() => getDefaultSeedNotifications());
  const [remoteTasks, setRemoteTasks] = useState<NotificationTaskItem[]>([]);
  const [claimedIds, setClaimedIds] = useState<Record<string, boolean>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);
  const lastHoverOpenAt = useRef<number>(0);

  const clearHoverTimer = () => {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearHoverTimer();
    if (!open) {
      lastHoverOpenAt.current = Date.now();
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    clearHoverTimer();
    hoverCloseTimer.current = window.setTimeout(() => {
      setOpen(false);
    }, 160);
  };

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearHoverTimer();
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadTasks = async () => {
      try {
        const response = await apiFetch('/api/workbench/tasks');
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const rawList = Array.isArray(data.records) ? data.records : [];
        const mapped: NotificationTaskItem[] = rawList.slice(0, 6).map((rec: any) => {
          const datasets: string[] = Array.isArray(rec.datasets) ? rec.datasets : [];
          const firstKey = datasets[0] || '';
          const systemTag = inferDatasetSystemTag(firstKey, rec.platform);
          const cities: string[] = Array.isArray(rec.cities) ? rec.cities : [];
          const citySummary =
            cities.length > 2
              ? `${cities.slice(0, 2).join('、')}等${cities.length}城`
              : cities.join('、') || '全部城市';
          const rawStatus = String(rec.status || '');
          const isRunningStatus = ['running', 'queued', 'starting', 'downloading'].includes(rawStatus);
          const isBlockedStatus = ['waiting_login', 'login_required', 'manual_required', 'blocked'].includes(rawStatus);
          const isCompletedStatus = ['completed', 'success', 'partial', 'done'].includes(rawStatus);
          const files = Array.isArray(rec.files) ? rec.files : [];
          const availableFiles = Number(rec.available_files ?? files.length ?? (isCompletedStatus ? 1 : 0));

          return {
            id: String(rec.id),
            batchId: String(rec.id),
            title: rec.title || `${systemTag}数据采集 · ${citySummary}`,
            scopeText: `${citySummary}${datasets.length ? ` · ${datasets.length} 项数据集` : ''}`,
            periodText:
              rec.start_date && rec.end_date ? `${rec.start_date} ~ ${rec.end_date}` : '全量快照',
            systemTag,
            kind: rec.kind === 'generate' ? 'generate' : 'download',
            status: isBlockedStatus
              ? 'blocked'
              : isRunningStatus
                ? 'running'
                : isCompletedStatus
                  ? 'completed'
                  : 'failed',
            progress: typeof rec.progress === 'number' ? rec.progress : isRunningStatus ? 58 : 100,
            phaseText: rec.message || (isRunningStatus ? '正在拉取并校验平台源表' : '已完成归档'),
            availableFiles,
            claimed: Boolean(claimedIds[String(rec.id)]),
            createdAt: rec.created_at ? String(rec.created_at).slice(5, 16) : '近期',
            files: files.map((file: any, idx: number) => ({
              id: String(file.id || `${rec.id}_${idx}`),
              name: String(file.name || file.filename || `${systemTag}_导出文件_${idx + 1}.xlsx`),
              city: String(file.city || citySummary),
              bytes: Number(file.bytes || 204800),
            })),
          };
        });
        if (!cancelled) {
          setRemoteTasks(mapped);
        }
      } catch {
        // Keep seed tasks when backend tasks endpoint is idle or unreachable
      }
    };
    loadTasks();
    const timer = window.setInterval(loadTasks, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiFetch, claimedIds]);

  const combinedTasks = useMemo<NotificationTaskItem[]>(() => {
    const liveTask: NotificationTaskItem[] = [];
    if (runningTask) {
      const isShangyi = runningTask === 'download_shangyi_employees';
      const isRider = runningTask === 'download_rider_sources';
      const sysTag: NotificationTaskItem['systemTag'] = isShangyi
        ? '商翼'
        : isRider
          ? '蓝橙'
          : '风神';
      const isBlocked = progressText.includes('验证') || progressText.includes('登录');
      liveTask.push({
        id: `live_${runningTask}`,
        title: isShangyi
          ? '商翼员工原始资料采集'
          : isRider
            ? '蓝橙骑手原始资料采集'
            : '兼职薪资自动核算与齐套',
        scopeText: progressText || '正在同步底层账单与人事档案',
        periodText: '当前批次',
        systemTag: sysTag,
        kind: isShangyi || isRider ? 'download' : 'payroll',
        status: isBlocked ? 'blocked' : 'running',
        progress: Math.max(5, Math.min(99, Math.round(progress || 42))),
        phaseText: progressText || '正在执行实时采集',
        availableFiles: 0,
        createdAt: '刚刚',
        platformKey: isShangyi ? 'baize' : isRider ? 'lanorange' : 'fengshen',
      });
    }

    const baseList = [...liveTask, ...remoteTasks, ...seedTasks];
    const seen = new Set<string>();
    return baseList
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .map(item => ({
        ...item,
        claimed: Boolean(item.claimed || claimedIds[item.id]),
      }));
  }, [runningTask, progress, progressText, remoteTasks, seedTasks, claimedIds]);

  const capsule = useMemo(() => computeDownloadCapsuleState(combinedTasks), [combinedTasks]);

  const downloadingCount = useMemo(
    () => combinedTasks.filter(item => item.status === 'running' || item.status === 'blocked').length,
    [combinedTasks],
  );

  const completedCount = useMemo(
    () => combinedTasks.filter(item => item.status === 'completed').length,
    [combinedTasks],
  );

  const failedCount = useMemo(
    () => combinedTasks.filter(item => item.status === 'failed').length,
    [combinedTasks],
  );

  const filteredTasks = useMemo(
    () => filterNotificationTasks(combinedTasks, filterTab),
    [combinedTasks, filterTab],
  );

  const handleClaimTask = async (task: NotificationTaskItem) => {
    setDownloadingId(task.id);
    try {
      if (task.batchId) {
        const response = await apiFetch(`/api/fengshen-downloads/records/${task.batchId}/bundle`);
        if (response.ok) {
          const blob = await response.blob();
          const filename = task.files?.[0]?.name || `${task.title.replace(/\s+/g, '_')}.zip`;
          await saveDownloadBlob(blob, filename);
        } else {
          const csvContent = `\uFEFF系统,任务名称,覆盖范围,账期,产出文件数,领取时间\n${task.systemTag},${task.title},${task.scopeText},${task.periodText || '全量'},${task.availableFiles},${new Date().toLocaleString()}\n`;
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
          const filename = (task.files?.[0]?.name || `${task.title}.csv`).replace(/\.(xlsx|zip)$/i, '.csv');
          await saveDownloadBlob(blob, filename);
        }
      } else {
        const fileRows = (task.files || [])
          .map(f => `${task.systemTag},${task.title},${f.city},${f.name},${f.bytes}`)
          .join('\n');
        const csvContent = `\uFEFF系统平台,任务名称,城市范围,文件名称,字节大小\n${
          fileRows || `${task.systemTag},${task.title},${task.scopeText},${task.title}_汇总.csv,204800`
        }\n`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        const rawName = task.files?.[0]?.name || `${task.systemTag}_${task.title}.csv`;
        const filename = rawName.replace(/\.(xlsx|zip)$/i, '.csv');
        await saveDownloadBlob(blob, filename);
      }

      setClaimedIds(prev => ({ ...prev, [task.id]: true }));
      setSeedTasks(prev =>
        prev.map(item => (item.id === task.id ? { ...item, claimed: true } : item)),
      );
      onShowToast?.(`已领取并下载：${task.title}`, 'success');
    } catch {
      onShowToast?.('文件领取失败，请稍后重试', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleFinishSeedTask = (taskId: string) => {
    setSeedTasks(prev =>
      prev.map(item =>
        item.id === taskId
          ? {
              ...item,
              status: 'completed',
              title: '风神月度采集 · 宁波等3城',
              progress: 100,
              phaseText: '已完成全部城市分片合并与校验',
              availableFiles: 3,
              claimed: false,
              files: [
                { id: 'f_nb_1', name: '宁波_杭州_上海_风神配送费汇总_202609.xlsx', city: '宁波等3城', bytes: 512000 },
                { id: 'f_nb_2', name: '宁波_杭州_上海_违规扣款明细_202609.xlsx', city: '宁波等3城', bytes: 248000 },
                { id: 'f_nb_3', name: '宁波_杭州_上海_月度UB账单_202609.csv', city: '宁波等3城', bytes: 184320 },
              ],
            }
          : item,
      ),
    );
    onShowToast?.('风神采集任务已完成，指示灯已切换为绿色完成态', 'success');
  };

  const ringProgress = Math.max(8, Math.min(100, capsule.progress ?? 65));
  const ringCircumference = 2 * Math.PI * 12;
  const ringDashoffset = ringCircumference * (1 - ringProgress / 100);

  return (
    <div
      className="wb-download-capsule-wrap"
      ref={wrapRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className={`wb-download-mini-btn is-${capsule.mode} ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        aria-label={`任务通知：${capsule.label}`}
        onClick={() => {
          if (open && Date.now() - lastHoverOpenAt.current < 350) {
            return;
          }
          setOpen(prev => !prev);
        }}
      >
        {capsule.mode === 'running' && (
          <svg className="wb-dl-mini-ring" viewBox="0 0 28 28" aria-hidden="true">
            <circle className="wb-dl-mini-ring-track" cx="14" cy="14" r="12" />
            <circle
              className="wb-dl-mini-ring-fill"
              cx="14"
              cy="14"
              r="12"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringDashoffset}
            />
          </svg>
        )}
        <Bell size={15} className="wb-dl-mini-bell" aria-hidden="true" />
        <span
          className={`wb-dl-status-lamp is-${capsule.mode}`}
          title={
            capsule.mode === 'running'
              ? `下载进行中 (${ringProgress}%)`
              : capsule.mode === 'blocked'
                ? '存在等待验证任务'
                : capsule.mode === 'completed'
                  ? '下载已完成，可领取文件'
                  : '全部任务已完成'
          }
        />
      </button>

      {open && (
        <section
          className="wb-download-popover"
          role="dialog"
          aria-label="任务进度悬浮卡片"
        >
          <header className="wb-notify-compact-header">
            <div className="wb-notify-compact-title">
              <button
                type="button"
                className={`wb-notify-title-btn ${filterTab === 'all' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('all')}
                title="点击查看全部任务"
              >
                任务进度
              </button>
              <span className="wb-notify-lamp-legend" role="group" aria-label="按任务状态筛选">
                <button
                  type="button"
                  data-testid="notify-filter-downloading"
                  aria-pressed={filterTab === 'downloading'}
                  className={`wb-legend-pill is-running ${
                    filterTab === 'downloading'
                      ? 'is-active'
                      : filterTab !== 'all'
                        ? 'is-dimmed'
                        : ''
                  }`}
                  onClick={() => setFilterTab(prev => toggleNotificationFilterTab(prev, 'downloading'))}
                  title={filterTab === 'downloading' ? '再次点击显示全部任务' : '仅看下载中任务'}
                >
                  <i className="wb-task-dot is-running" />
                  <span>{downloadingCount} 下载中</span>
                </button>
                <button
                  type="button"
                  data-testid="notify-filter-completed"
                  aria-pressed={filterTab === 'completed'}
                  className={`wb-legend-pill is-completed ${
                    filterTab === 'completed'
                      ? 'is-active'
                      : filterTab !== 'all'
                        ? 'is-dimmed'
                        : ''
                  }`}
                  onClick={() => setFilterTab(prev => toggleNotificationFilterTab(prev, 'completed'))}
                  title={filterTab === 'completed' ? '再次点击显示全部任务' : '仅看已完成任务'}
                >
                  <i className="wb-task-dot is-completed" />
                  <span>{completedCount} 已完成</span>
                </button>
                <button
                  type="button"
                  data-testid="notify-filter-failed"
                  aria-pressed={filterTab === 'failed'}
                  className={`wb-legend-pill is-failed ${
                    filterTab === 'failed'
                      ? 'is-active'
                      : filterTab !== 'all'
                        ? 'is-dimmed'
                        : ''
                  }`}
                  onClick={() => setFilterTab(prev => toggleNotificationFilterTab(prev, 'failed'))}
                  title={filterTab === 'failed' ? '再次点击显示全部任务' : '仅看下载失败任务'}
                >
                  <i className="wb-task-dot is-failed" />
                  <span>{failedCount} 下载失败</span>
                </button>
              </span>
            </div>
            <button
              type="button"
              className="wb-notify-more-link"
              onClick={() => {
                setOpen(false);
                onNavigateHistory();
              }}
            >
              <span>全部记录</span>
              <ExternalLink size={11} />
            </button>
          </header>

          <div className="wb-notify-compact-list">
            {filteredTasks.length === 0 ? (
              <div className="wb-notify-empty">
                <p>
                  {filterTab === 'downloading'
                    ? '当前暂无下载中任务'
                    : filterTab === 'completed'
                      ? '当前暂无已完成任务'
                      : filterTab === 'failed'
                        ? '当前暂无下载失败任务'
                        : '暂无下载或产出任务'}
                </p>
                {filterTab !== 'all' && combinedTasks.length > 0 && (
                  <button
                    type="button"
                    className="wb-notify-reset-filter"
                    onClick={() => setFilterTab('all')}
                  >
                    查看全部 ({combinedTasks.length})
                  </button>
                )}
              </div>
            ) : (
              filteredTasks.slice(0, 6).map(task => {
                const isClaimed = Boolean(task.claimed);
                const pct = Math.max(5, Math.min(100, Math.round(task.progress ?? 65)));
                return (
                  <article
                    key={task.id}
                    className={`wb-notify-compact-item is-${task.status}`}
                  >
                    <div className="wb-notify-row-main">
                      <div className="wb-notify-row-left">
                        <span
                          className={`wb-task-dot is-${task.status}`}
                          title={
                            task.status === 'running'
                              ? '下载进行中'
                              : task.status === 'blocked'
                                ? '等待登录验证'
                                : task.status === 'failed'
                                  ? '下载失败'
                                  : '下载已完成'
                          }
                        />
                        <span className={`wb-sys-badge ${sysBadgeClass(task.systemTag)}`}>
                          {task.systemTag}
                        </span>
                        <h4 title={task.title}>{task.title}</h4>
                      </div>

                      <div className="wb-notify-row-right">
                        {task.status === 'running' && (
                          <>
                            <span className="wb-notify-pct">{pct}%</span>
                            {task.id === 'seed_fengshen_active' && (
                              <button
                                type="button"
                                className="wb-notify-micro-btn"
                                onClick={() => handleFinishSeedTask(task.id)}
                                title="演示：立即完成采集"
                              >
                                完成
                              </button>
                            )}
                          </>
                        )}
                        {task.status === 'blocked' && (
                          <button
                            type="button"
                            className="wb-notify-micro-btn is-warn"
                            onClick={() => {
                              setOpen(false);
                              onOpenPlatformAuth(task.platformKey);
                            }}
                          >
                            <ShieldAlert size={11} />
                            <span>去验证</span>
                          </button>
                        )}
                        {task.status === 'failed' && (
                          <button
                            type="button"
                            className="wb-notify-micro-btn is-failed"
                            onClick={() => {
                              setOpen(false);
                              onNavigateHistory();
                            }}
                            title="前往任务中心排查或重试"
                          >
                            <RotateCcw size={11} />
                            <span>重试</span>
                          </button>
                        )}
                        {task.status === 'completed' && task.availableFiles > 0 && (
                          <button
                            type="button"
                            disabled={downloadingId === task.id}
                            className={`wb-notify-micro-btn ${isClaimed ? 'is-claimed' : 'is-ready'}`}
                            onClick={() => handleClaimTask(task)}
                          >
                            {isClaimed ? <Check size={11} /> : <Download size={11} />}
                            <span>
                              {downloadingId === task.id
                                ? '下载中'
                                : isClaimed
                                  ? '已领'
                                  : '领取'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {task.status === 'running' ? (
                      <div className="wb-notify-row-progress">
                        <div className="wb-notify-slim-track">
                          <div
                            className="wb-notify-slim-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="wb-notify-subtext">
                          {task.phaseText || task.scopeText}
                        </span>
                      </div>
                    ) : (
                      <div className="wb-notify-row-meta">
                        <span className="wb-notify-subtext">
                          {task.status === 'blocked'
                            ? '等待平台登录验证后继续采集'
                            : task.status === 'failed'
                              ? (task.phaseText || '采集失败，请在任务中心重试或检查配置')
                              : `下载完成 · ${task.availableFiles} 份文件 (${task.scopeText.split(' · ')[0]})`}
                        </span>
                        <time className="wb-notify-time">{task.createdAt || '近期'}</time>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
