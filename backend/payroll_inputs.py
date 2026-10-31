"""Payroll input snapshots. Downloads share the download center's durable jobs."""
import asyncio
from dataclasses import asdict
import hashlib
import hashlib_compat
import json
from pathlib import Path
import re
import shutil
import threading
import uuid
import time
import weakref

from fastapi import APIRouter, HTTPException, Request
from parttime_source import (ROOT, SourceError, inspect_source, owned_upload, source_files,
                             clean_rider_bill)
from fengshen_bill import atomic_json

router = APIRouter(prefix='/api/parttime/preparations')
LABELS = {'delivery_fee': '配送费', 'penalty': '违规扣款', 'rider_monthly': '骑手账单',
          'fraud': '欺诈单', 'problem': '问题单', 'payment_binding': '骑手支付绑定',
          'lanorange_part_price': '价格档案'}
LOCK = threading.RLock()
_BATCH_LOCKS = weakref.WeakValueDictionary()
_BATCH_LOCK_GUARD = threading.Lock()


def batch_lock(folder):
    key = str(Path(folder).resolve())
    with _BATCH_LOCK_GUARD:
        value = _BATCH_LOCKS.get(key)
        if value is None:
            value = threading.RLock(); _BATCH_LOCKS[key] = value
        return value



def read_upload_timing(folder):
    file = Path(folder) / '.upload_diagnostics.json'
    try:
        if file.is_symlink() or file.stat().st_size > 16 * 1024:return {}
        value = json.loads(file.read_text(encoding='utf-8'))
        return {key: seconds for key, seconds in value.items()
                if key in ('server_seconds', 'extraction_seconds', 'indexing_seconds')
                and type(seconds) in (int, float) and 0 <= seconds <= 86400}
    except (OSError, ValueError, TypeError, AttributeError):return {}


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def workspace(request):
    from download_routes import workspace_owner
    return workspace_owner(request)


def account(request):
    from download_accounts import require_account
    return require_account(request)['owner']


def directory(wid, key, root=None):
    if not re.fullmatch(r'[a-f0-9]{32}', key or ''):
        raise SourceError('资料准备编号无效')
    base = (Path(root or ROOT) / 'uploads' / wid).resolve()
    result = (base / ('payroll_' + key)).resolve()
    if not result.is_relative_to(base):
        raise SourceError('资料目录无效')
    return result


def load(wid, key, download_owner=None, root=None):
    folder = directory(wid, key, root)
    try:
        state = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise SourceError('本工作区资料准备记录不存在，请重新上传') from None
    if state['mode'] == 'fengshen' and state['download_owner'] != download_owner:
        raise SourceError('资料准备记录不属于当前下载账户')
    return folder, state


def save(folder, state):
    atomic_json(folder / 'manifest.json', state)


def public(state):
    result = {key: state[key] for key in ('id', 'mode', 'plan', 'status', 'items', 'jobs')}
    result.update({key: state[key] for key in ('created_at', 'result', 'performance') if key in state})
    if state.get('deductions'):
        result['deductions'] = {key: value for key, value in state['deductions'].items() if key != 'rows'}
    return result


def stage(folder, state, kind, path, origin):
    target = folder / 'input' / (LABELS[kind] + Path(path).suffix.lower())
    if kind == 'rider_monthly':
        from types import SimpleNamespace
        target = folder / 'input' / ('UB骑手账单_cleaned_' + state['plan']['month'] + '.csv')
        clean_rider_bill(path, target, SimpleNamespace(**state['plan']))
    else:
        shutil.copy2(path, target)
    state['items'][kind] = {'label': LABELS[kind], 'status': 'ready', 'file': target.name,
                            'sha256': digest(target), 'origin': origin}


