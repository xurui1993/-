"""Package the clear five-entry project layout, without generated or personal state."""
from pathlib import Path
import hashlib,json,os,stat,zipfile

ROOT=Path(__file__).resolve().parents[1]
PROJECT_ROOT=ROOT.parent
REQUIRED=('package.json','package-lock.json','server.ts','src/App.tsx','backend/main.py','backend/requirements.txt','start.ps1')
AREAS={'backend','src','public','scripts','server','system_templates','tests'}
ROOT_FILES={'.env.example','.gitignore','package.json','package-lock.json','server.ts','index.html','start.ps1','tsconfig.json','vite.config.ts'}
SKIP_DIRS={'node_modules','.venv','.git','__pycache__','.pytest_cache','.local_auth','.local_downloads','personal-runtime','runtime','data','uploads','outputs','archive','coverage','config_history','dist'}
PRIVATE_PREFIXES=('.local_auth','.local_downloads')

def walk(folder):
    for entry in os.scandir(folder):
        path=Path(entry.path);info=entry.stat(follow_symlinks=False)
        if info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:continue
        if entry.is_dir(follow_symlinks=False):
            if any(entry.name.startswith(prefix) for prefix in PRIVATE_PREFIXES):continue
            if entry.name not in SKIP_DIRS and not ('tests' in path.parts and entry.name.startswith('tmp')):yield from walk(path)
        elif entry.is_file(follow_symlinks=False):yield path

def collect():
    entries=[]
    for source in walk(ROOT):
        relative=source.relative_to(ROOT)
        if not ((len(relative.parts)==1 and source.name in ROOT_FILES) or relative.parts[0] in AREAS):continue
        if source.suffix.lower() in ('.pyc','.log','.dpapi','.sqlite3','.storage','.part'):continue
        if source.name.startswith('.env') and source.name!='.env.example':continue
        if source.name=='异常骑手跟进模板.xlsx':continue
        entries.append((relative,source))
    names={name.as_posix() for name,_ in entries}
    if not set(REQUIRED).issubset(names):raise ValueError('Package missing required source files')
    return sorted(entries)

def collect_project():
    entries=[(Path('app')/name,file) for name,file in collect()]
    for name in ('README.md','启动系统.cmd'):
        file=PROJECT_ROOT/name
        if not file.is_file():raise ValueError('Root entry missing: '+name)
        entries.append((Path(name),file))
    for file in walk(PROJECT_ROOT/'docs'):
        if file.suffix.lower() not in ('.md','.json'):continue
        if file.name in ('SOURCE_MANIFEST.json','SHA256.txt'):continue
        entries.append((file.relative_to(PROJECT_ROOT),file))
    return sorted(entries)

def package(output):
    output=Path(output);files={name.as_posix():file.read_bytes() for name,file in collect_project()}
    manifest={'format':'source-only','root_entries':['启动系统.cmd','README.md','app/','docs/'],
              'excluded':['dependencies','builds','personal data','platform sessions','history and logs'],
              'files':[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in sorted(files.items())]}
    files['docs/SOURCE_MANIFEST.json']=json.dumps(manifest,ensure_ascii=False,indent=2).encode('utf8')
    files['docs/SHA256.txt']=''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(files.items())).encode('utf8')
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'x',zipfile.ZIP_DEFLATED) as archive:
        for name,data in sorted(files.items()):
            info=zipfile.ZipInfo('薪酬工作台/'+name,(2026,10,29,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:raise ValueError('Package CRC mismatch')
        for name,data in files.items():
            if archive.read('薪酬工作台/'+name)!=data:raise ValueError('Package readback mismatch: '+name)
        for line in files['docs/SHA256.txt'].decode().splitlines():
            sha,name=line.split('  ',1)
            if hashlib.sha256(archive.read('薪酬工作台/'+name)).hexdigest()!=sha:raise ValueError('Package digest mismatch')
    # The same checksum documents are visible in the prepared source directory.
    for name in ('docs/SOURCE_MANIFEST.json','docs/SHA256.txt'):(PROJECT_ROOT/name).write_bytes(files[name])
    return {'archive':str(output.resolve()),'files':len(files),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'root_entries':len(manifest['root_entries']),'crc_verified':True,'file_hashes_verified':True}

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    print(json.dumps(package(parser.parse_args().output),ensure_ascii=True))
