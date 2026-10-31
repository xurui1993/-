"""小象灯塔商配送数据看板：日维度骑手分析查询与工作簿生成。

数据看板（zl.meituan.com 知了）与灯塔通知中心分属两套登录域，
查询接口只依赖 Cookie，无需签名参数；浏览器只负责登录拿会话。
"""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import json
import re
import os
import tempfile
import uuid

import requests
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.utils import get_column_letter

import xiaoxiang_lighthouse
from fengshen_auth import dpapi
from fengshen_bill import BillCollectionError
from xiaoxiang_lighthouse import LighthouseError, SessionExpired

BOARD_BASE = 'https://zl.meituan.com'
BOARD_ENTRY = BOARD_BASE + '/board/delivery.html'
BOARD_QUERY_PATH = '/api/m/mustang/one/app/query'
BOARD_SESSION_FILE = Path(__file__).resolve().parent / '.local_auth' / 'xiaoxiang_board.dpapi'
BOARD_SESSION_ENTROPY = b'aegis-xiaoxiang-board-v1'
BOARD_STATE_LIMIT = 256 * 1024
APPLICATION_ID = 1741336293230
MODULE_ID = 'um82vmwflyey8'
SUB_QUERY_ID = 'm830ltt71e350'
MEASURES = (
    'transport_push_order_cnt', 'transport_end_order_cnt',
    'subscribe_partner_advance_arrive_order_cnt', 'supplier_overtime_order_cnt',
    'supplier_serious_overtime_order_cnt', 'supplier_transport_ontime_rate',
    'supplier_serious_overtime_rate', 'supplier_transport_complain_cnt',
    'supplier_transport_bad_cnt', 'supplier_transport_bad_rate',
    'supplier_transport_good_cnt', 'supplier_illegal_point_finish_cnt',
    'supplier_illegal_point_finish_rate', 'fast_30min_delivery_order_rate',
)
DAILY_COUNT_CODES = (
    'transport_push_order_cnt', 'transport_end_order_cnt',
    'subscribe_partner_advance_arrive_order_cnt',
)
DAILY_RATE_CODES = (
    'supplier_transport_ontime_rate', 'supplier_serious_overtime_rate',
    'supplier_illegal_point_finish_rate', 'fast_30min_delivery_order_rate',
    'supplier_transport_bad_rate',
)
DAILY_HEADER = (
    '日期', '骑手ID', '骑手姓名', '所属站点',
    '推配送单量', '同比', '配送完成单量', '同比',
    '合作商预约单提前送达单量', '同比',
    '合作商配送准时率', '同比', '合作商严重超时率', '同比',
    '合作商违规点送达率', '同比', '30分钟送达率', '同比',
    '合作商配送差评率', '同比',
)
DAILY_RANGE_LIMIT = 31


def query_body(day, supplier_id=xiaoxiang_lighthouse.SUPPLIER_ID):
    key = day.strftime('%Y%m%d')
    return {
        'applicationId': APPLICATION_ID,
        'summary': {'type': 'UNIONALL'},
        'queries': [{
            'subQueryId': SUB_QUERY_ID,
            'dims': ['rider_id', 'site_id'],
            'measures': list(MEASURES),
            'filters': [{'filterCode': 'transport_supplier_id', 'ruleValue': str(supplier_id),
                         'logic': 'AND', 'ruleType': 'IN', 'extra': {}}],
            'dateDim': {'dateKey': [key, key], 'dateType': 'DAY',
                        'ratioType': [], 'ratioOrigin': [], 'ratioDateOrigin': [],
                        'weekRange': '1', 'aggrDateDim': False},
            'splitDims': [], 'queryOptions': {'filterAllMeasuresNull': False},
            'measureFilters': [], 'rollup': {}, 'pageInfo': {}, 'sortInfos': [],
        }],
        'extra': {'debug': False, 'moduleId': MODULE_ID, 'feParams': '', 'subQueryCloneMapping': {}},
    }


def board_session(state):
    session = xiaoxiang_lighthouse.session_from_state(state)
    session.headers.update({'Origin': BOARD_BASE, 'Referer': BOARD_ENTRY})
    return session


def board_host_allowed(domain):
    """知了看板登录域：zl.meituan.com 与大象 SSO（sankuai.com）。"""
    domain = str(domain or '').lower().lstrip('.')
    return domain == 'zl.meituan.com' or domain == 'sankuai.com' or domain.endswith('.sankuai.com')


