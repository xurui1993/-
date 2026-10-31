import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateDeductionRows,
  connectionLabel,
  connectionSummary,
  SYSTEM_META,
  computeBillingPeriodRange,
  BUILTIN_DOWNLOAD_SCENARIOS,
  inferDatasetSystemTag,
  GENERATION_REPORT_CARDS,
  PAYROLL_MODE_CARDS,
  extractDeductionColumns,
  classifyTemplateCategory,
  getWorkbenchBreadcrumb,
  getPayrollSidebarBadge,
  SIDEBAR_NAV_GROUPS,
  getHeaderModuleContext,
  getPlatformStatusCluster,
  computeDownloadCapsuleState,
  getDefaultSeedNotifications,
  filterNotificationTasks,
  toggleNotificationFilterTab,
  getStageHeaderMeta,
  getPlatformCardBadge,
} from '../src/lib/workbench';
import { DOWNLOAD_PLATFORMS } from '../src/lib/downloadModules';

test('connection summary distinguishes signed-out, saved, unknown and validated sessions', () => {
  assert.equal(connectionSummary([{state:'signed_out'},{state:'saved'}]),'需连接');
  assert.equal(connectionSummary([{state:'ready'},{offline:true,state:'ready'}]),'状态未知');
  assert.equal(connectionSummary([{state:'ready'},{state:'ready'}]),'连接正常');
  assert.equal(connectionSummary([{state:'ready'},{state:'starting'}]),'连接中');
  assert.equal(connectionSummary([{state:'ready'},{state:'waiting_login'}]),'需验证');
});
import { isDownloadProxyPath } from '../server/downloadProxy.ts';

test('deduction editing preserves identifiers, custom columns and keyword flags', () => {
  const rows = [{ 城市: '测试城', 团队名称: '测试站', 团队ID: '00123', 投诉: 5, 投诉_isKw: true, 说明: '保留' }];
  assert.equal(validateDeductionRows(rows), rows);
  assert.equal(rows[0].团队ID, '00123');
  assert.throws(() => validateDeductionRows([rows[0], rows[0]]), /重复/);
  assert.throws(() => validateDeductionRows([{ ...rows[0], 投诉: NaN }]), /有效数字/);
  assert.throws(() => validateDeductionRows([{ 团队名称: '站点' }]), /城市/);
});

test('saved sessions remain unverified and network errors are not logged-out states', () => {
  assert.equal(connectionLabel('saved'), '待验证');
  assert.equal(connectionLabel('ready'), '已连接');
  assert.equal(connectionLabel('planned'), '待接入');
  assert.equal(connectionLabel('refreshing'), '检查中');
  assert.equal(connectionLabel('waiting_login'), '需要验证');
  assert.equal(connectionLabel('error'), '连接异常');
});

test('workbench writes preserve browser origin through the authenticated proxy', () => {
  assert.equal(isDownloadProxyPath('/api/workbench/deductions'), true);
  assert.equal(isDownloadProxyPath('/api/workbench/batches/abc/deductions'), true);
  assert.equal(isDownloadProxyPath('/api/workbench-other'), false);
});

test('source metadata separates Xiaoxiang online download from manual payroll and keeps Baize standalone', () => {
  assert.deepEqual(
    SYSTEM_META.map(item => item.label),
    ['风神', '蓝橙', '商翼', '灯塔', '灯塔'],
  );
  assert.equal(SYSTEM_META.find(item => item.key === 'lanorange')?.businessLine, '原雷神');
  assert.match(SYSTEM_META.find(item => item.key === 'dengta')!.description, /手动上传/);
  assert.match(SYSTEM_META.find(item => item.key === 'baize')!.description, /独立下载/);
});

test('billing period presets compute accurate start and end dates across month boundaries', () => {
  assert.deepEqual(computeBillingPeriodRange('last_full_month', '2026-03-18'), {
    start: '2026-02-01',
    end: '2026-02-28',
    label: '上月整月',
  });
  assert.deepEqual(computeBillingPeriodRange('last_full_month', '2026-01-10'), {
    start: '2025-12-01',
    end: '2025-12-31',
    label: '上月整月',
  });
  assert.deepEqual(computeBillingPeriodRange('current_first_half', '2026-05-22'), {
    start: '2026-05-01',
    end: '2026-05-15',
    label: '本月1-15日',
  });
  assert.deepEqual(computeBillingPeriodRange('last_second_half', '2026-05-22'), {
    start: '2026-04-16',
    end: '2026-04-30',
    label: '上月16-月末',
  });
  assert.deepEqual(computeBillingPeriodRange('current_month_to_date', '2026-05-22'), {
    start: '2026-05-01',
    end: '2026-05-22',
    label: '本月至今',
  });
});

