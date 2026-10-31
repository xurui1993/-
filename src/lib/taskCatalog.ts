export type TaskKind = 'download' | 'generate' | 'payroll';
export const GENERATOR_IDS = ['payment_binding', 'abnormal_followup', 'abnormal_riders'] as const;
export const TASK_KIND_LABELS: Record<TaskKind, string> = { download: '资料下载', generate: '业务表生成', payroll: '兼职薪资核算' };
export const isGenerator = (id: string) => (GENERATOR_IDS as readonly string[]).includes(id);
export const inferTaskKind = (datasets: string[]): 'download' | 'generate' => datasets.some(isGenerator) ? 'generate' : 'download';
export function initialTaskKind(): TaskKind {
  if (new URLSearchParams(window.location.search).has('batch')) return 'payroll';
  try {
    const attempt = JSON.parse(sessionStorage.getItem('download-create-attempt:shared') || 'null');
    if (attempt?.payload?.datasets) return inferTaskKind(attempt.payload.datasets);
    const previous = localStorage.getItem('workbench_task_kind');
    if (previous === 'download' || previous === 'generate' || previous === 'payroll') return previous;
  } catch { /* Ignore malformed client preferences, never alter a pending request. */ }
  return 'download';
}