def scoped_board_state(state):
    if (not isinstance(state, dict) or not isinstance(state.get('cookies'), list)
            or not isinstance(state.get('origins'), list)):
        raise LighthouseError('看板会话格式无效，请重新登录')
    cookies, seen = [], set()
    for cookie in state['cookies']:
        if not isinstance(cookie, dict) or not board_host_allowed(cookie.get('domain')):
            continue
        name, value = cookie.get('name'), cookie.get('value')
        if not isinstance(name, str) or not isinstance(value, str):
            continue
        if not 0 < len(name) <= 128 or len(value) > 16384:
            continue
        key = (cookie.get('domain'), cookie.get('path') or '/', name)
        if key in seen:
            continue
        seen.add(key)
        cookies.append(cookie)
    origins = [origin for origin in state['origins']
               if isinstance(origin, dict)
               and str(origin.get('origin', '')).startswith('https://')
               and board_host_allowed(origin.get('origin', '').split('://', 1)[-1].split('/', 1)[0])]
    return {'cookies': cookies, 'origins': origins}


def load_board_state(path=BOARD_SESSION_FILE):
    """读本机保留的看板 SSO 会话；缺失或异常时返回 None，不影响登录流程。"""
    path = Path(path)
    if not path.exists():
        return None
    try:
        if path.is_symlink() or path.stat().st_size > BOARD_STATE_LIMIT:
            return None
        data = json.loads(dpapi(path.read_bytes(), decrypt=True, entropy=BOARD_SESSION_ENTROPY))
        if data.get('source') != 'xiaoxiang_board_session':
            return None
        state = scoped_board_state(data.get('state'))
        return state if state['cookies'] else None
    except Exception:
        return None


def save_board_state(state, path=BOARD_SESSION_FILE):
    scoped = scoped_board_state(state)
    if not scoped['cookies']:
        raise LighthouseError('看板会话缺少 Cookie，未保存')
    path = Path(path)
    payload = json.dumps({'source': 'xiaoxiang_board_session', 'state': scoped},
                         ensure_ascii=True, separators=(',', ':')).encode('utf-8')
    if len(payload) > BOARD_STATE_LIMIT:
        raise LighthouseError('看板会话过大，未保存')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.encrypted.part', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(dpapi(payload, entropy=BOARD_SESSION_ENTROPY))
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def discard_board_state(path=BOARD_SESSION_FILE):
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def _board_json(response):
    """统一校验看板/明细接口响应；返回解析后的 data 字典。"""
    if response.status_code in (401, 403):
        raise SessionExpired('小象数据看板登录已失效，请重新完成来源认证')
    if response.status_code != 200:
        raise LighthouseError('小象数据看板接口返回 HTTP {}'.format(response.status_code))
    final_url = str(getattr(response, 'url', '') or '')
    if 'passport.meituan.com' in final_url or 'ssosv.sankuai.com' in final_url \
            or 'text/html' in str(response.headers.get('content-type') or ''):
        raise SessionExpired('小象数据看板登录已失效，请重新完成来源认证')
    try:
        body = response.json()
    except ValueError:
        raise LighthouseError('小象数据看板接口返回内容不是 JSON，页面可能已改版') from None
    if not isinstance(body, dict):
        raise LighthouseError('小象数据看板接口返回结构无效')
    if body.get('code') != 0:
        raise LighthouseError('小象数据看板接口错误：{}'.format(body.get('msg') or body.get('code')))
    data = body.get('data')
    if not isinstance(data, dict):
        raise LighthouseError('小象数据看板接口缺少有效数据结构')
    return data


def _board_post(session, payload):
    try:
        response = session.post(BOARD_BASE + BOARD_QUERY_PATH, json=payload, timeout=60)
    except requests.RequestException as exc:
        raise LighthouseError('连接小象数据看板失败，请检查网络后重试') from exc
    return _board_json(response)