test('built-in scenario presets and dataset system attribution map to 2-char system names', () => {
  assert.equal(BUILTIN_DOWNLOAD_SCENARIOS.length, 3);
  assert.equal(inferDatasetSystemTag('delivery_fee'), '风神');
  assert.equal(inferDatasetSystemTag('lanorange_rider_profile'), '蓝橙');
  assert.equal(inferDatasetSystemTag('shangyi_employees'), '商翼');
  assert.equal(inferDatasetSystemTag('delivery_fee', 'xiaoxiang'), '灯塔');
  assert.equal(inferDatasetSystemTag('rider_daily'), '灯塔');
});

test('report generation cards and payroll mode cards expose structured metadata and localized labels', () => {
  assert.equal(GENERATION_REPORT_CARDS.length, 3);
  assert.deepEqual(
    GENERATION_REPORT_CARDS.map(item => item.id),
    ['payment_binding', 'abnormal_followup', 'abnormal_riders'],
  );
  assert.equal(PAYROLL_MODE_CARDS.length, 3);
  assert.ok(PAYROLL_MODE_CARDS.every(card => !card.subtitle.toLowerCase().includes('template')));
});

test('extractDeductionColumns collects ordered numeric columns across sites while excluding reserved fields', () => {
  const rows: import('../src/lib/workbench').DeductionRow[] = [
    { 城市: '宁波', 团队名称: '海曙站', 团队ID: '001', 投诉: 50, 投诉_isKw: true, 差评: 20, 说明: '备注' },
    { 城市: '杭州', 团队名称: '西湖站', 投诉: 30, 迟到: 10 },
  ];
  assert.deepEqual(extractDeductionColumns(rows), {
    metaColumns: ['城市', '团队名称', '团队ID'],
    deductionColumns: ['投诉', '差评', '迟到'],
  });
});

test('classifyTemplateCategory categorizes templates by business line and payroll usage', () => {
  assert.equal(classifyTemplateCategory('美团小象兼职薪资核算.xlsx').tag, '美团小象');
  assert.equal(classifyTemplateCategory('淘宝闪购风神配送费模板.xlsx').tag, '淘宝闪购');
  assert.equal(classifyTemplateCategory('通用考勤导出表.xlsx').tag, '通用模板');
});

test('breadcrumb and sidebar status helpers reflect active view and batch state', () => {
  assert.equal(getWorkbenchBreadcrumb('create', 'download').title, '资料下载采集');
  assert.equal(getWorkbenchBreadcrumb('create', 'generate').title, '业务报表生成');
  assert.equal(getWorkbenchBreadcrumb('create', 'payroll').title, '兼职薪资结算');
  assert.equal(getWorkbenchBreadcrumb('history', 'download').title, '任务与产出中心');

  assert.equal(getPayrollSidebarBadge('calculated', false)?.label, '已出表');
  assert.equal(getPayrollSidebarBadge('calculating', true)?.tone, 'active');
  assert.equal(getPayrollSidebarBadge(undefined, false), null);
});

test('sidebar navigation converges into 3 groups with concise 4-character labels (including 白泽商翼) and unique semantic icons', () => {
  assert.deepEqual(
    SIDEBAR_NAV_GROUPS.map(group => group.title),
    ['数据采集', '核算与业务', '归档与配置'],
  );
  assert.deepEqual(
    DOWNLOAD_PLATFORMS.map(platform => platform.navLabel),
    ['风神数据', '蓝橙数据', '白泽商翼', '小象灯塔'],
  );
  const allItems = SIDEBAR_NAV_GROUPS.flatMap(group => group.items);
  assert.deepEqual(
    allItems.map(item => item.label),
    ['风神数据', '蓝橙数据', '白泽商翼', '小象灯塔', '专项报表', '薪资核算', '价格审批', '任务中心', '扣款规则', '模板中心'],
  );
  assert.ok(allItems.every(item => item.label.length === 4), 'Every sidebar item label should be exactly 4 Chinese characters');
  const iconSet = new Set(allItems.map(item => item.iconKey));
  assert.equal(iconSet.size, allItems.length, 'Every sidebar item must have a distinct semantic icon');
});

test('Scheme B header context and multi-platform status cluster map module groups and 4-source dot states', () => {
  assert.deepEqual(getHeaderModuleContext('create', 'download', 'fengshen', false), {
    groupLabel: '数据采集',
    title: '风神数据',
    subtitle: '按城市与账期采集配送费、违规扣款、UB账单及考勤源表',
    iconKey: 'compass',
  });
  assert.equal(getHeaderModuleContext('create', 'download', 'baize', false).title, '白泽商翼');
  assert.equal(getHeaderModuleContext('create', 'generate', 'fengshen', false).groupLabel, '核算与业务');
  assert.equal(getHeaderModuleContext('history', 'download', 'fengshen', true).groupLabel, '归档与配置');

  const cluster = getPlatformStatusCluster(
    {
      fengshen: { state: 'ready' },
      lanorange: { state: 'waiting_login' },
      baize: { state: 'starting', busy: true },
      xiaoxiang: { state: 'signed_out' },
    },
    null,
  );
  assert.deepEqual(
    cluster.map(item => [item.shortLabel, item.tone, item.statusText]),
    [
      ['风神', 'ready', '已连接'],
      ['蓝橙', 'warn', '需要验证'],
      ['商翼', 'busy', '连接中'],
      ['灯塔', 'idle', '未连接'],
    ],
  );
});

