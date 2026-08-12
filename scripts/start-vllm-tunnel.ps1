[CmdletBinding()]
param(
    [int]$Port = 8000,
    [string]$HostName = ''
)

if ([string]::IsNullOrWhiteSpace($HostName)) {
    $HostName = $env:TEXLYRE_VLLM_HOST
}
if ([string]::IsNullOrWhiteSpace($HostName)) {
    $HostName = 'MariaBambinaSuperComputer'
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "A service is already listening on local port $Port."
    exit 0
}

$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
$logDirectory = Join-Path $toolsRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$process = Start-Process -FilePath ssh -ArgumentList @(
    '-N',
    '-L', "127.0.0.1:$Port`:127.0.0.1:8000",
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    $HostName
) -RedirectStandardOutput (Join-Path $logDirectory 'vllm-tunnel.stdout.log') -RedirectStandardError (Join-Path $logDirectory 'vllm-tunnel.stderr.log') -WindowStyle Hidden -PassThru

Write-Output "Started the vLLM SSH tunnel (PID $($process.Id)) at http://127.0.0.1:$Port."
