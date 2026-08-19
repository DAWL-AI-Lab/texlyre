[CmdletBinding()]
param(
	[string]$CommonName = 'localhost',
	[string[]]$DnsName = @('localhost'),
	[string[]]$IpAddress = @('127.0.0.1'),
	[ValidateRange(1, 3650)]
	[int]$ValidDays = 365,
	[string]$CertificateDirectory = '',
	[switch]$Force
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($CertificateDirectory)) {
	$CertificateDirectory = Join-Path $repositoryRoot 'certs'
} elseif (-not [System.IO.Path]::IsPathRooted($CertificateDirectory)) {
	$CertificateDirectory = Join-Path $repositoryRoot $CertificateDirectory
}

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
	throw 'OpenSSL is required to create PEM certificate and key files. Install an OpenSSL distribution, make openssl.exe available on PATH, then run this script again.'
}

$subjectAlternativeNames = New-Object System.Collections.Generic.List[string]
foreach ($name in $DnsName) {
	if (-not [string]::IsNullOrWhiteSpace($name)) {
		$subjectAlternativeNames.Add("DNS:$($name.Trim())")
	}
}

foreach ($address in $IpAddress) {
	$parsedAddress = $null
	if (-not [System.Net.IPAddress]::TryParse($address, [ref]$parsedAddress)) {
		throw "'$address' is not a valid IP address."
	}
	$subjectAlternativeNames.Add("IP:$parsedAddress")
}

if ($subjectAlternativeNames.Count -eq 0) {
	throw 'Specify at least one DNS name or IP address.'
}

New-Item -ItemType Directory -Force -Path $CertificateDirectory | Out-Null
$certificatePath = Join-Path $CertificateDirectory 'tls.crt'
$keyPath = Join-Path $CertificateDirectory 'tls.key'

if ((Test-Path -LiteralPath $certificatePath) -or (Test-Path -LiteralPath $keyPath)) {
	if (-not $Force) {
		throw "TLS files already exist in '$CertificateDirectory'. Re-run with -Force to replace them."
	}
	Remove-Item -LiteralPath $certificatePath, $keyPath -Force -ErrorAction SilentlyContinue
}

$opensslConfigPath = Join-Path $CertificateDirectory ('.texlyre-openssl-' + [Guid]::NewGuid().ToString('N') + '.cnf')
[System.IO.File]::WriteAllText($opensslConfigPath, @"
[req]
distinguished_name = subject

[subject]
"@, [System.Text.Encoding]::ASCII)

try {
	$opensslArguments = @(
		'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
		'-config', $opensslConfigPath,
		'-days', $ValidDays,
		'-keyout', $keyPath,
		'-out', $certificatePath,
		'-subj', "/CN=$CommonName",
		'-addext', "subjectAltName=$($subjectAlternativeNames -join ',')",
		'-addext', 'basicConstraints=critical,CA:FALSE',
		'-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
		'-addext', 'extendedKeyUsage=serverAuth'
	)

	& $openssl.Source @opensslArguments
	if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $certificatePath) -or -not (Test-Path -LiteralPath $keyPath)) {
		throw 'OpenSSL did not create the TLS certificate and private key.'
	}
} finally {
	if (Test-Path -LiteralPath $opensslConfigPath) {
		Remove-Item -LiteralPath $opensslConfigPath -Force
	}
}

Write-Output "Created $certificatePath"
Write-Output "Created $keyPath"
Write-Output "Certificate names: $($subjectAlternativeNames -join ', ')"