test('Scheme 1 download notification capsule computes running, blocked, completed, and idle states', () => {
  const seed = getDefaultSeedNotifications();
  const runningState = computeDownloadCapsuleState(seed);
  assert.equal(runningState.mode, 'running');
  assert.equal(runningState.tone, 'active');
  assert.equal(runningState.label, '风神采集中 · 宁波等3城 (65%)');
  assert.equal(runningState.unclaimedFileCount, 3);

  const completedOnly = seed.filter(item => item.status === 'completed');
  const completedState = computeDownloadCapsuleState(completedOnly);
  assert.equal(completedState.mode, 'completed');
  assert.equal(completedState.tone, 'ready');
  assert.equal(completedState.label, '下载已完成 · 3 份文件待领取');

  const blockedState = computeDownloadCapsuleState([
    ...completedOnly,
    {
      id: 'b1',
      title: '风神登录过期',
      scopeText: '宁波',
      systemTag: '风神',
      kind: 'download',
      status: 'blocked',
      availableFiles: 0,
    },
  ]);
  assert.equal(blockedState.mode, 'blocked');
  assert.equal(blockedState.tone, 'warn');
  assert.equal(blockedState.label, '1 项任务等待登录验证');

  const allClaimed = completedOnly.map(item => ({ ...item, claimed: true }));
  const idleState = computeDownloadCapsuleState(allClaimed);
  assert.equal(idleState.mode, 'idle');
  assert.equal(idleState.tone, 'idle');
  assert.equal(idleState.label, '下载通知 · 2');
});

test('notification popover header pills switch between downloading, completed, failed, and all tasks', () => {
  const seed = getDefaultSeedNotifications();
  assert.equal(filterNotificationTasks(seed, 'all').length, 4);
  assert.deepEqual(
    filterNotificationTasks(seed, 'downloading').map(item => item.id),
    ['seed_fengshen_active'],
  );
  assert.deepEqual(
    filterNotificationTasks(seed, 'completed').map(item => item.id),
    ['seed_fengshen_ready', 'seed_shangyi_ready'],
  );
  assert.deepEqual(
    filterNotificationTasks(seed, 'failed').map(item => item.id),
    ['seed_lanorange_failed'],
  );

  assert.equal(toggleNotificationFilterTab('all', 'downloading'), 'downloading');
  assert.equal(toggleNotificationFilterTab('downloading', 'completed'), 'completed');
  assert.equal(toggleNotificationFilterTab('completed', 'failed'), 'failed');
  assert.equal(toggleNotificationFilterTab('failed', 'failed'), 'all');
  assert.equal(toggleNotificationFilterTab('downloading', 'downloading'), 'all');
});

test('Scheme A stage header meta maps platform download and report generation local tabs', () => {
  assert.deepEqual(getStageHeaderMeta('download', 'fengshen', 'create'), {
    title: '风神下载',
    createTabLabel: '新建下载',
    historyTabLabel: '本模块记录',
    subtitle: '选择所需资料，再确认处理范围。',
  });
  assert.equal(getStageHeaderMeta('download', 'baize', 'create').title, '商翼下载');
  assert.equal(getStageHeaderMeta('download', 'xiaoxiang', 'create').title, '灯塔下载');
  assert.equal(getStageHeaderMeta('generate', undefined, 'create').createTabLabel, '生成报表');
  assert.match(getStageHeaderMeta('download', 'fengshen', 'history').subtitle, /采集任务进度/);
});

test('Scheme A platform card badge computes ready, warn, busy, and idle states', () => {
  assert.deepEqual(getPlatformCardBadge({ state: 'ready' }), { label: '已连接', tone: 'ready' });
  assert.deepEqual(getPlatformCardBadge({ state: 'waiting_login', busy: true }), { label: '需验证', tone: 'warn' });
  assert.deepEqual(getPlatformCardBadge({ state: 'saved' }), { label: '需验证', tone: 'warn' });
  assert.deepEqual(getPlatformCardBadge({ state: 'starting', busy: true }), { label: '连接中', tone: 'busy' });
  assert.deepEqual(getPlatformCardBadge({ state: 'ready' }, 'logout'), { label: '退出中', tone: 'busy' });
  assert.deepEqual(getPlatformCardBadge({ state: 'ready' }, 'verify'), { label: '验证中', tone: 'busy' });
  assert.deepEqual(getPlatformCardBadge({ state: 'signed_out' }), { label: '未登录', tone: 'idle' });
  assert.deepEqual(getPlatformCardBadge({ offline: true }), { label: '连接不可用', tone: 'idle' });
});