def validate_upload(path, kind):
    """Reject wrong/corrupt supplements before payroll can continue."""
    from openpyxl import load_workbook
    import csv
    from itertools import islice
    if not 0 < path.stat().st_size <= 200 * 1024 * 1024:
        raise SourceError('资料为空或超过 200MB 限制')
    if kind == 'rider_monthly':
        from parttime_source import read_rider_bill
        read_rider_bill(path, cleaned='UB骑手账单_cleaned_' in path.name)
        return
    def matches(row):
        columns = {re.sub(r'\s+', '', str(v or '')).lower() for v in row}
        ids = {'骑手id', '风神id', '风神骑手id', '身份证', '身份证号', '骑手姓名'}
        if kind == 'lanorange_part_price':
            return bool(columns & ids) and bool(columns & {'价格', '单价', '蓝橙单价'})
        if kind == 'payment_binding':
            return bool(columns & ids) and bool(columns & {'绑定情况', '绑定状态', '商翼绑定', '白泽绑定'})
        if kind in ('delivery_fee', 'penalty'):
            return '骑手id' in columns and bool(columns & {'账单时间', '日期'})
        if kind == 'fraud':
            return {'骑手id', '运单id', '欺诈是否成立'}.issubset(columns)
        return {'骑手id', '运单号', '类型'}.issubset(columns)
    valid = False
    try:
        if path.suffix.lower() == '.xlsx':
            from order_xlsx import read_xlsx_tables, FastXlsxUnsupported
            try:
                checks = read_xlsx_tables(path, set(), lambda rows, *_: any(matches(row) for row in islice(rows, 10)))
                valid = any(checks)
            except FastXlsxUnsupported:
                book = load_workbook(path, read_only=True, data_only=True)
                try:
                    for sheet in book:
                        sheet.reset_dimensions()
                        if any(matches(row) for row in sheet.iter_rows(max_row=10, values_only=True)):
                            valid = True
                            break
                finally:
                    book.close()
        elif path.suffix.lower() == '.csv':
            for encoding in ('utf-8-sig', 'gb18030'):
                try:
                    with path.open(encoding=encoding, newline='') as stream:
                        valid = any(matches(row) for row in islice(csv.reader(stream), 10))
                    if valid:
                        break
                except UnicodeError:
                    continue
        else:
            import pandas as pd
            with pd.ExcelFile(path, engine='calamine') as book:
                valid = any(any(matches(row) for row in book.parse(sheet, nrows=10, header=None).values)
                            for sheet in book.sheet_names)
    except Exception:
        raise SourceError(f'{LABELS[kind]} 无法解析，请检查文件是否完整') from None
    if not valid:
        raise SourceError(f'{LABELS[kind]} 缺少相应表头，请选择正确资料')


def readiness(state):
    state['status'] = 'ready' if all(value['status'] in ('ready', 'omitted')
                                     for value in state['items'].values()) else 'waiting_materials'
    if state['items']['delivery_fee']['status'] != 'ready':
        state['status'] = 'waiting_materials'
    if state['mode'] == 'fengshen' and not state.get('jobs') and any(value['status'] == 'pending' for value in state['items'].values()):
        state['status'] = 'pending_download'


def create(source, wid, mode, download_owner=None, root=None):
    preparation_started = time.perf_counter()
    if mode not in ('manual', 'fengshen', 'xiaoxiang'):
        raise SourceError('未知兼职数据来源')
    folder, _ = owned_upload(source, wid, root or ROOT)
    from payroll_business import inspect_payroll
    plan, template, mode = inspect_payroll(folder, mode)
    if mode == 'xiaoxiang':
        result_folder, result_state = create_xiaoxiang(folder, plan, template, wid, root)
        result_state['performance'] = {'preparation_seconds': time.perf_counter() - preparation_started}
        upload_metrics = read_upload_timing(folder)
        if upload_metrics:result_state['performance']['upload'] = upload_metrics
        save(result_folder, result_state)
        return result_folder, result_state
    if mode == 'fengshen':
        from download_service import validate_request, ValidationError
        try:
            validate_request({'cities': [plan.city], 'start': plan.start, 'end': plan.end,
                              'datasets': ['delivery_fee']})
        except ValidationError as exc:
            raise SourceError(str(exc)) from None
    files = source_files(folder)
    matched = {kind: [p for p in files if p != template and label in p.name]
               for kind, label in LABELS.items()}
    # The official monthly filename contains UB 账单 rather than 骑手账单.
    matched['rider_monthly'] = [p for p in files if p != template and
                              ('骑手账单' in p.name or 'UB' in p.name.upper())]
    matched['penalty'] = [p for p in files if p != template and '违规' in p.name]
    if mode == 'manual' and not matched['delivery_fee']:
        raise SourceError('手动核算必须上传 template 和配送费；其他资料可选')
    key = uuid.uuid4().hex
    output = directory(wid, key, root)
    (output / 'input').mkdir(parents=True)
    shutil.copy2(template, output / 'input' / template.name)
    state = {'id': key, 'mode': mode, 'download_owner': download_owner, 'plan': asdict(plan),
             'template_hash': digest(template), 'status': 'preparing', 'items': {}, 'jobs': [],
             'audit': []}
    state['created_at'] = __import__('datetime').datetime.now().isoformat()
    for kind, label in LABELS.items():
        state['items'][kind] = {'label': label, 'status': 'pending' if mode == 'fengshen' else 'omitted'}
        if mode == 'fengshen' and kind == 'payment_binding':
            state['items'][kind].update(status='failed', error='支付绑定不随兼职自动生成，请上传已有绑定表，或明确确认本次不使用')
        if (mode == 'manual' or kind == 'payment_binding') and matched[kind]:
            staged, hashes = [], set()
            for index, path in enumerate(matched[kind]):
                validate_upload(path, kind)
                checksum = digest(path)
                if checksum in hashes:
                    raise SourceError(f'{label} 存在内容完全相同的重复文件，请核对后上传')
                hashes.add(checksum)
                # Preserve raw workbook layouts, including official UB row-four headers.
                destination = output / 'input' / (label + '_' + str(index) + '_' + path.name)
                shutil.copy2(path, destination)
                staged.append({'file': destination.name, 'sha256': checksum, 'origin': 'manual'})
            state['items'][kind] = {'label': label, 'status': 'ready', 'files': staged}
    if mode == 'manual':
        readiness(state)
    state['performance'] = {'preparation_seconds': time.perf_counter() - preparation_started}
    upload_metrics = read_upload_timing(folder)
    if upload_metrics:state['performance']['upload'] = upload_metrics
    save(output, state)
    return output, state


