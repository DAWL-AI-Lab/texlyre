[CmdletBinding()]
param(
	[switch]$Https,
	[switch]$SkipBuild,
	[ValidateRange(1, 65535)]
	[int]$TypesetterPort = 7021,
	[string]$TypesetterUrl = '',
	[string]$TokenFile = '',
	[string]$AccessToken = ''
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $env:USERPROFILE '.local\texlyre-tools'
$defaultTokenFile = Join-Path $toolsRoot 'typesetter-proxy.token'

if ([string]::IsNullOrWhiteSpace($TokenFile)) {
	$TokenFile = $defaultTokenFile
}
$tokenDirectory = Split-Path -Parent $TokenFile
if ([string]::IsNullOrWhiteSpace($tokenDirectory)) {
	$TokenFile = Join-Path $repositoryRoot $TokenFile
	$tokenDirectory = $repositoryRoot
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
	throw 'Docker Desktop is required. Install and start Docker Desktop, then run this launcher again.'
}

& docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) {
	throw 'Docker Desktop is not running. Start it, wait for it to become ready, then run this launcher again.'
}

if ($Https) {
	foreach ($certificateFile in @('certs/tls.crt', 'certs/tls.key')) {
		if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $certificateFile))) {
			throw "HTTPS requires $certificateFile. See README.md for certificate setup."
		}
	}
}

$tokenFileExists = Test-Path -LiteralPath $TokenFile
New-Item -ItemType Directory -Force -Path $tokenDirectory | Out-Null
$token = if (-not [string]::IsNullOrWhiteSpace($AccessToken)) {
	$AccessToken.Trim()
} elseif ($tokenFileExists) {
	(Get-Content -LiteralPath $TokenFile -Raw).Trim()
} else {
	''
}

if ([string]::IsNullOrWhiteSpace($token)) {
	$tokenBytes = New-Object byte[] 32
	$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
	try {
		$random.GetBytes($tokenBytes)
	} finally {
		$random.Dispose()
	}
	$token = [Convert]::ToBase64String($tokenBytes)
}
Set-Content -LiteralPath $TokenFile -Value $token -NoNewline -Encoding ascii
$tokenFileExists = $true

if ([string]::IsNullOrWhiteSpace($TypesetterUrl)) {
	$listener = Get-NetTCPConnection -LocalPort $TypesetterPort -State Listen -ErrorAction SilentlyContinue |
		Select-Object -First 1
	if ($listener) {
		$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
		if ([string]$processInfo.CommandLine -notmatch 'local-latex-typesetter\.mjs') {
			throw "Port $TypesetterPort is already in use by $($processInfo.Name) (PID $($listener.OwningProcess)); refusing to proxy it as MiKTeX."
		}
		if (-not $tokenFileExists) {
			throw "A Texlyre MiKTeX service is already listening on port $TypesetterPort, but its token file is missing. Stop it before starting this launcher."
		}
		Write-Output "Reusing the existing Texlyre MiKTeX typesetter on port $TypesetterPort."
	} else {
		foreach ($command in @('latexmk', 'miktex')) {
			if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
				throw "$command was not found on PATH. Install MiKTeX and reopen PowerShell before using Remote MiKTeX."
			}
		}

		& (Join-Path $PSScriptRoot 'start-local-latex-typesetter.ps1') `
			-Port $TypesetterPort `
			-ListenAddress '0.0.0.0' `
			-AccessToken $token
	}

	$deadline = (Get-Date).AddSeconds(15)
	do {
		$typesetterReady = Get-NetTCPConnection -LocalPort $TypesetterPort -State Listen -ErrorAction SilentlyContinue
		if ($typesetterReady) { break }
		Start-Sleep -Milliseconds 250
	} while ((Get-Date) -lt $deadline)

	if (-not $typesetterReady) {
		throw "MiKTeX did not start on port $TypesetterPort. Check %USERPROFILE%\.local\texlyre-tools\logs\latex-typesetter.stderr.log."
	}

	$TypesetterUrl = "ws://host.docker.internal:$TypesetterPort"
}

$previousEnvironment = @{
	TypesetterUrl = $env:TEXLYRE_TYPESETTER_URL
	ProxyToken = $env:TEXLYRE_TYPESETTER_PROXY_TOKEN
}

try {
	# These values are consumed by Compose and stored in the container only.
	# nginx injects the token upstream; client-side JavaScript never sees it.
	$env:TEXLYRE_TYPESETTER_URL = $TypesetterUrl
	$env:TEXLYRE_TYPESETTER_PROXY_TOKEN = $token

	$composeArgs = @()
	if ($Https) {
		$composeArgs += @('-f', 'compose.https.yaml')
	}
	$composeArgs += @('up', '--detach')
	if (-not $SkipBuild) {
		$composeArgs += '--build'
	}

	Push-Location $repositoryRoot
	try {
		& docker compose @composeArgs
		if ($LASTEXITCODE -ne 0) {
			throw 'Docker Compose did not start Texlyre.'
		}

		$containerId = (& docker compose @($composeArgs | Where-Object { $_ -notin @('up', '--detach', '--build') }) ps -q texlyre).Trim()
		if ([string]::IsNullOrWhiteSpace($containerId)) {
			throw 'Docker Compose started without a Texlyre container.'
		}

		$healthDeadline = (Get-Date).AddSeconds(45)
		do {
			$health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $containerId).Trim()
			if ($health -eq 'healthy') { break }
			if ($health -eq 'unhealthy') {
				& docker compose @($composeArgs | Where-Object { $_ -notin @('up', '--detach', '--build') }) logs --no-color
				throw 'Texlyre container health check failed.'
			}
			Start-Sleep -Seconds 1
		} while ((Get-Date) -lt $healthDeadline)

		if ($health -ne 'healthy') {
			throw "Texlyre did not become healthy within 45 seconds (status: $health)."
		}
	} finally {
		Pop-Location
	}
} finally {
	if ($null -eq $previousEnvironment.TypesetterUrl) {
		Remove-Item Env:TEXLYRE_TYPESETTER_URL -ErrorAction SilentlyContinue
	} else {
		$env:TEXLYRE_TYPESETTER_URL = $previousEnvironment.TypesetterUrl
	}
	if ($null -eq $previousEnvironment.ProxyToken) {
		Remove-Item Env:TEXLYRE_TYPESETTER_PROXY_TOKEN -ErrorAction SilentlyContinue
	} else {
		$env:TEXLYRE_TYPESETTER_PROXY_TOKEN = $previousEnvironment.ProxyToken
	}
}

$protocol = if ($Https) { 'https' } else { 'http' }
$port = if ($Https) { 8443 } else { 8080 }
Write-Output "Texlyre is ready at ${protocol}://localhost`:$port/texlyre/"
Write-Output 'Open it through this computer''s LAN address or DNS name to use Remote MiKTeX (server).'
