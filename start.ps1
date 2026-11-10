$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '请先安装 Node.js 20 或更高版本。' -ForegroundColor Yellow
    Read-Host '按回车退出'
    exit 1
}
node server.mjs --open