def query_rider_daily(session, day, supplier_id=xiaoxiang_lighthouse.SUPPLIER_ID):
    data = _board_post(session, query_body(day, supplier_id))
    rows, metas = data.get('data'), data.get('metas')
    if (not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows)
            or not isinstance(metas, list) or not metas or not all(isinstance(meta, dict) for meta in metas)):
        raise LighthouseError('小象数据看板行或列定义结构无效，未发布文件')
    codes = [meta.get('fieldCode') for meta in metas]
    if not all(isinstance(code, str) and code for code in codes) or len(set(codes)) != len(codes):
        raise LighthouseError('小象数据看板未返回列定义，页面可能已改版')
    total = data.get('total')
    if total is not None and (type(total) is not int or total < 0 or total != len(rows)):
        raise LighthouseError('小象数据看板总数与返回记录不一致，请核对接口分页；未发布不完整文件')
    return {'rows': rows, 'metas': metas, 'total': data.get('total')}


def board_probe(state, day=None, timeout=None):
    """已登录（两个登录域）时静默查询一次；失败抛 SessionExpired/LighthouseError。"""
    session = board_session(state)
    if timeout is not None:
        from auth_browser_runtime import bounded_requests
        bounded_requests(session, timeout)
    try:
        query_rider_daily(session, day or date.today() - timedelta(days=1))
    finally:
        session.close()


def _cell(value):
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r'-?\d+', text):
            return int(text)
        if re.fullmatch(r'-?\d+\.\d+', text):
            return float(text)
        return text
    return value


def write_workbook(data, target, cancelled=None):
    rows, metas = data['rows'], data['metas']
    if not rows:
        raise LighthouseError('商配送数据看板没有返回数据行（当日可能尚无数据）')
    columns = [(meta.get('fieldCode'), str(meta.get('name') or meta.get('fieldCode')))
               for meta in metas if meta.get('fieldCode')]
    if not columns or len({code for code, _ in columns}) != len(columns):
        raise LighthouseError('日维度骑手分析列定义无效')
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('日维度骑手分析已取消')
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.daily_' + uuid.uuid4().hex + '.xlsx')
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet('日维度骑手分析')
    for index, (_, name) in enumerate(columns, start=1):
        width = max(len(name) * 2 + 2, 12)
        sheet.column_dimensions[get_column_letter(index)].width = min(width, 60)
    sheet.freeze_panes = 'A2'
    def cells(values):
        result = []
        for value in values:
            cell = WriteOnlyCell(sheet, value=value)
            if isinstance(value, str):
                cell.data_type = 's'
            result.append(cell)
        return result
    saved = False
    try:
        sheet.append(cells([name for _, name in columns]))
        for row in rows:
            if cancelled is not None and cancelled.is_set():
                raise LighthouseError('日维度骑手分析已取消')
            # Only measures are numeric. IDs and dimensions remain literal text.
            values = []
            for code, _ in columns:
                value = row.get(code)
                if code.endswith('_id') and isinstance(value, float) and (not value.is_integer() or abs(value) > 2**53):
                    raise LighthouseError('骑手或站点编号存在数值精度风险，未发布文件')
                values.append(_cell(value) if code in MEASURES else None if value is None else str(value))
            sheet.append(cells(values))
        if cancelled is not None and cancelled.is_set():
            raise LighthouseError('日维度骑手分析已取消')
        workbook.save(temporary)
        saved = True
        os.replace(temporary, target)
    finally:
        if not saved:
            try:
                workbook.save(temporary)
            except Exception:
                pass
        workbook.close()
        temporary.unlink(missing_ok=True)
    return {'rows': len(rows), 'columns': len(columns)}


def generate_rider_daily(day, directory, log=None, cancelled=None):
    """查询指定日期的骑手分析数据并生成工作簿，返回文件路径。"""
    log = log or (lambda message, *args, **kwargs: None)
    try:
        state = xiaoxiang_lighthouse.load_state()
    except LighthouseError as exc:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise BillCollectionError('小象灯塔会话不可用（{}），请先在系统通道完成小象灯塔认证'.format(exc)) from None
    if state is None:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise BillCollectionError('尚未保存小象灯塔会话，请先在系统通道完成小象灯塔认证')
    day = day if isinstance(day, date) else date.fromisoformat(str(day))
    log('[下载] 正在查询小象灯塔商配送数据看板（{}）'.format(day.isoformat()))
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('日维度骑手分析已取消')
    session = board_session(state)
    try:
        data = query_rider_daily(session, day)
    except SessionExpired:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise
    finally:
        session.close()
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('日维度骑手分析已取消')
    info = write_workbook(data, Path(directory) / '日维度骑手分析_{}.xlsx'.format(day.isoformat()), cancelled)
    log('[校验] 日维度骑手分析：{} 行 / {} 列'.format(info['rows'], info['columns']))
    return Path(directory) / '日维度骑手分析_{}.xlsx'.format(day.isoformat())


