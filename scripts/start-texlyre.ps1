[CmdletBinding()]
param(
    [switch]$Https,
    [string]$VllmHost = ''
)

$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
$nodeHome = Join-Path $toolsRoot 'node-v24.19.0-win-x64'
$npm = Join-Path $nodeHome 'npm.cmd'

if (-not (Test-Path -LiteralPath $npm)) {
    throw "Node.js 24 was not found at $nodeHome. Follow setup.md to reinstall it."
}

$env:Path = "$nodeHome;$env:Path"
& (Join-Path $PSScriptRoot 'start-ltex-lsp.ps1')
& (Join-Path $PSScriptRoot 'start-local-latex-typesetter.ps1')
if ([string]::IsNullOrWhiteSpace($VllmHost)) {
    & (Join-Path $PSScriptRoot 'start-vllm-tunnel.ps1')
} else {
    & (Join-Path $PSScriptRoot 'start-vllm-tunnel.ps1') -HostName $VllmHost
}

if ($Https) {
    & $npm run dev:https
} else {
    & $npm run dev
}
