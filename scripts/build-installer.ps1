$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows) { throw 'The installer can only be built on Windows.' }

$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $cargoBin 'cargo.exe'))) {
  $env:PATH = "$cargoBin;$env:PATH"
}

foreach ($command in @('npm.cmd', 'cargo.exe')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command was not found. Install the prerequisites listed in README.md."
  }
}

if (-not (Test-Path (Join-Path $root 'node_modules/.package-lock.json'))) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
}

$runtime = Join-Path $root 'src-tauri/resources/runtime'
$servers = @('cpu', 'vulkan') | ForEach-Object { Join-Path $runtime "$_/llama-server.exe" }
if (@($servers | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -gt 0) {
  & npm.cmd run prepare:runtime
  if ($LASTEXITCODE -ne 0) { throw "Runtime preparation failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path -LiteralPath (Join-Path $runtime 'ocr/manifest.json'))) {
  & (Join-Path $PSScriptRoot 'prepare-ocr.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'OCR preparation failed.' }
}
& node (Join-Path $PSScriptRoot 'verify-ocr-runtime.mjs')
if ($LASTEXITCODE -ne 0) { throw 'OCR bundle verification failed.' }

$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$installer = Join-Path $root "src-tauri/target/release/bundle/nsis/$($config.productName)_$($config.version)_x64-setup.exe"
$started = Get-Date
& npm.cmd run package
if ($LASTEXITCODE -ne 0) { throw "Installer build failed with exit code $LASTEXITCODE." }

$output = Get-Item -LiteralPath $installer -ErrorAction SilentlyContinue
if (-not $output -or $output.LastWriteTime -lt $started.AddSeconds(-2)) {
  throw "The build completed but no new installer was found at $installer."
}

Write-Output "Installer: $($output.FullName)"