def create_xiaoxiang(source, plan, template, wid, root=None):
    from payroll_business import xiaoxiang_delivery_files
    files = source_files(source)
    for path in source.rglob('*'):
        if path.is_file() and path.suffix.lower() in ('.json', '.txt') and not any(
                part.startswith(('~', '.')) for part in path.relative_to(source).parts):
            if path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
                raise SourceError('小象上传资料中存在越界文件')
            files.append(path)
    key = uuid.uuid4().hex
    folder = directory(wid, key, root)
    (folder / 'input').mkdir(parents=True)
    all_files = []
    for path in files:
        if not 0 < path.stat().st_size <= 200 * 1024 * 1024:
            raise SourceError('小象原始文件为空或超过单文件 200MB 限制')
        relative = path.relative_to(source)
        destination = folder / 'input' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        all_files.append({'file': relative.as_posix(), 'sha256': digest(destination), 'origin': 'company_manual'})
    def item(label, selected):
        return {'label': label, 'status': 'ready' if selected else 'omitted',
                'files': [entry for entry in all_files if entry['file'] in {p.relative_to(source).as_posix() for p in selected}]}
    state = {'id': key, 'mode': 'xiaoxiang', 'download_owner': None, 'plan': asdict(plan),
             'template_hash': digest(template), 'status': 'ready', 'jobs': [], 'audit': [],
             'created_at': __import__('datetime').datetime.now().isoformat(), 'all_files': all_files,
             'engine': 'company_20261016', 'items': {
                'delivery_fee': item('小象日期配送单', xiaoxiang_delivery_files(files, template)),
                'lanorange_part_price': item('小象手动价格档案', [p for p in files if p != template and '价格档案' in p.name]),
                'payment_binding': item('小象手动绑定资料', [p for p in files if p != template and
                    ('merchantfreelancer' in p.name.lower() or '骑手支付绑定' in p.name)]),
                'rider_orders': item('小象骑手订单明细', [p for p in files if p != template and '骑手订单明细' in p.name]),
             }}
    save(folder, state)
    return folder, state


def start_download(folder, state, manager):
    from download_service import validate_request
    plan = state['plan']
    binding = state['items'].get('payment_binding', {})
    if binding.get('status') == 'pending':
        binding.update(status='failed', error='支付绑定需手动上传或明确跳过，不随兼职自动生成')
    config = validate_request({'cities': [plan['city']], 'start': plan['start'], 'end': plan['end'],
                               'datasets': ['delivery_fee'], 'refresh_history': True})
    # Optional order-window restrictions are evaluated per item by the executor;
    # they must not prevent collection of the mandatory delivery bill.
    config['datasets'] = [kind for kind in LABELS if kind != 'payment_binding' and state['items'][kind]['status'] == 'pending']
    if not config['datasets']:
        readiness(state)
        save(folder, state)
        return
    # Payroll needs this city; standalone Blue Orange retains its full export policy.
    config.pop('lanorange_full_delivery', None)
    config['lanorange_by_city'] = True
    config.update(task_kind='payroll_source', parent_batch_id=state['id'], parent_workspace=folder.parent.name)
    run = manager.create(state['download_owner'], config, request_id='payroll_' + state['id'])
    state['jobs'].append(run['id'])
    save(folder, state)


