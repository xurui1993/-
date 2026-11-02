"""Business task intent; execution remains in the existing collectors/engines."""
# Presentation and scope contract for the report builder. Adding a report also
# requires its dataset/collector implementation; the page itself stays generic.
REPORTS = (
    {'id':'payment_binding', 'label':'骑手支付绑定', 'scope':'city_month',
     'systems':['风神','蓝橙','商翼'], 'station_rule':'separation',
     'description':'按城市和月份整理骑手支付绑定信息。',
     '_source_labels':['风神骑手数据明细','风神骑手绑定','风神骑手信息','蓝橙代领资料','商翼员工资料']},
    {'id':'abnormal_followup', 'label':'异常骑手跟进', 'scope':'city_month',
     'systems':['风神','蓝橙','商翼'], 'station_rule':'separation',
     'description':'以支付绑定为基准生成异常骑手跟进表。', '_source_group':'FOLLOWUP_DEPENDENCIES'},
    {'id':'abnormal_riders', 'label':'异常骑手整理', 'scope':'all',
     'systems':['蓝橙'], 'station_rule':'none',
     'description':'整理蓝橙全量异常骑手资料。', '_source_group':'ABNORMAL_RIDERS_DEPENDENCIES'},
)
GENERATORS = tuple(report['id'] for report in REPORTS)
TASK_LABELS = {'download': '资料下载', 'generate': '业务表生成', 'payroll': '兼职薪资核算'}

# Selection presets only; the existing collectors still validate and execute.
SCENARIOS = (
    {'id':'shangou_monthly_payroll','label':'闪购月度核算资料包','platform':'fengshen','description':'配送费、违规扣款、月度UB账单、风神绑定及骑手信息。','datasets':['delivery_fee','penalty','rider_monthly','receive_account','rider_info']},
    {'id':'shangou_daily_monitor','label':'闪购日常监控资料包','platform':'fengshen','description':'骑手数据明细、欺诈单及问题单。','datasets':['rider_detail','fraud','problem']},
    {'id':'lanorange_hr_full','label':'蓝橙人事全量资料包','platform':'lanorange','description':'骑手档案、价格档案、离职、批量离职及请假。','datasets':['lanorange_rider_archive','lanorange_part_price','lanorange_rider_quit','lanorange_batch_quit','lanorange_rider_leave']},
    {'id':'baize_employees','label':'商翼员工档案','platform':'baize','description':'账号可访问的全量员工原表。','datasets':['baize_employees']},
    {'id':'dengta_daily','label':'灯塔骑手日分析','platform':'xiaoxiang','description':'按日期导出日维度骑手分析。','datasets':['rider_daily']},
    {'id':'dengta_orders','label':'灯塔配送订单明细','platform':'xiaoxiang','description':'按日期导出配送订单明细。','datasets':['detail_orders']},
    {'id':'dengta_archive','label':'灯塔骑手档案','platform':'xiaoxiang','description':'账号全部站点的当前骑手档案快照。','datasets':['rider_archive']},
)
PLATFORMS = {'fengshen':'风神','lanorange':'蓝橙','baize':'商翼','xiaoxiang':'灯塔'}


def dataset_platform(key):
    if key == 'baize_employees':
        return 'baize'
    if key in ('rider_daily','detail_orders','detail_kesu','detail_reviews','rider_archive'):
        return 'xiaoxiang'
    return 'lanorange' if key.startswith('lanorange_') else 'fengshen'


def scenario_intent(payload, selected):
    if 'source_platform' not in payload and 'scenario_id' not in payload:
        return {}
    platform = payload.get('source_platform')
    if not isinstance(platform,str) or platform not in PLATFORMS or any(not isinstance(key,str) or dataset_platform(key) != platform for key in selected):
        raise ValueError('自定义资料须选择同一平台，专项报表来源由系统关联')
    scenario_id = payload.get('scenario_id', 'custom:' + platform)
    scenario = next((row for row in SCENARIOS if row['id'] == scenario_id), None)
    if scenario_id == 'custom:' + platform:
        label = '自定义资料 · ' + PLATFORMS[platform]
    elif scenario and scenario['platform'] == platform and set(scenario['datasets']) == set(selected):
        label = scenario['label']
    else:
        raise ValueError('业务包资料已变化，请改用自定义资料创建')
    return {'source_platform':platform,'scenario_id':scenario_id,'scenario_label':label}


def intent(payload):
    # Requests saved before task categories existed must keep their fingerprint.
    if 'task_kind' not in payload:
        return {}
    kind = payload['task_kind']
    selected = payload.get('datasets')
    if kind not in ('download', 'generate'):
        raise ValueError('请选择资料下载或业务表生成')
    if not isinstance(selected, list) or not selected:
        raise ValueError('请选择需要处理的资料或生成表')
    if kind == 'download':
        if any(value in GENERATORS for value in selected):
            raise ValueError('生成表请在业务表生成分类中选择')
        return {'task_kind': kind, **scenario_intent(payload, selected)}
    target = payload.get('generation_target')
    if target not in GENERATORS or selected != [target]:
        raise ValueError('一次业务表生成任务只能选择一张目标表，来源资料由系统关联')
    return {'task_kind': kind, 'generation_target': target}


def category(run):
    explicit = run.get('task_kind')
    if explicit in ('download', 'generate', 'payroll_source'):
        return explicit
    return 'generate' if any(value in GENERATORS for value in run.get('datasets', [])) else 'download'


def generators():
    import download_service as service
    return [{**{key:value for key,value in report.items() if not key.startswith('_')},
             'sources': report.get('_source_labels') or [service.DATASETS[key] for key in getattr(service,report['_source_group'])]}
            for report in REPORTS]
