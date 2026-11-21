# Build the signed, standalone release APK/AAB.
# Release APK defaults to DeepSeek direct mode, so users do not need a local gateway.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'web'
$android = Join-Path $web 'android'
$release = Join-Path $root 'release'

if (-not (Test-Path (Join-Path $android 'keystore.properties'))) {
    throw 'Missing web/android/keystore.properties (signing key).'
}
if (-not (Test-Path (Join-Path $android 'app/release.keystore'))) {
    throw 'Missing web/android/app/release.keystore (signing key).'
}

$env:VITE_DIRECT_DEEPSEEK = 'true'
$env:VITE_API_BASE = ''

Push-Location $web
try {
    npm.cmd run build
    npx.cmd cap sync android
} finally {
    Pop-Location
}

$env:JAVA_HOME = 'C:\dev\jdk21'
$env:ANDROID_HOME = 'C:\dev\android-sdk'
$env:Path = "C:\dev\jdk21\bin;C:\dev\android-sdk\platform-tools;$env:Path"

Push-Location $android
try {
    .\gradlew.bat assembleRelease bundleRelease --no-daemon
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $release | Out-Null
$apk = Join-Path $android 'app/build/outputs/apk/release/app-release.apk'
$aab = Join-Path $android 'app/build/outputs/bundle/release/app-release.aab'
Copy-Item $apk (Join-Path $release 'whale-memory-1.0.0.apk') -Force
Copy-Item $aab (Join-Path $release 'whale-memory-1.0.0.aab') -Force

$hashes = Get-ChildItem $release -File |
    Where-Object { $_.Name -match '\.(apk|aab)$' } |
    ForEach-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash + '  ' + $_.Name }
$hashes | Set-Content (Join-Path $release 'SHA256SUMS.txt') -Encoding ASCII

Write-Host ''
Write-Host 'Release artifacts:'
Get-ChildItem $release -File | Select-Object Name, Length | Format-Table -AutoSize
Write-Host 'Back up release/keystore-backup/ offline before publishing.'