def start_download_resumable(folder, state, manager):
    try:
        start_download(folder, state, manager)
    except OSError as exc:
        # manager.create is idempotent under payroll_<batch id>. Keep a job id
        # already obtained, even if the first manifest replacement was locked.
        state['status'] = 'pending_download'
        try:
            save(folder, state)
        except OSError:
            pass
        raise SourceError('资料准备状态保存失败，请继续检查原下载任务；系统将沿用原批次编号，不重复提交导出') from exc


def collect_finished(folder, state, manager):
    for job_id in state['jobs']:
        run = manager.get_run(state['download_owner'], job_id)
        for item in run['items']:
            kind = item['dataset']
            if kind not in state['items'] or state['items'][kind]['status'] in ('ready', 'omitted'):
                continue
            if item['status'] != 'success':
                state['items'][kind].update(status='failed', error=item.get('error') or '下载未完成',
                    recovery_allowed=item.get('recovery', {}).get('mode') in ('resume_existing', 'retry_unsubmitted'),
                    run_id=job_id, recovery_reason=item.get('recovery', {}).get('reason', ''))
                continue
            candidates = [f for f in run['files'] if f['dataset'] == kind and f.get('artifact_role') != 'summary']
            if len(candidates) != 1:
                state['items'][kind].update(status='failed', error='已完成任务缺少唯一成品')
                continue
            try:
                path, _ = manager.get_file(state['download_owner'], job_id, candidates[0]['id'])
                stage(folder, state, kind, path, {'run_id': job_id, 'file_id': candidates[0]['id']})
            except SourceError as exc:
                state['items'][kind].update(status='failed', error='成品校验失败：' + str(exc),
                                            run_id=job_id, recovery_allowed=False)
            except Exception:
                state['items'][kind].update(status='failed', error='成品读取失败，请核对原任务文件完整性',
                                            run_id=job_id, recovery_allowed=False)
    readiness(state)
    save(folder, state)


def verified_hashes(folder, state):
    inputs = folder / 'input'
    entries = [(state['plan']['template'], state['template_hash'], 'template 在预检后被修改，请重新提交')]
    entries.extend((entry['file'], entry['sha256'], '小象原始资料在准备后被修改，请重新上传')
                   for entry in state.get('all_files', []))
    for value in state['items'].values():
        if value['status'] == 'ready':
            entries.extend((entry['file'], entry['sha256'], '核算资料在校验后被修改，请重新准备')
                           for entry in value.get('files', [value]))
    result = {}
    for name, checksum, message in entries:
        path = inputs / name
        if path in result and result[path][0] != checksum:
            raise SourceError('核算资料校验记录冲突，请重新准备')
        result.setdefault(path, (checksum, message))
    return result


def checked_inputs(folder, state):
    if state['status'] != 'ready':
        raise SourceError('资料尚未准备齐全，核算已暂停')
    for path, (checksum, message) in verified_hashes(folder, state).items():
        if digest(path) != checksum:
            raise SourceError(message)
    return folder / 'input'


def claim_calculation(wid, key, owner, deduction_version='', root=None):
    """Hash outside the global lock; recheck state before the atomic claim."""
    folder = directory(wid, key, root)
    with batch_lock(folder):
        with LOCK:
            folder, state = load(wid, key, owner, root)
            if state['status'] in ('calculating', 'calculated'):
                raise SourceError('本次资料正在核算或已核算，请先核对原结果')
            signature = json.dumps(state, ensure_ascii=False, sort_keys=True)
        started = time.perf_counter()
        inputs = checked_inputs(folder, state)
        checked_seconds = time.perf_counter() - started
        with LOCK:
            folder, current = load(wid, key, owner, root)
            if json.dumps(current, ensure_ascii=False, sort_keys=True) != signature:
                raise SourceError('资料或扣款配置在校验期间发生变化，请刷新后重新确认')
            from workbench import deduction_snapshot
            selected = deduction_snapshot(current)
            if deduction_version and selected['version'] != deduction_version:
                raise SourceError('扣款配置已变化，请重新查看配置并确认后再核算')
            current['deductions'] = selected
            current['status'] = 'calculating'
            current['performance'] = {'preparation_seconds': current.get('performance', {}).get('preparation_seconds', 0),
                                      'integrity_seconds': checked_seconds,
                                      **({'upload': current.get('performance', {})['upload']} if 'upload' in current.get('performance', {}) else {})}
            save(folder, current)
        return folder, current, inputs


