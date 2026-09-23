$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$scratch = Join-Path $root '.scratch'
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$destination = Join-Path $root 'src-tauri/resources/runtime'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$artifacts = @(
  @{ Kind = 'vulkan'; Hash = '513e5305d21c71718f8ae2791ef00bf55cd7377b772ef89788a38bd33cf325cd' },
  @{ Kind = 'cpu'; Hash = '3fce82b9c798702d66a262476256307f771a1d165e319dab1c2137117e35128c' }
)
foreach ($artifact in $artifacts) {
  $archive = Join-Path $scratch ('llama-' + $artifact.Kind + '.zip')
  $uri = 'https://github.com/ggml-org/llama.cpp/releases/download/b10982/llama-b10982-bin-win-' + $artifact.Kind + '-x64.zip'
  if (!(Test-Path $archive)) { Invoke-WebRequest -Uri $uri -OutFile $archive }
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $artifact.Hash) { throw "Runtime checksum mismatch: $($artifact.Kind)" }
  $folder = Join-Path $destination $artifact.Kind
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $folder -Force
  Remove-Item -LiteralPath $archive
}
Write-Output 'Verified llama.cpp b10982 CPU and Vulkan runtimes installed.'
