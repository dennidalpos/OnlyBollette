$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'OCR preparation requires Windows x64.' }
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path $root '.scratch/ocr-build'
$destination = Join-Path $root 'src-tauri/resources/runtime/ocr'
$vcpkgRevision = 'dc1232a6e05dcc49703091e83743e3b4df9b9b7c'
$modelRevision = 'e12c65a915945e4c28e237a9b52bc4a8f39a0cec'
$modelHash = '8df9c89176fb93f56bf4b2d4ede04c01c1f31d4b7697fbd76cc336df700f3f38'
New-Item -ItemType Directory -Path $work -Force | Out-Null
function Get-VerifiedFile($Uri, $Path, $Hash) {
    if (-not (Test-Path -LiteralPath $Path)) { Invoke-WebRequest -Uri $Uri -OutFile $Path }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) {
        throw "OCR checksum mismatch: $(Split-Path $Path -Leaf)"
    }
}
Get-VerifiedFile "https://github.com/microsoft/vcpkg/archive/$vcpkgRevision.zip" (Join-Path $work 'vcpkg.zip') '4549eddfc6e44e43ee4111bb3709125608c9961c699793c133a33a5de38d5d5d'
Get-VerifiedFile 'https://github.com/tesseract-ocr/tesseract/archive/refs/tags/5.5.3.zip' (Join-Path $work 'tesseract.zip') '697d7bf55b53a6c90f5041ffa548f7085aee921da45342c42d57b7cbcb2fa16d'
Get-VerifiedFile "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/$modelRevision/ita.traineddata" (Join-Path $work 'ita.traineddata') $modelHash
$vcpkg = Join-Path $work "vcpkg-$vcpkgRevision"
$source = Join-Path $work 'tesseract-5.5.3'
if (-not (Test-Path -LiteralPath $vcpkg)) { Expand-Archive -LiteralPath (Join-Path $work 'vcpkg.zip') -DestinationPath $work }
if (-not (Test-Path -LiteralPath $source)) { Expand-Archive -LiteralPath (Join-Path $work 'tesseract.zip') -DestinationPath $work }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$visualStudio = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $visualStudio) { throw 'Visual Studio C++ Build Tools are required.' }
$cmake = Join-Path $visualStudio 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
if (-not (Test-Path -LiteralPath $cmake)) { throw 'Install the Visual Studio C++ CMake tools.' }
if (-not (Test-Path -LiteralPath (Join-Path $vcpkg 'vcpkg.exe'))) {
    & (Join-Path $vcpkg 'bootstrap-vcpkg.bat') -disableMetrics
    if ($LASTEXITCODE -ne 0) { throw 'vcpkg bootstrap failed.' }
}
& (Join-Path $vcpkg 'vcpkg.exe') install leptonica:x64-windows-static --disable-metrics
if ($LASTEXITCODE -ne 0) { throw 'OCR dependency build failed.' }
$build = Join-Path $work 'build'
$generator = if ((Split-Path (Split-Path $visualStudio -Parent) -Leaf) -eq '18') { 'Visual Studio 18 2026' } else { 'Visual Studio 17 2022' }
& $cmake -S $source -B $build -G $generator -A x64 "-DCMAKE_TOOLCHAIN_FILE=$vcpkg/scripts/buildsystems/vcpkg.cmake" -DVCPKG_TARGET_TRIPLET=x64-windows-static -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DBUILD_SHARED_LIBS=OFF -DBUILD_TRAINING_TOOLS=OFF -DBUILD_TESTS=OFF -DOPENMP_BUILD=OFF -DGRAPHICS_DISABLED=ON -DDISABLED_LEGACY_ENGINE=ON -DDISABLE_CURL=ON -DDISABLE_ARCHIVE=ON -DENABLE_NATIVE=OFF
if ($LASTEXITCODE -ne 0) { throw 'Tesseract configuration failed.' }
& $cmake --build $build --config Release --target tesseract --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'Tesseract build failed.' }
New-Item -ItemType Directory -Path (Join-Path $destination 'tessdata'), (Join-Path $destination 'licenses') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'bin/Release/tesseract.exe') -Destination $destination
Copy-Item -LiteralPath (Join-Path $work 'ita.traineddata') -Destination (Join-Path $destination 'tessdata/ita.traineddata')
Copy-Item -LiteralPath (Join-Path $source 'LICENSE') -Destination (Join-Path $destination 'licenses/tesseract.txt')
Invoke-WebRequest "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/$modelRevision/LICENSE" -OutFile (Join-Path $destination 'licenses/tessdata_best.txt')
Get-ChildItem -LiteralPath (Join-Path $vcpkg 'installed/x64-windows-static/share') -Directory | ForEach-Object {
    $copyright = Join-Path $_.FullName 'copyright'
    if (Test-Path -LiteralPath $copyright) { Copy-Item -LiteralPath $copyright -Destination (Join-Path $destination "licenses/$($_.Name).txt") }
}
$files = @{}
Get-ChildItem -LiteralPath $destination -Recurse -File | Where-Object Name -ne 'manifest.json' | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($destination, $_.FullName).Replace('\', '/')
    $files[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
@{ version = '5.5.3'; vcpkgRevision = $vcpkgRevision; modelRevision = $modelRevision; files = $files } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding utf8NoBOM
& node (Join-Path $PSScriptRoot 'verify-ocr-runtime.mjs')
if ($LASTEXITCODE -ne 0) { throw 'OCR runtime verification failed.' }
$expectedWork = [IO.Path]::GetFullPath((Join-Path $root '.scratch/ocr-build'))
if ([IO.Path]::GetFullPath($work) -ne $expectedWork -or (Split-Path $expectedWork -Parent) -ne (Join-Path $root '.scratch')) {
    throw 'OCR build cleanup must remain in the workspace scratch directory.'
}
Remove-Item -LiteralPath $expectedWork -Recurse -Force
Write-Output 'Verified Tesseract 5.5.3 and Italian tessdata_best prepared for bundling.'
