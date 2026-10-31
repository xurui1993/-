"""Business task intent; execution remains in the existing collectors/engines."""
GENERATORS = ('payment_binding', 'abnormal_followup', 'abnormal_riders')
TASK_LABELS = {'download': '资料下载', 'generate': '业务表生成', 'payroll': '兼职薪资核算'}


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
        return {'task_kind': kind}
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
    from download_service import DATASETS, FOLLOWUP_DEPENDENCIES, ABNORMAL_RIDERS_DEPENDENCIES
    return [
        {'id': 'payment_binding', 'label': '骑手支付绑定', 'scope': 'city_month',
         'description': '按城市、月份生成支付绑定表，资料准备完整后再生成。',
         'sources': ['风神骑手数据明细', '风神骑手绑定', '风神骑手信息', '蓝橙代领资料', '白泽员工资料']},
        {'id': 'abnormal_followup', 'label': '异常骑手跟进', 'scope': 'city_month',
         'description': '以骑手支付绑定为基准，按城市、月份生成跟进表。',
         'sources': [DATASETS[value] for value in FOLLOWUP_DEPENDENCIES]},
        {'id': 'abnormal_riders', 'label': '异常骑手整理', 'scope': 'all',
         'description': '按全部城市整理蓝橙全量资料，生成一份异常骑手工作簿。',
         'sources': [DATASETS[value] for value in ABNORMAL_RIDERS_DEPENDENCIES]},
    ]
