"""Workbench settings and immutable deduction versions for payroll batches."""
from datetime import datetime
import asyncio
import hashlib
import json
import math
from pathlib import Path
import shutil
import threading

from fastapi import APIRouter, HTTPException, Request
from fengshen_bill import atomic_json
from parttime_source import ROOT, SourceError

router = APIRouter(prefix='/api/workbench')
SETTINGS_LOCK = threading.RLock()
RUNNERS = set()


async def detached_events(generator):
    """A browser disconnect must not abandon a running payroll generator."""
    queue = asyncio.Queue(maxsize=512)

    def offer(value):
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(value)

    async def produce():
        try:
            async for event in generator:
                offer(event)
        finally:
            offer(None)

    task = asyncio.create_task(produce())
    RUNNERS.add(task)
    task.add_done_callback(RUNNERS.discard)
    while True:
        value = await queue.get()
        if value is None:
            break
        yield value


def validate_rows(rows):
    if not isinstance(rows, list) or not rows or len(rows) > 10000:
        raise SourceError('扣款配置需要 1 至 10000 个站点')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not str(row.get('城市') or '').strip() or not str(row.get('团队名称') or '').strip():
            raise SourceError('每个站点都需要城市和团队名称')
        if any(value is not None and (not isinstance(value, (str, int, float, bool)) or
               isinstance(value, float) and not math.isfinite(value)) for value in row.values()):
            raise SourceError('扣款字段必须为文本、有效数字或开关')
        key = tuple(str(row.get(field) or '') for field in ('城市', '团队名称', '团队ID'))
        if key in seen:
            raise SourceError('存在重复站点，请核对城市、团队名称和团队 ID')
        seen.add(key)
    return rows


def version(rows):
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def read_defaults(root=None):
    path = Path(root or ROOT) / 'data' / 'config.json'
    try:
        rows = validate_rows(json.loads(path.read_text(encoding='utf-8-sig')))
    except (OSError, ValueError) as exc:
        raise SourceError('默认扣款配置无法读取，请先检查扣款设置') from exc
    return {'rows': rows, 'version': version(rows)}


def deduction_snapshot(state, root=None):
    # A failed run reuses the exact same version; later default edits cannot
    # silently change a batch that has already started calculating.
    previous = state.get('deductions')
    if previous and previous.get('frozen'):
        if version(previous['rows']) != previous['version']:
            raise SourceError('批次扣款快照校验失败')
        return previous
    data = previous or {**read_defaults(root), 'scope': 'default'}
    return {**data, 'rows': validate_rows(data['rows']), 'frozen': True,
            'captured_at': datetime.now().isoformat()}


@router.get('/deductions')
def get_defaults():
    try:
        return read_defaults()
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None


@router.put('/deductions')
async def save_defaults(request: Request):
    from download_accounts import require_admin
    require_admin(request)
    payload = await request.json()
    try:
        if not isinstance(payload, dict):
            raise SourceError('配置参数无效')
        rows = validate_rows(payload.get('rows'))
        with SETTINGS_LOCK:
            current = read_defaults()
            if payload.get('version') != current['version']:
                raise HTTPException(409, '默认配置已被其他页面修改，请重新打开后再保存')
            path = Path(ROOT) / 'data' / 'config.json'
            backup = path.parent / 'config_history' / (datetime.now().strftime('%Y%m%d_%H%M%S_%f') + '.json')
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup)
            atomic_json(path, rows)
        return {'rows': rows, 'version': version(rows)}
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None


@router.get('/batches')
def batches(request: Request):
    from payroll_inputs import workspace, public
    base = (Path(ROOT) / 'uploads' / workspace(request)).resolve()
    entries = []
    for path in base.glob('payroll_*/manifest.json'):
        if not path.resolve().is_relative_to(base):
            continue
        try:
            state = json.loads(path.read_text(encoding='utf-8'))
            entries.append(public(state))
        except (OSError, ValueError, KeyError):
            continue
    return {'batches': sorted(entries, key=lambda item: item.get('created_at', ''), reverse=True)[:100]}


@router.get('/tasks')
def task_records(request: Request):
    from download_accounts import require_account
    from download_jobs import get_manager
    from download_records import list_records
    from payroll_inputs import workspace, public
    user = require_account(request)
    wid = workspace(request)
    root = (Path(ROOT) / 'uploads').resolve()
    known_jobs, known_batches, payroll = set(), set(), []
    # Only manifests are inspected. Source workbooks and business rows are not
    # read to build the task list, and other workspaces' batches stay private.
    for path in root.glob('*/payroll_*/manifest.json'):
        if not path.resolve().is_relative_to(root):
            continue
        try:
            state = json.loads(path.read_text(encoding='utf-8'))
            owner = path.parent.parent.name
            known_batches.add((owner, state['id']))
            known_jobs.update(state.get('jobs', []))
            if owner != wid:
                continue
            value = public(state)
            output = state.get('result', {}).get('output') or ''
            try:
                available = bool(output and Path(output).exists())
            except OSError:
                available = False
            mapped = {'calculating': 'running', 'calculated': 'success'}.get(state['status'], state['status'])
            payroll.append({
                'id': 'payroll_' + state['id'], 'kind': 'payroll', 'batch_id': state['id'],
                'cities': [state['plan']['city']], 'datasets': ['payroll'],
                'start': state['plan']['start'], 'end': state['plan']['end'],
                'created_at': state.get('created_at', ''), 'updated_at': state.get('created_at', ''),
                'status': mapped, 'batch_status': state['status'], 'files': [],
                'available_files': int(available), 'output': output,
                'completed_items': sum(item['status'] in ('ready', 'omitted') for item in state['items'].values()),
                'total_items': len(state['items']), 'applicants': state['plan'].get('applicants', 0),
                'failed_items': sum(item['status'] == 'failed' for item in state['items'].values()),
                'member_ids': [], 'attempts': [], 'action_run_id': '',
                'deductions': value.get('deductions'), 'jobs': state.get('jobs', []),
            })
        except (OSError, ValueError, KeyError, TypeError):
            continue
    downloads = list_records(get_manager(), None if user['role'] == 'admin' else user['owner'])
    visible = [record for record in downloads
               if not known_jobs.intersection(record['member_ids'])
               and (record.get('parent_workspace'), record.get('parent_batch_id')) not in known_batches]
    from task_catalog import GENERATORS
    for record in visible:
        if record['kind'] == 'generate':
            targets = set(record['datasets']).intersection(GENERATORS)
            record['source_files'] = [file for file in record['files'] if file['dataset'] not in targets]
            record['files'] = [file for file in record['files'] if file['dataset'] in targets]
            record['available_files'] = sum(file.get('available', True) for file in record['files'])
    return {'records': sorted([*visible, *payroll], key=lambda item: item.get('updated_at', ''), reverse=True)}


