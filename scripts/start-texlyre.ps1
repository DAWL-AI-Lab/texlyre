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
$previousTypesetterProxyToken = $env:TEXLYRE_TYPESETTER_PROXY_TOKEN
$typesetterProxyTokenFile = Join-Path $toolsRoot 'typesetter-proxy.token'
$typesetterProxyToken = ''
if (Test-Path -LiteralPath $typesetterProxyTokenFile) {
    $typesetterProxyToken = (Get-Content -LiteralPath $typesetterProxyTokenFile -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($typesetterProxyToken)) {
    $tokenBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($tokenBytes)
    } finally {
        $random.Dispose()
    }
    $typesetterProxyToken = [Convert]::ToBase64String($tokenBytes)
    Set-Content -LiteralPath $typesetterProxyTokenFile -Value $typesetterProxyToken -NoNewline -Encoding ascii
}

try {
    # Vite forwards this server-only header to the loopback compiler. It is
    # intentionally not exposed to browser JavaScript or saved in userdata.
    $env:TEXLYRE_TYPESETTER_PROXY_TOKEN = $typesetterProxyToken

    & (Join-Path $PSScriptRoot 'start-ltex-lsp.ps1')
    & (Join-Path $PSScriptRoot 'start-local-latex-typesetter.ps1') -AccessToken $typesetterProxyToken

    $typesetterDeadline = (Get-Date).AddSeconds(10)
    do {
        $typesetterReady = Get-NetTCPConnection -LocalPort 7021 -State Listen -ErrorAction SilentlyContinue
        if ($typesetterReady) { break }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $typesetterDeadline)

    if (-not $typesetterReady) {
        throw 'The local MiKTeX typesetter did not start on port 7021. Check latex-typesetter.stderr.log.'
    }

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
} finally {
    if ($null -eq $previousTypesetterProxyToken) {
        Remove-Item Env:TEXLYRE_TYPESETTER_PROXY_TOKEN -ErrorAction SilentlyContinue
    } else {
        $env:TEXLYRE_TYPESETTER_PROXY_TOKEN = $previousTypesetterProxyToken
    }
}
