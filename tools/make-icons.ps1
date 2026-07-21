# Regenerates icons/icon{16,32,48,128}.png — a red heart on a dark rounded square.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function New-HeartPath([single]$s) {
    # Heart drawn on a 0..100 grid, then scaled to the icon size.
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $k = $s / 100.0
    function P([single]$x, [single]$y) { New-Object System.Drawing.PointF(($x * $k), ($y * $k)) }
    $p.AddBezier((P 50 86), (P 26 68), (P 8 52), (P 8 34))
    $p.AddBezier((P 8 34), (P 8 19), (P 19 9), (P 32 9))
    $p.AddBezier((P 32 9), (P 41 9), (P 47 14), (P 50 21))
    $p.AddBezier((P 50 21), (P 53 14), (P 59 9), (P 68 9))
    $p.AddBezier((P 68 9), (P 81 9), (P 92 19), (P 92 34))
    $p.AddBezier((P 92 34), (P 92 52), (P 74 68), (P 50 86))
    $p.CloseFigure()
    return $p
}

function New-RoundedRect([single]$size, [single]$radius) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $p.AddArc(0, 0, $d, $d, 180, 90)
    $p.AddArc(($size - $d), 0, $d, $d, 270, 90)
    $p.AddArc(($size - $d), ($size - $d), $d, $d, 0, 90)
    $p.AddArc(0, ($size - $d), $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

foreach ($size in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $bg = New-RoundedRect $size ([Math]::Max(2, $size * 0.22))
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 24, 28, 36))
    $g.FillPath($bgBrush, $bg)

    # Heart inset inside the tile.
    $inset = $size * 0.17
    $heartSize = $size - ($inset * 2)
    $heart = New-HeartPath $heartSize
    $tx = New-Object System.Drawing.Drawing2D.Matrix
    $tx.Translate($inset, ($inset * 1.05))
    $heart.Transform($tx)

    $heartBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 225, 29, 72))
    $g.FillPath($heartBrush, $heart)

    $path = Join-Path $outDir ("icon{0}.png" -f $size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

    $bgBrush.Dispose(); $heartBrush.Dispose(); $bg.Dispose(); $heart.Dispose(); $tx.Dispose()
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("wrote {0}" -f $path)
}