@router.get('/batches/{key}/deductions')
def get_batch_deductions(key: str, request: Request):
    from payroll_inputs import load, workspace, account
    try:
        _, state = load(workspace(request), key, account(request))
        return state.get('deductions') or {**read_defaults(), 'scope': 'default', 'frozen': False}
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None


@router.put('/batches/{key}/deductions')
async def save_batch_deductions(key: str, request: Request):
    from download_accounts import require_admin
    require_admin(request)
    from payroll_inputs import LOCK, load, save, workspace, account
    payload = await request.json()
    try:
        if not isinstance(payload, dict):
            raise SourceError('配置参数无效')
        rows = validate_rows(payload.get('rows'))
        with LOCK:
            folder, state = load(workspace(request), key, account(request))
            if state['status'] in ('calculating', 'calculated') or state.get('deductions', {}).get('frozen'):
                raise HTTPException(409, '本次核算已采用固定配置，请新建批次调整')
            current = state.get('deductions') or read_defaults()
            if payload.get('version') != current['version']:
                raise HTTPException(409, '扣款配置已变化，请重新打开后再保存')
            data = {'rows': rows, 'version': version(rows), 'scope': 'batch', 'frozen': False}
            state['deductions'] = data
            save(folder, state)
            return data
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None


def reusable_files(state, manager):
    """Only completed, city/date-matching exports may enter a payroll batch."""
    import calendar
    plan = state['plan']
    result = []
    for brief in manager.list_runs(state['download_owner']):
        if brief['status'] != 'success':
            continue
        run = manager.get_run(state['download_owner'], brief['id'])
        for file in run.get('files', []):
            kind = file.get('dataset')
            if kind not in state['items'] or state['items'][kind]['status'] == 'ready' or file.get('artifact_role') == 'summary':
                continue
            if file.get('city') != plan['city']:
                continue
            start, end = plan['start'], plan['end']
            if kind == 'rider_monthly':
                year, month = map(int, plan['month'].split('-'))
                start, end = f'{year:04}-{month:02}-01', f'{year:04}-{month:02}-{calendar.monthrange(year, month)[1]}'
            if file.get('start') != start or file.get('end') != end:
                continue
            if not any(item.get('dataset') == kind and item.get('city') == plan['city'] and item.get('status') == 'success'
                       and item.get('start') == start and item.get('end') == end for item in run.get('items', [])):
                continue
            result.append({'run_id': run['id'], 'file_id': file['id'], 'dataset': kind,
                           'name': file['name'], 'created_at': run.get('created_at', '')})
    return result


@router.get('/batches/{key}/reusable')
def get_reusable(key: str, request: Request):
    from payroll_inputs import load, workspace, account
    from download_jobs import get_manager
    try:
        _, state = load(workspace(request), key, account(request))
        return {'files': reusable_files(state, get_manager()) if state['mode'] == 'fengshen' else []}
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post('/batches/{key}/reuse')
async def reuse(key: str, request: Request):
    from download_accounts import require_admin
    from payroll_inputs import LOCK, load, save, workspace, account, stage, validate_upload, readiness, public
    from download_jobs import get_manager
    require_admin(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, '资料参数无效')
    try:
        with LOCK:
            folder, state = load(workspace(request), key, account(request))
            if state['mode'] != 'fengshen' or state['status'] not in ('pending_download', 'waiting_materials'):
                raise HTTPException(409, '当前批次不可更换资料，请刷新后检查')
            manager = get_manager()
            candidate = next((file for file in reusable_files(state, manager) if file['run_id'] == payload.get('run_id') and file['file_id'] == payload.get('file_id')), None)
            if not candidate:
                raise SourceError('资料与本次城市、周期或完整性要求不符')
            path, _ = manager.get_file(state['download_owner'], candidate['run_id'], candidate['file_id'])
            validate_upload(path, candidate['dataset'])
            stage(folder, state, candidate['dataset'], path, {'run_id': candidate['run_id'], 'file_id': candidate['file_id'], 'reused': True})
            state['audit'].append({'action': 'reuse_download', **candidate})
            readiness(state)
            if state['status'] != 'ready' and any(item['status'] == 'pending' for item in state['items'].values()):
                state['status'] = 'pending_download'
            save(folder, state)
            return public(state)
    except SourceError as exc:
        raise HTTPException(400, str(exc)) from None
