param(
  [string]$Source = "$PSScriptRoot\..\assets\logo.png",
  [string]$OutDir = "$PSScriptRoot\..\build"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) {
  throw "Source not found: $Source. Pass an explicit -Source <path> to a PNG, e.g. .\scripts\make-icons.ps1 -Source C:\path\to\logo.png"
}
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$iconsDir = Join-Path $OutDir "icons"
if (-not (Test-Path $iconsDir)) { New-Item -ItemType Directory -Path $iconsDir | Out-Null }

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))

function Save-Png([System.Drawing.Image]$img, [int]$size, [string]$outFile) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode  = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($img, 0, 0, $size, $size)
  $g.Dispose()
  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# Multi-size PNGs
$sizes = 16, 24, 32, 48, 64, 128, 256, 512
foreach ($s in $sizes) {
  $f = Join-Path $iconsDir ("{0}x{0}.png" -f $s)
  Save-Png $src $s $f
  Write-Host "wrote $f"
}

# Main 512x512 icon for builder (linux/mac png) and BrowserWindow runtime
$mainPng = Join-Path $OutDir "icon.png"
Save-Png $src 512 $mainPng
Write-Host "wrote $mainPng"

# Tray icon (32x32 png — works on all OS via nativeImage)
$trayPng = Join-Path $OutDir "tray.png"
Save-Png $src 32 $trayPng
Write-Host "wrote $trayPng"

# Build a multi-resolution .ico file manually.
# ICO format: 6-byte header + (16-byte ICONDIRENTRY) per image + raw PNG data.
$icoSizes = 16, 24, 32, 48, 64, 128, 256
$pngBytes = @()
foreach ($s in $icoSizes) {
  $tmp = Join-Path $iconsDir ("{0}x{0}.png" -f $s)
  $pngBytes += ,([System.IO.File]::ReadAllBytes($tmp))
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
# ICONDIR
$bw.Write([UInt16]0)              # reserved
$bw.Write([UInt16]1)              # type: 1 = icon
$bw.Write([UInt16]$icoSizes.Count) # count

$offset = 6 + (16 * $icoSizes.Count)
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
  $s = $icoSizes[$i]
  $len = $pngBytes[$i].Length
  $w = if ($s -ge 256) { 0 } else { $s }
  $h = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$w)        # width
  $bw.Write([byte]$h)        # height
  $bw.Write([byte]0)         # palette
  $bw.Write([byte]0)         # reserved
  $bw.Write([UInt16]1)       # planes
  $bw.Write([UInt16]32)      # bits per pixel
  $bw.Write([UInt32]$len)    # bytes in resource
  $bw.Write([UInt32]$offset) # offset
  $offset += $len
}
foreach ($b in $pngBytes) { $bw.Write($b) }
$bw.Flush()
$ico = Join-Path $OutDir "icon.ico"
[System.IO.File]::WriteAllBytes($ico, $ms.ToArray())
$bw.Close()
$ms.Close()
Write-Host "wrote $ico"

# .icns (macOS) — keep it simple: write the 512 png as icon.icns is not
# trivially producible without iconutil/macOS. electron-builder accepts a
# .png as mac.icon as a fallback, so we just copy the 512 PNG to icon.icns
# location is wrong; instead leave mac to consume icon.png directly via
# package.json "build.mac.icon": "build/icon.png" (electron-builder 24
# supports png input on mac and converts on a mac CI runner).
# To keep things lightweight on Windows-only dev, we skip generating
# .icns here. The mac CI job (release.yml) will run on macos-latest and
# electron-builder will derive the .icns from icon.png automatically.

$src.Dispose()
Write-Host "done."
