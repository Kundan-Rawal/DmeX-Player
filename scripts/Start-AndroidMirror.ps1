[CmdletBinding()]
param([ValidatePattern('^[A-Za-z0-9_.:-]+$')][string]$Device)

. (Join-Path $PSScriptRoot 'Use-AndroidEnvironment.ps1')
$scrcpy = Join-Path $env:DMEX_SCRCPY_HOME 'scrcpy.exe'
if (-not (Test-Path -LiteralPath $scrcpy)) { throw 'scrcpy is not installed. Set DMEX_SCRCPY_HOME.' }
if (-not $Device) {
    $connected = @(& $env:ADB devices | ForEach-Object {
        if ($_ -match '^(\S+)\s+device\s*$') { $Matches[1] }
    })
    if ($connected.Count -ne 1) { throw 'Connect and authorize one phone, or pass -Device SERIAL.' }
    $Device = $connected[0]
}
if ((& $env:ADB -s $Device get-state) -ne 'device') { throw 'The selected phone is not authorized and ready.' }
$existing = Get-Process scrcpy -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -eq $scrcpy -and $_.MainWindowTitle -eq 'DmeX Player - Android'
}
if ($existing) { Write-Output "Mirroring is already running (PID $($existing[0].Id))."; return }
$logs = Join-Path $env:LOCALAPPDATA 'DmeX-Tools\logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $logs "mirror-$stamp.log"
$stderr = Join-Path $logs "mirror-$stamp.error.log"
$process = Start-Process -FilePath $scrcpy -ArgumentList @('--serial', $Device, '--no-audio', '--window-title', '"DmeX Player - Android"') `
    -WorkingDirectory $env:DMEX_SCRCPY_HOME -WindowStyle Normal -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Write-Output "Started phone mirroring (PID $($process.Id)). Audio stays on the phone; no FPS cap is set."
Write-Output "Logs: $stdout ; $stderr"
