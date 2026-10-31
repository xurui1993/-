"""Explain existing payroll evidence; never change salary calculations or approve it."""
import csv
import datetime as dt
from pathlib import Path

from openpyxl import load_workbook
from fengshen_bill import atomic_json
from parttime_source import identifier

METRICS = (
    ('riders', '引擎统计人数', '人', '沿用引擎原口径，不与申请行数直接相减'),
    ('orders', '配送记录数', '条', '沿用引擎导入统计，不代表去重完成单量'),
    ('no_price', '无单价记录', '条', '请查看工作簿的蓝橙无单价明细'),
    ('unbound', '未绑定记录', '条', '请查看工作簿的发薪工具未绑名单'),
    ('intercepted', '拦截记录', '条', '请查看工作簿的拦截溯源及日维度单量拦截'),
)


def application_summary(path):
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = book['申请名单']
        sheet.reset_dimensions()
        rows = iter(sheet.iter_rows(values_only=True))
        headers = [str(value or '').strip() for value in next(rows)]
        index = headers.index('骑手ID')
        riders, seen, duplicates, count = set(), {}, [], 0
        for number, row in enumerate(rows, 2):
            if not any(value is not None and str(value).strip() for value in row):
                continue
            count += 1
            riders.add(identifier(row[index]))
            key = tuple(value.isoformat() if isinstance(value, (dt.date, dt.datetime)) else str(value) if value is not None else '' for value in row)
            if key in seen:
                duplicates.append({'row': number, 'same_as': seen[key]})
            else:
                seen[key] = number
        return {'records': count, 'unique_riders': len(riders), 'duplicate_rows': duplicates,
                'file': Path(path).name, 'sheet': '申请名单'}
    finally:
        book.close()


def metric_value(stats, key):
    batches = list(stats['batch_stats'].values()) if isinstance(stats, dict) and isinstance(stats.get('batch_stats'), dict) else [stats]
    values = [batch.get(key) if isinstance(batch, dict) else None for batch in batches]
    if not values or any(type(value) is not int or value < 0 for value in values):
        return None
    return sum(values)


def build_review(state, stats, application=None):
    metrics = [{'key': 'applicants', 'label': '申请记录数', 'value': state['plan'].get('applicants'), 'unit': '条', 'note': '预检通过的申请行数，同一骑手可能存在多行'}]
    metrics.extend({'key': key, 'label': label, 'value': metric_value(stats, key), 'unit': unit, 'note': note} for key, label, unit, note in METRICS)
    issues = []
    if application:
        metrics.insert(1, {'key': 'unique_applicants', 'label': '申请骑手去重数', 'value': application['unique_riders'], 'unit': '人', 'note': '仅按申请名单骑手ID去重，不等于输出覆盖人数'})
        if application['duplicate_rows']:
            issues.append({'code': 'duplicate_application', 'label': '申请名单存在完全相同的行', 'count': len(application['duplicate_rows']),
                           'location': application['file'] + ' / 申请名单', 'rows': application['duplicate_rows']})
    else:
        issues.append({'code': 'application_unknown', 'label': '申请名单去重情况未统计，请复核原表'})
    for metric in metrics:
        if metric['value'] is None:
            issues.append({'code': 'unknown_' + metric['key'], 'label': metric['label'] + '未提供统计'})
        elif metric['key'] in ('no_price', 'unbound', 'intercepted') and metric['value'] > 0:
            issues.append({'code': metric['key'], 'label': metric['label'] + '需复核', 'count': metric['value'], 'location': metric['note']})
    sources = []
    for kind, item in state['items'].items():
        files = item.get('files') or ([item] if item.get('file') else [])
        sources.append({'kind': kind, 'label': item['label'], 'status': item['status'],
                        'files': [{'name': Path(file['file']).as_posix() if not Path(file['file']).is_absolute() and '..' not in Path(file['file']).parts else Path(file['file']).name,
                                   'sha256': file.get('sha256')} for file in files]})
        if item['status'] == 'omitted':
            issues.append({'code': 'omitted_' + kind, 'label': '本批次确认不提供：' + item['label']})
        elif item['status'] != 'ready':
            issues.append({'code': 'source_' + kind, 'label': '资料状态需核对：' + item['label']})
    return {'version': 1, 'status': 'pending_review', 'batch_id': state['id'],
            'created_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'city': state['plan']['city'],
            'start': state['plan']['start'], 'end': state['plan']['end'], 'metrics': metrics,
            'issues': issues, 'sources': sources, 'application': application,
            'template': {'name': state['plan']['template'], 'sha256': state.get('template_hash')},
            'deduction_version': state.get('deductions', {}).get('version'),
            'input_check': '运行前已按保存的SHA256校验输入；不代表业务数据本身准确完整',
            'money_check': '待用Excel/WPS重算并人工核对金额；系统未确认发薪或业务验收'}


def write_review(output, summary):
    output = Path(output)
    atomic_json(output / '核算复核摘要.json', summary)
    # Values can include user-controlled filenames. Keep CSV cells literal.
    def literal(value):
        text = str(value) if value is not None else '未统计'
        return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) else text
    with (output / '核算复核清单.csv').open('w', encoding='utf-8-sig', newline='') as target:
        writer = csv.writer(target)
        def row(*values):
            writer.writerow([literal(value) for value in values])
        row('类别', '项目', '数值或状态', '口径与复核位置')
        row('范围', '城市与业务周期', summary['city'], summary['start'] + ' 至 ' + summary['end'])
        row('范围', '核算批次', summary['batch_id'], '')
        row('结论', '业务复核', '待人工复核', summary['money_check'])
        for metric in summary['metrics']:
            row('统计', metric['label'], metric['value'], metric['note'])
        for issue in summary['issues']:
            row('待核对', issue['label'], issue.get('count', '需确认'), issue.get('location', '资料清单'))
            for duplicate in issue.get('rows', []):
                row('申请行', '完全相同的申请记录', duplicate['row'], '与第' + str(duplicate['same_as']) + '行相同；不自动删除')
        row('凭据', '扣款配置内容标识', summary['deduction_version'], summary['input_check'])
        row('凭据', summary['template']['name'], summary['template']['sha256'], '申请名单')
        for source in summary['sources']:
            row('来源', source['label'], source['status'], '')
            for file in source['files']:
                row('来源文件', file['name'], file['sha256'], source['label'])
