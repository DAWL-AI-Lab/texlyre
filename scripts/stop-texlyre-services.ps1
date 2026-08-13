[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [switch]$IncludeVite,
    [switch]$ForceUnknownListeners
)

$services = @(
    @{
        Port = 7020
        Name = 'LTeX WebSocket bridge'
        CommandLinePattern = 'lsp-ws-proxy|ltex-ls-plus'
    },
    @{
        Port = 7021
        Name = 'Local MiKTeX typesetter'
        CommandLinePattern = 'local-latex-typesetter\.mjs'
    },
    @{
        Port = 8000
        Name = 'vLLM SSH tunnel'
        CommandLinePattern = 'ssh(?:\.exe)?\s.*-L\s+127\.0\.0\.1:8000'
    }
)

if ($IncludeVite) {
    $services += @{
        Port = 5173
        Name = 'Vite development server'
        CommandLinePattern = '\bvite\b'
    }
}

foreach ($service in $services) {
    $connections = @(
        Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue |
            Sort-Object OwningProcess -Unique
    )

    if ($connections.Count -eq 0) {
        Write-Output "$($service.Name) is not listening on port $($service.Port)."
        continue
    }

    foreach ($connection in $connections) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
        $commandLine = [string]$processInfo.CommandLine
        $isTexlyreService = $commandLine -match $service.CommandLinePattern

        if (-not $isTexlyreService -and -not $ForceUnknownListeners) {
            Write-Warning "Skipped PID $($connection.OwningProcess) on port $($service.Port): it does not look like $($service.Name). Use -ForceUnknownListeners only if you have verified that process belongs to TeXlyre."
            continue
        }

        $target = "PID $($connection.OwningProcess) ($($processInfo.Name)) on port $($service.Port)"
        if ($PSCmdlet.ShouldProcess($target, "Stop $($service.Name)")) {
            Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
            Write-Output "Stopped $($service.Name): $target"
        }
    }
}
