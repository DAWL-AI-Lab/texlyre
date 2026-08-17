[CmdletBinding()]
param(
    [int]$Port = 7021,
    [string]$ListenAddress = '127.0.0.1',
    [string]$AccessToken = ''
)

$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
$nodeHome = Join-Path $toolsRoot 'node-v24.19.0-win-x64'
$node = Join-Path $nodeHome 'node.exe'
$server = Join-Path $PSScriptRoot 'local-latex-typesetter.mjs'

foreach ($path in @($node, $server)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required typesetter component was not found: $path"
    }
}

if (-not (Get-Command latexmk -ErrorAction SilentlyContinue)) {
    throw 'latexmk was not found on PATH. Install MiKTeX with pdfLaTeX, XeLaTeX, LuaLaTeX, Biber, and latexmk first.'
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "A local typesetter is already listening on port $Port."
    exit 0
}

if ($ListenAddress -ne '127.0.0.1' -and [string]::IsNullOrWhiteSpace($AccessToken)) {
    throw 'An AccessToken is required when exposing the MiKTeX typesetter beyond localhost.'
}

$logDirectory = Join-Path $toolsRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdoutLog = Join-Path $logDirectory 'latex-typesetter.stdout.log'
$stderrLog = Join-Path $logDirectory 'latex-typesetter.stderr.log'

$previousTypesetterPort = $env:TEXLYRE_TYPESETTER_PORT
$previousTypesetterHost = $env:TEXLYRE_TYPESETTER_HOST
$previousTypesetterToken = $env:TEXLYRE_TYPESETTER_TOKEN
try {
    # -Environment is unavailable in Windows PowerShell 5.1. Start-Process
    # inherits this temporary process environment variable instead.
    $env:TEXLYRE_TYPESETTER_PORT = "$Port"
    $env:TEXLYRE_TYPESETTER_HOST = $ListenAddress
    if ([string]::IsNullOrWhiteSpace($AccessToken)) {
        Remove-Item Env:TEXLYRE_TYPESETTER_TOKEN -ErrorAction SilentlyContinue
    } else {
        $env:TEXLYRE_TYPESETTER_TOKEN = $AccessToken
    }
    $process = Start-Process -FilePath $node -ArgumentList $server -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru -ErrorAction Stop
} finally {
    if ($null -eq $previousTypesetterPort) {
        Remove-Item Env:TEXLYRE_TYPESETTER_PORT -ErrorAction SilentlyContinue
    } else {
        $env:TEXLYRE_TYPESETTER_PORT = $previousTypesetterPort
    }
    if ($null -eq $previousTypesetterHost) {
        Remove-Item Env:TEXLYRE_TYPESETTER_HOST -ErrorAction SilentlyContinue
    } else {
        $env:TEXLYRE_TYPESETTER_HOST = $previousTypesetterHost
    }
    if ($null -eq $previousTypesetterToken) {
        Remove-Item Env:TEXLYRE_TYPESETTER_TOKEN -ErrorAction SilentlyContinue
    } else {
        $env:TEXLYRE_TYPESETTER_TOKEN = $previousTypesetterToken
    }
}

Write-Output "Started the MiKTeX typesetter (PID $($process.Id)) at ws://$ListenAddress`:$Port. Logs: $stderrLog"