def _number(value):
    """Parse board metric text such as '90.63%' or '19'; missing values stay None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(',', '')
        if not text or text == '--':
            return None
        match = re.fullmatch(r'(-?\d+(?:\.\d+)?)%?', text)
        if match:
            return float(match.group(1))
    return None


def _identifier(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() and abs(value) <= 2**53 else None
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r'\d+', text):
        return text.lstrip('0') or '0'
    return text


def _rider_id(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() and abs(value) <= 2**53 else str(value)
    text = str(value).strip()
    if re.fullmatch(r'\d{1,16}', text) and not (len(text) > 1 and text.startswith('0')):
        return int(text)
    return text


def _text(value):
    return '' if value is None else str(value)


def _count_text(value):
    if value is None:
        return '--'
    return int(value) if float(value).is_integer() else value


def _rate_text(value):
    return '--' if value is None else _fixed(value, '%')


def _fixed(value, suffix):
    if abs(value) < 0.005:
        value = 0.0
    rounded = Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return '{}{}'.format(format(rounded, 'f'), suffix)


def _count_ratio(current, previous):
    if current is None or previous in (None, 0):
        return '--'
    return _fixed((current - previous) / previous * 100, '%')


def _rate_ratio(current, previous):
    if current is None or previous is None:
        return '--'
    return _fixed(current - previous, 'pp')


def _index_rows(rows):
    index = {}
    for row in rows:
        key = (_identifier(row.get('rider_id')), _identifier(row.get('site_id')))
        if key[0] is not None:
            index.setdefault(key, row)
    return index


def merge_daily_rows(day, rows, previous_rows):
    """Merge one day onto the 20-column export, with ratio against the same weekday last week."""
    previous = _index_rows(previous_rows)
    merged = []
    for row in rows:
        key = (_identifier(row.get('rider_id')), _identifier(row.get('site_id')))
        prior = previous.get(key)
        values = [day.isoformat(), _rider_id(row.get('rider_id')),
                  _text(row.get('rider_name')), _text(row.get('site_name') or row.get('site_id'))]
        for code in DAILY_COUNT_CODES:
            current = _number(row.get(code))
            values.extend([_count_text(current), _count_ratio(current, _number(prior.get(code)) if prior else None)])
        for code in DAILY_RATE_CODES:
            current = _number(row.get(code))
            values.extend([_rate_text(current), _rate_ratio(current, _number(prior.get(code)) if prior else None)])
        merged.append(values)
    return merged


def write_daily_range_workbook(records, target, cancelled=None):
    if not records:
        raise LighthouseError('所选日期内没有骑手分析数据')
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('区间日维度骑手分析已取消')
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.daily_range_' + uuid.uuid4().hex + '.xlsx')
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet('日维度骑手分析')
    for index, name in enumerate(DAILY_HEADER, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = min(max(len(name) * 2 + 2, 12), 60)
    sheet.freeze_panes = 'A2'

    def cells(values):
        result = []
        for value in values:
            cell = WriteOnlyCell(sheet, value=value)
            if isinstance(value, str):
                cell.data_type = 's'
            result.append(cell)
        return result

    saved = False
    try:
        sheet.append(cells(list(DAILY_HEADER)))
        for values in records:
            if cancelled is not None and cancelled.is_set():
                raise LighthouseError('区间日维度骑手分析已取消')
            sheet.append(cells(values))
        if cancelled is not None and cancelled.is_set():
            raise LighthouseError('区间日维度骑手分析已取消')
        workbook.save(temporary)
        saved = True
        os.replace(temporary, target)
    finally:
        if not saved:
            try:
                workbook.save(temporary)
            except Exception:
                pass
        workbook.close()
        temporary.unlink(missing_ok=True)
    return {'rows': len(records), 'columns': len(DAILY_HEADER)}


def generate_rider_daily_range(start, end, directory, log=None, cancelled=None):
    """逐日查询并合并为区间工作簿；同比取上周同一天数据。"""
    log = log or (lambda message, *args, **kwargs: None)
    start = start if isinstance(start, date) else date.fromisoformat(str(start))
    end = end if isinstance(end, date) else date.fromisoformat(str(end))
    if start > end:
        raise LighthouseError('开始日期不能晚于结束日期')
    if (end - start).days + 1 > DAILY_RANGE_LIMIT:
        raise LighthouseError('区间日维度骑手分析最长 {} 天'.format(DAILY_RANGE_LIMIT))
    try:
        state = xiaoxiang_lighthouse.load_state()
    except LighthouseError as exc:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise BillCollectionError('小象灯塔会话不可用（{}），请先在系统通道完成小象灯塔认证'.format(exc)) from None
    if state is None:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise BillCollectionError('尚未保存小象灯塔会话，请先在系统通道完成小象灯塔认证')
    log('[下载] 正在查询小象灯塔商配送数据看板（{} 至 {}，共 {} 天）'.format(
        start.isoformat(), end.isoformat(), (end - start).days + 1))
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('区间日维度骑手分析已取消')
    session = board_session(state)
    cache, records, skipped = {}, [], []
    try:
        day = start
        while day <= end:
            if cancelled is not None and cancelled.is_set():
                raise LighthouseError('区间日维度骑手分析已取消')
            if day not in cache:
                cache[day] = query_rider_daily(session, day)['rows']
            rows = cache[day]
            if not rows:
                skipped.append(day.isoformat())
                log('[跳过] {} 没有骑手分析数据'.format(day.isoformat()))
            else:
                previous_day = day - timedelta(days=7)
                if previous_day not in cache:
                    cache[previous_day] = query_rider_daily(session, previous_day)['rows']
                records.extend(merge_daily_rows(day, rows, cache[previous_day]))
                log('[进度] {}：{} 行'.format(day.isoformat(), len(rows)))
            day += timedelta(days=1)
    except SessionExpired:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise
    finally:
        session.close()
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('区间日维度骑手分析已取消')
    if not records:
        raise LighthouseError('所选日期内均无骑手分析数据{}'.format(
            '（{}）'.format('、'.join(skipped)) if skipped else ''))
    target = Path(directory) / '{}-{}区间日维度骑手分析.xlsx'.format(start.isoformat(), end.isoformat())
    info = write_daily_range_workbook(records, target, cancelled)
    log('[校验] 区间日维度骑手分析：{} 行 / {} 列{}'.format(
        info['rows'], info['columns'],
        '；跳过 {} 天'.format(len(skipped)) if skipped else ''))
    return target


DETAIL_PAGE_LIMIT = 50000
DETAIL_PAGE_GUARD = 100
DETAIL_RANGE_LIMIT = 31
DETAIL_SOURCE_URL = ('https://zl.meituan.com/page/maglar-center/'
                     'view/transport-analysis?supplierId={}')
DETAIL_TABLES = {
    'detail_orders': {
        'tab_id': 13793,
        'title': '配送订单明细',
        'pathname': '/$fe//orderDetail/table',
        'extra': {'is_transport_overtime': '-1'},
        'columns': (
            ('dt', '日期'), ('order_id', '订单号'), ('delivery_id', '履约单号'),
            ('time_package', '时效包'), ('order_source', '订单来源'),
            ('total_pay', '订单支付金额'), ('pkg_weight', '订单重量'),
            ('is_sanfang', '是否三方运力'), ('city_name', '城市'),
            ('supplier_name', '合作商名称'), ('rider_mis', '骑手mis号'),
            ('rider_id', '骑手ID'), ('rider_name', '骑手姓名'), ('site_name', '所属站点'),
            ('push_time', '推配送时间'), ('rider_take_time', '骑手取货时间'),
            ('transport_estimate_time', '预计送达时间'), ('latest_delivery_time', '骑手考核时间'),
            ('arrived_time', '配送完成时间'), ('distance', '配送距离'),
            ('user_rate', '用户评分'), ('is_overtime', '是否整体超时'),
            ('is_poi_delivery_overtime', '是否店内超时'), ('is_transport_overtime', '是否配送超时'),
            ('is_advance_arrive', '预约单是否提前送达'),
        ),
    },
    'detail_kesu': {
        'tab_id': 13794,
        'title': '配送客诉明细',
        'pathname': '/$fe//kesuDetail/table',
        'extra': {},
        'columns': (
            ('dt', '日期'), ('case_id', '客诉工单号'), ('create_time', '工单创建时间'),
            ('order_id', '订单号'), ('city_name', '城市'), ('supplier_name', '合作商名称'),
            ('rider_mis', '骑手mis号'), ('rider_id', '骑手ID'), ('rider_name', '骑手姓名'),
            ('site_name', '所属站点'), ('sku_name', '商品名称'),
            ('question_all', '客诉分类-组合'), ('question_name', '末级问题名称'),
        ),
    },
    'detail_reviews': {
        'tab_id': 13795,
        'title': '配送评价明细',
        'pathname': '/$fe//commentDetail/table',
        'extra': {'review_type': ['-1']},
        'columns': (
            ('dt', '日期'), ('review_id', '评价工单号'), ('review_time', '评价时间'),
            ('order_id', '订单号'), ('city_name', '城市'), ('supplier_name', '合作商名称'),
            ('rider_mis', '骑手mis号'), ('rider_id', '骑手ID'), ('rider_name', '骑手姓名'),
            ('site_name', '所属站点'), ('review_type', '评价类型'), ('comments_tags', '评价标签'),
        ),
    },
}


def query_site_ids(session, start, end, supplier_id=xiaoxiang_lighthouse.SUPPLIER_ID):
    """按站点维度聚合供应商过滤查询，得到账号在区间内的全部站点。"""
    body = query_body(start, supplier_id)
    query = body['queries'][0]
    query['dims'] = ['site_id']
    query['dateDim']['dateKey'] = [start.strftime('%Y%m%d'), end.strftime('%Y%m%d')]
    query['dateDim']['aggrDateDim'] = True
    data = _board_post(session, body)
    rows = data.get('data')
    if not isinstance(rows, list):
        raise LighthouseError('小象数据看板站点列表结构无效，未发布文件')
    sites = sorted({str(row.get('site_id')) for row in rows
                    if isinstance(row, dict) and row.get('site_id') not in (None, '')})
    if not sites:
        raise LighthouseError('未能获取账号站点列表，无法查询配送明细')
    return [int(site) if site.isdigit() else site for site in sites]


def query_detail_rows(session, kind, day, site_ids, supplier_id=xiaoxiang_lighthouse.SUPPLIER_ID):
    """查询单日明细；按 page/limit 翻页直到取满 total，防单日超过平台单页上限。"""
    spec = DETAIL_TABLES[kind]
    key = day.strftime('%Y%m%d')
    custom = {
        'supplierId': str(supplier_id),
        'currentMoudleId': 'Mtx_Component_Id_1',
        '__tabTitle': spec['title'],
        'referenceDatekey': [key, key],
        'siteIds': list(site_ids),
        'clear_help': 1,
        'param_close': '0',
        'dateType': 'day',
        'sourceCode': 'xx_data_service_menu_transport_supplier',
        'sourceUrl': DETAIL_SOURCE_URL.format(supplier_id),
        '$apipathname': spec['pathname'],
        'page': 1,
        'limit': DETAIL_PAGE_LIMIT,
    }
    custom.update(spec['extra'])
    url = BOARD_BASE + '/api/mall/mustang/' + str(spec['tab_id'])
    collected = []
    for page in range(1, DETAIL_PAGE_GUARD + 1):
        custom['page'] = page
        try:
            response = session.post(url, json={'customParams': json.dumps(custom, ensure_ascii=False)},
                                    timeout=300)
        except requests.RequestException as exc:
            raise LighthouseError('连接小象配送明细接口失败，请检查网络后重试') from exc
        data = _board_json(response)
        rows = data.get('body')
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise LighthouseError('{}行数据结构无效，页面可能已改版；未发布文件'.format(spec['title']))
        collected.extend(rows)
        total = data.get('total')
        if not rows or not isinstance(total, int) or total <= len(collected):
            if isinstance(total, int) and total > len(collected):
                raise LighthouseError('{}单日数据超过平台查询上限（{} 行 > {} 行），未发布不完整文件'.format(
                    spec['title'], total, len(collected)))
            return collected
    raise LighthouseError('{}明细分页超出保护上限，未发布文件'.format(spec['title']))


def detail_row_values(spec, day, row):
    values = []
    for code, _ in spec['columns']:
        if code == 'dt':
            values.append(day.isoformat())
        elif code == 'rider_id':
            values.append(_rider_id(row.get('rider_id')))
        else:
            value = row.get(code)
            values.append(None if value is None else str(value))
    return values


def write_detail_workbook(spec, records, target, cancelled=None):
    if not records:
        raise LighthouseError('所选日期内没有{}数据'.format(spec['title']))
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('{}已取消'.format(spec['title']))
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.detail_' + uuid.uuid4().hex + '.xlsx')
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet(spec['title'])
    for index, (_, name) in enumerate(spec['columns'], start=1):
        sheet.column_dimensions[get_column_letter(index)].width = min(max(len(name) * 2 + 2, 12), 60)
    sheet.freeze_panes = 'A2'

    def cells(values):
        result = []
        for value in values:
            cell = WriteOnlyCell(sheet, value=value)
            if isinstance(value, str):
                cell.data_type = 's'
            result.append(cell)
        return result

    saved = False
    try:
        sheet.append(cells([name for _, name in spec['columns']]))
        for values in records:
            if cancelled is not None and cancelled.is_set():
                raise LighthouseError('{}已取消'.format(spec['title']))
            sheet.append(cells(values))
        if cancelled is not None and cancelled.is_set():
            raise LighthouseError('{}已取消'.format(spec['title']))
        workbook.save(temporary)
        saved = True
        os.replace(temporary, target)
    finally:
        if not saved:
            try:
                workbook.save(temporary)
            except Exception:
                pass
        workbook.close()
        temporary.unlink(missing_ok=True)
    return {'rows': len(records), 'columns': len(spec['columns'])}


def generate_detail(kind, start, end, directory, log=None, cancelled=None):
    """逐日查询配送明细并合并为区间工作簿，返回文件路径。"""
    spec = DETAIL_TABLES[kind]
    title = spec['title']
    log = log or (lambda message, *args, **kwargs: None)
    start = start if isinstance(start, date) else date.fromisoformat(str(start))
    end = end if isinstance(end, date) else date.fromisoformat(str(end))
    if start > end:
        raise LighthouseError('开始日期不能晚于结束日期')
    if (end - start).days + 1 > DETAIL_RANGE_LIMIT:
        raise LighthouseError('{}日期区间最长 {} 天'.format(title, DETAIL_RANGE_LIMIT))
    try:
        state = xiaoxiang_lighthouse.load_state()
    except LighthouseError as exc:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise BillCollectionError('小象灯塔会话不可用（{}），请先在系统通道完成小象灯塔认证'.format(exc)) from None
    if state is None:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise BillCollectionError('尚未保存小象灯塔会话，请先在系统通道完成小象灯塔认证')
    log('[下载] 正在查询小象灯塔{}（{} 至 {}，共 {} 天）'.format(
        title, start.isoformat(), end.isoformat(), (end - start).days + 1))
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('{}已取消'.format(title))
    session = board_session(state)
    records, skipped = [], []
    try:
        site_ids = query_site_ids(session, start, end)
        log('[进度] 账号站点 {} 个'.format(len(site_ids)))
        day = start
        while day <= end:
            if cancelled is not None and cancelled.is_set():
                raise LighthouseError('{}已取消'.format(title))
            rows = query_detail_rows(session, kind, day, site_ids)
            if not rows:
                skipped.append(day.isoformat())
                log('[跳过] {} 没有{}数据'.format(day.isoformat(), title))
            else:
                records.extend(detail_row_values(spec, day, row) for row in rows)
                log('[进度] {}：{} 行'.format(day.isoformat(), len(rows)))
            day += timedelta(days=1)
    except SessionExpired:
        from xiaoxiang_source_auth import AUTH
        AUTH.invalidate()
        raise
    finally:
        session.close()
    if cancelled is not None and cancelled.is_set():
        raise LighthouseError('{}已取消'.format(title))
    if not records:
        raise LighthouseError('所选日期内均无{}数据{}'.format(
            title, '（{}）'.format('、'.join(skipped)) if skipped else ''))
    if start == end:
        target = Path(directory) / '{}{}.xlsx'.format(start.isoformat(), title)
    else:
        target = Path(directory) / '{}-{}{}.xlsx'.format(start.isoformat(), end.isoformat(), title)
    info = write_detail_workbook(spec, records, target, cancelled)
    log('[校验] {}：{} 行 / {} 列{}'.format(
        title, info['rows'], info['columns'],
        '；跳过 {} 天'.format(len(skipped)) if skipped else ''))
    return target
