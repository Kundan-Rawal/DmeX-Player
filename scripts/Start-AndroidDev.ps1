[CmdletBinding()]
param([ValidatePattern('^[A-Za-z0-9_.:-]+$')][string]$Device)

. (Join-Path $PSScriptRoot 'Use-AndroidEnvironment.ps1') -ForBuild
$connected = @(& $env:ADB devices | ForEach-Object {
    if ($_ -match '^(\S+)\s+device\s*$') { $Matches[1] }
})
if ($connected.Count -ne 1) { throw 'USB development requires exactly one authorized phone. Disconnect other devices first.' }
if ($Device -and $Device -ne $connected[0]) { throw 'The requested phone is not the connected authorized device.' }
$Device = $connected[0]
if ((& $env:ADB -s $Device get-state) -ne 'device') { throw 'The selected phone is not authorized and ready.' }
foreach ($port in @(1420, 1421)) {
    & $env:ADB -s $Device reverse "tcp:$port" "tcp:$port"
    if ($LASTEXITCODE -ne 0) { throw "ADB port forwarding failed for $port" }
}
$env:TAURI_DEV_HOST = '127.0.0.1'
$env:ANDROID_SERIAL = $Device
$project = Join-Path (Split-Path $PSScriptRoot -Parent) 'music-player-ui'
Push-Location $project
try {
    # Tauri 2.10 matches names rather than ADB serials; let it select the sole phone.
    & npm.cmd run tauri -- android dev --host 127.0.0.1
    if ($LASTEXITCODE -ne 0) { throw "Android development exited with code $LASTEXITCODE" }
} finally { Pop-Location }
