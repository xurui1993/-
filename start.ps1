$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ([int]((& node -p 'parseInt(process.versions.node)') | Select-Object -Last 1) -lt 24) { throw '启动需要 Node.js 24 或更高版本。' }
$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    & python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw '创建 Python 虚拟环境失败，请确认已安装 Python 3.11 或更新版本。' }
}
& $venvPython -c 'import fastapi, uvicorn, pandas, polars, fastexcel, openpyxl, python_calamine, lxml, psutil, xlsxwriter, requests, multipart, playwright'
if ($LASTEXITCODE -ne 0) {
    & $venvPython -m pip install -r backend/requirements-crawler.txt
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重新运行。' }
}
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Node 依赖安装失败，请检查网络后重新运行。' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '构建失败，请查看上方错误。' }
$env:PYTHON_PATH = $venvPython
$env:NODE_ENV = 'production'
$env:PORT = '3000'
$env:BACKEND_PORT = '8009'
$env:PYTHONIOENCODING = 'utf-8'
Write-Host '启动后访问 http://localhost:3000。'
& node dist/server.js
if ($LASTEXITCODE -ne 0) { throw '系统退出，请查看上方错误。' }