async def run_payroll(config, request):
    import tasks
    wid = workspace(request)
    mode = config.payrollSourceMode
    owner = account(request) if mode == 'fengshen' else None
    if config.payrollPreparationId:
        folder, state = load(wid, config.payrollPreparationId, owner)
        if state['mode'] != mode:
            raise SourceError('资料模式与准备记录不一致')
        if state['status'] in ('calculated', 'calculating'):
            raise SourceError('本次资料已核算或正在核算，请先核对原结果；重新上传可发起新核算')
    else:
        folder, state = await asyncio.to_thread(create, config.sourcePath, wid, mode, owner)
        if getattr(config, 'preparationOnly', False) and mode == 'fengshen':
            state['status'] = 'pending_download'
            save(folder, state)
            yield 'data: ' + json.dumps({'type': 'payroll_preparation', 'preparation': public(state)}, ensure_ascii=False) + '\n\n'
            yield tasks.create_finish_event('paused', '请复用已有资料或下载所需资料')
            return
    if state['status'] == 'pending_download':
        state['status'] = 'preparing'
        save(folder, state)
    yield 'data: ' + json.dumps({'type': 'payroll_preparation', 'preparation': public(state)}, ensure_ascii=False) + '\n\n'
    if mode == 'fengshen' and state['status'] == 'preparing':
        from download_jobs import get_manager, ACTIVE_STATUSES
        manager = get_manager()
        if not state['jobs']:
            await asyncio.to_thread(start_download_resumable, folder, state, manager)
        last = None
        while True:
            runs = [await asyncio.to_thread(manager.get_run, owner, key) for key in state['jobs']]
            progress = [(run['id'], run['status'], run.get('phase'), run.get('progress')) for run in runs]
            if progress != last:
                yield tasks.create_log_event('资料下载：' + '；'.join(f"{run['id'][:6]} {run.get('phase', run['status'])} {run.get('progress', 0)}%" for run in runs))
                last = progress
            if all(run['status'] not in ACTIVE_STATUSES for run in runs):
                break
            yield ': heartbeat\n\n'
            await asyncio.sleep(1)
        await asyncio.to_thread(collect_finished, folder, state, manager)
    yield 'data: ' + json.dumps({'type': 'payroll_preparation', 'preparation': public(state)}, ensure_ascii=False) + '\n\n'
    if state['status'] != 'ready':
        yield tasks.create_log_event('资料准备未完成：请重试失败项、手动补传，或明确确认不提供可选资料。配送费不可跳过。', 'WARN')
        yield tasks.create_finish_event('paused', '等待处理资料，尚未执行核算')
        return
    if getattr(config, 'preparationOnly', False):
        yield tasks.create_log_event('资料已准备完成，请确认扣款配置后点击开始核算')
        yield tasks.create_finish_event('paused', '资料已就绪，等待确认核算')
        return
    yield tasks.create_progress_event(0.01, '正在校验资料快照与扣款配置')
    folder, state, inputs = await asyncio.to_thread(claim_calculation, wid, state['id'], owner,
                                                   getattr(config, 'deductionConfigVersion', ''))
    yield 'data: ' + json.dumps({'type': 'payroll_preparation', 'preparation': public(state)}, ensure_ascii=False) + '\n\n'
    plan = state['plan']
    omitted = [v['label'] for v in state['items'].values() if v['status'] == 'omitted']
    if omitted:
        yield tasks.create_log_event('本次明确未提供：' + '、'.join(omitted), 'WARN')
    yield tasks.create_log_event(f"核算范围：{plan['city']} / {plan['start']} 至 {plan['end']} / {plan['applicants']} 条申请；各骑手仍按申请周期核算")
    async for event in tasks.run_main_calculation_gen(plan['city'], plan['cycle'], str(inputs),
            config.basePath, config.theme, config.enableInterceptor, config.enableCrossStationMerge,
            deductionRules=state['deductions']['rows'], taskQueue=[plan['template']], strict_inputs=True,
            manual_template_only=True, force_no_price=state['mode'] != 'xiaoxiang' and state['items']['lanorange_part_price']['status'] == 'omitted',
            skip_binding_check=state['mode'] != 'xiaoxiang' and state['items']['payment_binding']['status'] == 'omitted',
            input_snapshot=public(state) if state['mode'] != 'xiaoxiang' else None,
            prepared_plan=plan, verified_inputs={str(path): value[0] for path, value in verified_hashes(folder, state).items()},
            output_root=str((Path(ROOT) / 'outputs' / 'payroll_batches' / wid / state['id']).resolve())):
        if event.startswith('data: '):
            result = json.loads(event[6:])
            if result.get('type') == 'payroll_performance':
                state['performance'] = {**state.get('performance', {}), **result['performance']}
                save(folder, state)
                yield 'data: ' + json.dumps({'type': 'payroll_preparation', 'preparation': public(state)}, ensure_ascii=False) + '\n\n'
            elif result.get('type') == 'finish' and result.get('status') == 'success':
                state['status'] = 'calculated'
                state['result'] = {'output': result.get('out_file'), 'input_hashes_verified': True}
                save(folder, state)
                output = Path(result.get('out_file') or '')
                if result.get('out_file') and output.is_dir():
                    atomic_json(output / ('核算资料清单_' + state['id'][:8] + '.json'), state)
                yield 'data: ' + json.dumps({'type': 'payroll_preparation', 'preparation': public(state)}, ensure_ascii=False) + '\n\n'
            elif result.get('type') == 'finish' and result.get('status') == 'error':
                state['status'] = 'ready'
                save(folder, state)
        yield event


