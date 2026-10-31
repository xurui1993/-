"""Official page-export endpoints, verified against deployed page scripts."""
ALL_CITIES = '全部城市'
DATASETS = {
    'lanorange_rider_quit': ('骑手离职', 'info/riderQuit/export'),
    'lanorange_rider_report': ('离职报备', 'info/riderReportDetail/export'),
    'lanorange_batch_quit': ('批量离职', 'info/riderBatchQuit/export'),
    'lanorange_rider_leave': ('骑手请假', 'info/riderLeave/export'),
    'lanorange_identity_change': ('骑手兼全职变更', 'info/riderIdentityChange/export'),
    'lanorange_salary_replace': ('佣金代领', 'info/riderSalaryReplace/export'),
    'lanorange_part_price': ('价格档案', 'salary/partRiderPrice/export'),
    'lanorange_rider_archive': ('骑手档案', 'info/riderInfo/export'),
}


def city_scoped(config, dataset):
    # Historical jobs retain their original global scope.
    return bool(config.get('lanorange_by_city')) and dataset in DATASETS


def source_key(city, dataset):
    return dataset if city == ALL_CITIES else city + '|' + dataset


def source_directory(root, city, dataset):
    from download_archive import archive_component
    base = root / '原始资料' / '蓝橙'
    return base / dataset if city == ALL_CITIES else base / archive_component(city) / dataset
