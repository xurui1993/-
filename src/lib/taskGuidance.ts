export interface TaskContext {
  status: string;
  kind?: string;
  availableFiles?: number;
  failedItems?: number;
  summaryIssue?: boolean;
}

export interface TaskGuidance {
  label: string;
  hint: string;
  action: string;
  tone: 'neutral' | 'busy' | 'success' | 'warning' | 'error';
  needsAction: boolean;
}

/** Explain the next step without changing task execution or retry semantics. */
export function taskGuidance(task: TaskContext): TaskGuidance {
  const { status, kind, availableFiles = 0 } = task;
  const result = (label: string, hint: string, action: string, tone: TaskGuidance['tone'], needsAction = true): TaskGuidance => ({ label, hint, action, tone, needsAction });
  if (status === 'waiting_login') return result('等待认证', '完成对应平台登录后，回到原任务继续。', '完成验证', 'warning');
  if (status === 'waiting_manual') return result('等待验证', '完成平台人工验证，再检查原任务。', '完成验证', 'warning');
  if (status === 'needs_review') return result('待核实', '先核实已提交的结果，避免重复操作。', '核实结果', 'warning');
  if (status === 'awaiting_confirmation') return kind==='payroll'?result('待继续执行','打开原批次，继续自动获取资料并核算。','继续执行','warning'):result('待确认扣款', '确认扣款后自动获取资料并核算。', '确认扣款', 'warning');
  if (status === 'waiting_materials') return result('获取已暂停', kind==='payroll'?'模板或配送费不可用，请重新上传模板发起新任务。':'完成平台登录或重试失败项后继续原批次。', '处理异常', 'warning');
  if (status === 'pending_download') return result('待准备资料', '打开核算批次，准备本次所需资料。', '准备资料', 'warning');
  if (status === 'ready') return result('资料已就绪', '资料已准备好，可继续本批次核算。', '继续核算', 'success');
  if (['queued', 'running', 'preparing', 'calculating', 'stopping', 'cancelling'].includes(status)) {
    const stopping = ['stopping', 'cancelling'].includes(status);
    return result(status === 'queued' ? '排队中' : stopping ? '停止中' : '处理中', stopping ? '正在核实已发出的请求，请等待停止完成。' : '任务在后台继续，可查看进度或稍后到任务中心领取结果。', '查看进度', 'busy');
  }
  if (['error', 'failed', 'interrupted'].includes(status)) return result(status === 'interrupted' ? '已中断' : '未完成', '查看异常原因和已保留资料，按原任务提示恢复。', '查看并处理', 'error');
  if (status === 'partial' || (task.failedItems || 0) > 0 || task.summaryIssue) return result('部分完成', availableFiles ? '已有结果可先下载；请查看未完成项，再决定后续处理。' : '查看未完成项，按提示继续原任务。', '处理未完成项', 'warning');
  if (['success', 'completed', 'calculated'].includes(status)) {
    if (kind === 'approval') return result('已完成', '查看审批结果；需要留档时下载回执。', '查看审批记录', 'success', false);
    return result(kind === 'payroll' ? '已生成 · 待复核' : '已完成', availableFiles ? (kind === 'payroll' ? '下载结果后，用 Excel / WPS 重算并复核。' : '下载结果，按需展开文件或领取复核资料。') : '记录已完成，文件可用情况请查看详情。', availableFiles ? '下载结果' : '查看详情', 'success', false);
  }
  if (['cancelled', 'stopped'].includes(status)) return result('已停止', '已保留任务记录与现有结果，可在详情中查看。', '查看详情', 'neutral', false);
  return result('状态待确认', '打开对应记录，确认当前状态后再操作。', '查看详情', 'neutral');
}

/** Only offer handoffs supported by the existing Fengshen/Blue Orange flows. */
export function taskHandoffs(kind: string, datasets: string[], cities: string[]) {
  const supported = datasets.some(id => id.startsWith('lanorange_') || ['delivery_fee', 'penalty', 'rider_monthly', 'rider_info', 'rider_detail', 'receive_account', 'fraud', 'problem', 'goods_rent'].includes(id));
  return {
    generate: kind === 'download' && supported,
    payroll: ['download', 'generate'].includes(kind) && (supported || datasets.some(id => ['payment_binding', 'abnormal_followup'].includes(id))),
    cities: cities.filter(city => !['全部城市', '当前商家'].includes(city)),
  };
}