@router.get('/{key}')
def get_preparation(key: str, request: Request):
    try:
        _, state = load(workspace(request), key, account(request))
        return public(state)
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post('/{key}/resolve')
async def resolve(key: str, request: Request):
    owner, wid = account(request), workspace(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, '资料处理参数必须为对象')
    kind, action = payload.get('dataset'), payload.get('action')
    if kind not in LABELS or action not in ('omit', 'retry'):
        raise HTTPException(400, '资料处理参数无效')
    with LOCK:
        try:
            folder, state = load(wid, key, owner)
        except SourceError as exc:
            raise HTTPException(400, str(exc)) from None
        value = state['items'][kind]
        if state['status'] == 'preparing' or value['status'] not in ('failed', 'pending'):
            raise HTTPException(409, '资料状态已变化，请刷新资料清单')
        if action == 'omit':
            if kind == 'delivery_fee':
                raise HTTPException(400, '配送费为必需资料，不可跳过')
            value.update(status='omitted', confirmed_at=__import__('datetime').datetime.now().isoformat())
            state['audit'].append({'dataset': kind, 'action': 'explicit_omit', 'at': value['confirmed_at']})
            readiness(state)
        else:
            if kind == 'payment_binding':
                raise HTTPException(400, '支付绑定仅支持上传已有表，或明确跳过；白泽请到下载中心独立下载')
            from download_jobs import get_manager
            manager = get_manager()
            run = manager.get_run(owner, value['run_id'])
            items = [{k: item[k] for k in ('city', 'dataset', 'start', 'end')}
                     for item in run['items'] if item['dataset'] == kind and item['status'] != 'success']
            from download_routes import _call
            retry = _call(lambda: manager.retry(owner, run['id'], items, 'payroll_retry_' + uuid.uuid4().hex))
            state['jobs'].append(retry['id'])
            value['status'] = 'pending'
            state['status'] = 'preparing'
        save(folder, state)
        return public(state)


@router.post('/{key}/supplement')
async def supplement(key: str, request: Request):
    wid, owner = workspace(request), account(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, '补传参数必须为对象')
    dataset = payload.get('dataset')
    if dataset not in LABELS:
        raise HTTPException(400, '资料类型无效')
    try:
        upload, _ = owned_upload(payload.get('path', ''), wid, ROOT)
        files = source_files(upload)
        if len(files) != 1:
            raise SourceError('请每次补传一份对应资料')
        path = files[0]
        if not 0 < path.stat().st_size <= 200 * 1024 * 1024:
            raise SourceError('补传文件为空或超过 200MB')
        validate_upload(path, dataset)
        with LOCK:
            folder, state = load(wid, key, owner)
            if state['status'] in ('preparing', 'calculating', 'calculated') or state['items'][dataset]['status'] == 'ready':
                raise HTTPException(409, '资料正在准备或已就绪，请重新检查')
            stage(folder, state, dataset, path, 'manual_supplement')
            state['audit'].append({'dataset': dataset, 'action': 'manual_supplement', 'sha256': digest(path)})
            readiness(state)
            save(folder, state)
            return public(state)
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None
