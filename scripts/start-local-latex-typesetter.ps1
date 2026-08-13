[CmdletBinding()]
param(
    [int]$Port = 7021
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

$logDirectory = Join-Path $toolsRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdoutLog = Join-Path $logDirectory 'latex-typesetter.stdout.log'
$stderrLog = Join-Path $logDirectory 'latex-typesetter.stderr.log'

$previousTypesetterPort = $env:TEXLYRE_TYPESETTER_PORT
try {
    # -Environment is unavailable in Windows PowerShell 5.1. Start-Process
    # inherits this temporary process environment variable instead.
    $env:TEXLYRE_TYPESETTER_PORT = "$Port"
    $process = Start-Process -FilePath $node -ArgumentList $server -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru -ErrorAction Stop
} finally {
    if ($null -eq $previousTypesetterPort) {
        Remove-Item Env:TEXLYRE_TYPESETTER_PORT -ErrorAction SilentlyContinue
    } else {
        $env:TEXLYRE_TYPESETTER_PORT = $previousTypesetterPort
    }
}

Write-Output "Started the local LaTeX typesetter (PID $($process.Id)) at ws://localhost:$Port. Logs: $stderrLog"
