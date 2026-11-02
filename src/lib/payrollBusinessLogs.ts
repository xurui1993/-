/** Presentation only: business events stay short; diagnostic evidence stays available. */
export interface PayrollLogInput {
  text?: string;
  msg?: string;
  level?: string;
  time?: string;
  timestamp?: string;
}
export interface PayrollLogLine {text: string; level: string; time?: string; count?: number}

const LABELS: Record<string, string> = {
  delivery_fee: '配送费', penalty: '违规扣款', rider_monthly: '骑手账单',
  fraud: '欺诈单', problem: '问题单', payment_binding: '骑手支付绑定',
  lanorange_part_price: '价格档案', rider_detail: '骑手数据明细',
  receive_account: '收薪账户', rider_info: '骑手信息',
};
const LEVEL = /\[(INFO|WARN(?:ING)?|ERR(?:OR|O)?|SYS(?:TEM)?\s*|SUCCESS|\s*OK\s*)\]/i;
const TECHNICAL = /\b(?:GC|MD5|SHA-?256|Traceback|KeyError|ValueError|RuntimeError|Exception|memory|heap)\b|垃圾回收|内存管线|聚合内存|高层架构|二进制|活动实体|子流|资源扫描|驻留时长|节点资源|数据链路|指纹|规则权重表|环境依赖|参数配置中心|映射字典|权限校验列表|缓冲池|历史快照|多线程数据分发|单元格已居中|列宽.*适配|排版美化|本地.*(?:输出|封包|路径)|处理成功[：:]/i;
const STACK_LINE = /^\s*(?:File\s+"|at\s+|Traceback\b|\^+\s*$|~+\s*$|During handling|The above exception|[A-Za-z_][\w.]*\s*\([^)]*\)\s*$)/;

function safeText(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\b(?:authorization)\s*[:=]\s*(?:Bearer\s+)?[^\r\n,;]+/gi, 'Authorization=[已隐藏]')
    .replace(/\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi, 'Cookie=[已隐藏]')
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|session[_-]?key)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;，；]+)/gi, match => match.split(/[:=]/, 1)[0].replace(/["']/g, '') + '=[已隐藏]')
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, '[链接已隐藏]');
}

function levelOf(input: PayrollLogInput, text: string): string {
  const source = (text.match(LEVEL)?.[1] || input.level || 'INFO').trim().toUpperCase();
  if (/^ERR/.test(source)) return 'ERROR';
  if (/^WARN/.test(source)) return 'WARN';
  if (/^(?:OK|SUCCESS)$/.test(source)) return 'SUCCESS';
  return /^SYS/.test(source) ? 'SYSTEM' : 'INFO';
}

function plain(text: string): string {
  return text
    .replace(LEVEL, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/^\s*(?:(?:>>>?|->|→|✓|✔|⚠)\s*)+/, '')
    .replace(/^\s*\[(?:下载|完成|恢复|过滤|账单)\]\s*/, '')
    .replace(/\s+/g, ' ').trim();
}

function businessText(text: string): string {
  let result = plain(text);
  result = result.replace(/\b(?:delivery_fee|penalty|rider_monthly|fraud|problem|payment_binding|lanorange_part_price|rider_detail|receive_account|rider_info)\b/g, id => LABELS[id]);
  // Translate legacy progress without showing opaque run IDs or guessed percentages.
  if (/^资料下载[：:]/.test(result)) {
    const phases: Record<string,string> = {queued:'排队中',preparing:'准备资料',downloading:'正在下载',validating:'整理资料',waiting_login:'等待平台登录',waiting_manual:'等待平台验证',waiting_export:'等待平台生成文件',waiting_collection:'等待采集资源',submitting:'提交导出',generating:'生成资料',publishing:'保存文件',running:'处理中',success:'下载完成',error:'下载失败',cancelled:'已停止',interrupted:'已中断'};
    result = result.replace(/\b[a-f0-9]{6,32}\s+([a-z_]+)\s+\d+(?:\.\d+)?%/g, (_match, phase: string) => phases[phase] || '处理中');
  }
  result = result
    .replace(/^成功从申请名单中提取业务城市[：:]\s*/, '已识别城市：')
    .replace(/^成功从申请名单中提取周期类型(?:\(首项\))?[：:]\s*/, '结算方式：')
    .replace(/^目标节点[：:]\s*\[([^\]]+)\][,，]\s*处理模式[：:]\s*\[([^\]]+)\]$/, '核算范围：$1 · $2')
    .replace(/^开始执行子任务\s*\[[^\]]+\][：:]\s*/, '开始核算：')
    .replace(/^[^\n]*薪资核算完成[。！!]?$/, '核算完成，可以下载结果');
  // A useful error remains visible while local machine paths move to diagnostics.
  result = result.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s，；。]+/g, value => value.split(/[\\/]/).filter(Boolean).at(-1) || '[本地路径]');
  return result;
}

function sameEvent(text: string): string {
  return text
    .replace(/(?:已等待|等待用时|已用时|耗时)\s*\d+(?:\.\d+)?\s*(?:毫秒|秒|分钟|分|小时)(?:\s*\d+\s*秒)?/g, '')
    .replace(/\d+(?:\.\d+)?%/g, '')
    .replace(/\s+/g, ' ').trim();
}

function append(lines: PayrollLogLine[], line: PayrollLogLine) {
  const previous = lines.at(-1);
  if (previous && previous.level === line.level && sameEvent(previous.text) === sameEvent(line.text)) {
    lines[lines.length - 1] = {...line, count: (previous.count || 1) + 1};
  } else lines.push(line);
}

export function businessLogEntries(logs: PayrollLogInput[]): {business: PayrollLogLine[]; technical: PayrollLogLine[]} {
  const business: PayrollLogLine[] = [], technical: PayrollLogLine[] = [];
  for (const input of logs) {
    const raw = safeText(input.text ?? input.msg ?? '').trim();
    if (!raw) continue;
    const level = levelOf(input, raw), time = input.time || input.timestamp;
    const isFailure = level === 'ERROR' || level === 'WARN';
    const multiline = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const containsStack = /Traceback\b|\n\s*File\s+"/.test(raw);
    if (containsStack) {
      technical.push({text:raw, level, ...(time ? {time} : {})});
      // Preserve the human explanation and final exception cause, not stack frames.
      const traceStart = multiline.findIndex(line => /Traceback\b|^File\s+"/.test(line));
      const first = multiline.slice(0, Math.max(0, traceStart)).find(line => !STACK_LINE.test(line));
      const cause = [...multiline].reverse().find(line => /^[\w.]+(?:Error|Exception):/.test(line));
      const message = first ? businessText(first) : cause ? businessText(cause).replace(/^[\w.]+(?:Error|Exception):\s*/, '执行失败：') : '核算执行出错，详情见技术诊断';
      append(business,{text:message,level:isFailure ? level : 'ERROR',...(time ? {time} : {})});
      continue;
    }
    const text = businessText(raw);
    if (!text) continue;
    const diagnostic = TECHNICAL.test(raw) || /(?:[A-Za-z]:[\\/]|\\\\)/.test(raw);
    if (diagnostic) technical.push({text:raw,level,...(time ? {time} : {})});
    if (diagnostic && !isFailure) continue;
    append(business,{text,level,...(time ? {time} : {})});
  }
  return {business,technical};
}
