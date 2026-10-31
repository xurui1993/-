import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('home_package', ROOT / 'scripts/pack_home_package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageLayoutTests(unittest.TestCase):
    def test_migrated_project_is_complete_without_local_workspaces_or_retired_template(self):
        self.assertEqual(package.ROOT, ROOT)
        entries = package.collect()
        names = {path.as_posix() for path, _ in entries}
        self.assertTrue(set(package.REQUIRED).issubset(names))
        self.assertIn('tests/fixtures/company_baseline.json', names)
        self.assertIn('tests/fixtures/followup_header.json', names)
        self.assertNotIn('system_templates/异常骑手跟进模板.xlsx', names)
        self.assertFalse(any(name.startswith(('data/workspaces/', 'runtime/', 'archive/', 'uploads/', 'outputs/')) for name in names))
        self.assertFalse(any('/.local_auth' in name or '/.local_downloads' in name for name in names))

    def test_source_package_has_only_four_clear_root_entries(self):
        names={path.as_posix() for path,_ in package.collect_project()}
        roots={name.split('/')[0] for name in names}
        self.assertEqual(roots,{'启动系统.cmd','README.md','app','docs'})
        self.assertIn('app/backend/main.py',names);self.assertIn('app/src/App.tsx',names)

    def test_source_package_excludes_rebuildable_and_operational_files(self):
        names={path.as_posix() for path,_ in package.collect_project()}
        self.assertNotIn('app/gateway/template.zip',names)
        self.assertFalse(any(name.startswith(('app/dist/','app/node_modules/','app/runtime/','app/data/')) for name in names))


if __name__ == '__main__': unittest.main()
