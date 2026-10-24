[CmdletBinding()]
param([switch]$ForBuild)

$ErrorActionPreference = 'Stop'
$sdk = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User')
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'platform-tools\adb.exe'))) {
    throw "Android platform-tools are missing from $sdk"
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ADB = Join-Path $sdk 'platform-tools\adb.exe'
$mirror = [Environment]::GetEnvironmentVariable('DMEX_SCRCPY_HOME', 'User')
if ($mirror) { $env:DMEX_SCRCPY_HOME = $mirror }
$paths = @((Join-Path $sdk 'platform-tools'), (Join-Path $sdk 'cmdline-tools\latest\bin'))
if ($mirror) { $paths += $mirror }

if ($ForBuild) {
    $java = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
    if (-not $java) { $java = $env:JAVA_HOME }
    if (-not $java -or -not (Test-Path -LiteralPath (Join-Path $java 'bin\java.exe'))) {
        throw 'Set JAVA_HOME to an installed JDK 17 or newer.'
    }
    $ndk = [Environment]::GetEnvironmentVariable('NDK_HOME', 'User')
    if (-not $ndk -or -not (Test-Path -LiteralPath (Join-Path $ndk 'source.properties'))) {
        throw 'NDK_HOME does not point to an installed Android NDK.'
    }
    $env:JAVA_HOME = $java
    $env:NDK_HOME = $ndk
    $env:ANDROID_NDK_HOME = $ndk
    $paths += Join-Path $java 'bin'

    # Rust build scripts run on Windows even when the app targets Android.
    if (-not (Get-Command link.exe -ErrorAction SilentlyContinue) -or -not $env:WindowsSdkDir) {
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio C++ Build Tools and the Windows SDK.' }
        $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if (-not $vs) { throw 'Visual Studio C++ tools are missing.' }
        $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
        $versions = @(Get-ChildItem (Join-Path $kits 'Include') -Directory -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and
            (Test-Path -LiteralPath (Join-Path $_.FullName 'um\Windows.h')) -and
            (Test-Path -LiteralPath (Join-Path $kits "Lib\$($_.Name)\um\x64\kernel32.lib")) -and
            (Test-Path -LiteralPath (Join-Path $kits "Lib\$($_.Name)\ucrt\x64\ucrt.lib"))
        } | Sort-Object { [version]$_.Name } -Descending)
        if (-not $versions.Count) { throw 'The Windows SDK headers/libraries are missing or incomplete.' }
        Import-Module (Join-Path $vs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
        Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64 -winsdk=$($versions[0].Name)"
        if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) { throw 'Visual Studio linker initialization failed.' }
    }
}
$env:PATH = ($paths + @($env:PATH -split ';' | Where-Object { $_ -and $_ -notin $paths })) -join ';'
