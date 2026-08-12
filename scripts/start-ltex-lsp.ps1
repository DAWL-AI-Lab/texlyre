[CmdletBinding()]
param(
    [int]$Port = 7020
)

$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
$proxy = Join-Path $toolsRoot 'lsp-ws-proxy.exe'
$server = Join-Path $toolsRoot 'ltex-ls-plus-18.7.0\bin\ltex-ls-plus.bat'
$javaHome = Join-Path $toolsRoot 'ltex-ls-plus-18.7.0\jdk-21.0.10+7'

foreach ($path in @($proxy, $server, $javaHome)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required LTeX tool was not found: $path. Follow setup.md to reinstall it."
    }
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "An LSP service is already listening on port $Port."
    exit 0
}

$arguments = @('-l', "127.0.0.1:$Port", '--', 'cmd.exe', '/c', $server)
$logDirectory = Join-Path $toolsRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdoutLog = Join-Path $logDirectory 'ltex-lsp.stdout.log'
$stderrLog = Join-Path $logDirectory 'ltex-lsp.stderr.log'
$process = Start-Process -FilePath $proxy -ArgumentList $arguments -Environment @{ JAVA_HOME = $javaHome; RUST_LOG = 'debug' } -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
Write-Output "Started LTeX LS Plus (PID $($process.Id)) at ws://localhost:$Port. Logs: $stderrLog"
