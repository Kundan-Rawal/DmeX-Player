$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../../../scripts/Use-AndroidEnvironment.ps1" -ForBuild
$tools = Join-Path $env:ANDROID_HOME 'build-tools/36.1.0'
$android = Join-Path $env:ANDROID_HOME 'platforms/android-36/android.jar'
$output = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../artifacts/focus-probe'))
New-Item -ItemType Directory -Path "$output/classes", "$output/dex" -Force | Out-Null
& javac -source 8 -target 8 -classpath $android -d "$output/classes" "$PSScriptRoot/FocusProbe.java"
if ($LASTEXITCODE) { throw 'Focus probe Java compilation failed' }
& "$tools/d8.bat" --lib $android --output "$output/dex" "$output/classes/com/dmex/focusprobe/FocusProbe.class"
if ($LASTEXITCODE) { throw 'Focus probe dex compilation failed' }
& "$tools/aapt2.exe" link -o "$output/unsigned.apk" --manifest "$PSScriptRoot/AndroidManifest.xml" -I $android
if ($LASTEXITCODE) { throw 'Focus probe packaging failed' }
& jar uf "$output/unsigned.apk" -C "$output/dex" classes.dex
& "$tools/zipalign.exe" -f 4 "$output/unsigned.apk" "$output/aligned.apk"
& "$tools/apksigner.bat" sign --ks "$env:USERPROFILE/.android/debug.keystore" --ks-pass pass:android --key-pass pass:android --out "$output/focus-probe.apk" "$output/aligned.apk"
if ($LASTEXITCODE) { throw 'Focus probe signing failed' }
Write-Output "$output/focus-probe.apk"
