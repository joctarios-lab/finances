# Gera os PNGs do app da criança a partir do mesmo desenho do cofrinho.svg.
# PNG existe porque o iOS ignora SVG em apple-touch-icon e algumas lojas de
# atalho pedem bitmap. O SVG continua sendo a fonte da verdade: mexeu nele,
# rode este script de novo.
Add-Type -AssemblyName System.Drawing

function New-IconeDino {
  param([int]$Tam, [string]$Arquivo, [double]$Escala = 1.0)

  $bmp = New-Object System.Drawing.Bitmap($Tam, $Tam)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $k = $Tam / 512.0

  function Cor([string]$h) { [System.Drawing.ColorTranslator]::FromHtml($h) }
  function Pincel([string]$h) { New-Object System.Drawing.SolidBrush (Cor $h) }
  function Elipse($b, $cx, $cy, $rx, $ry) {
    $g.FillEllipse($b, (($cx - $rx) * $k), (($cy - $ry) * $k), ($rx * 2 * $k), ($ry * 2 * $k))
  }
  function Trio($b, $pontos) {
    $pts = @()
    foreach ($p in $pontos) { $pts += New-Object System.Drawing.PointF (($p[0] * $k), ($p[1] * $k)) }
    $g.FillPolygon($b, [System.Drawing.PointF[]]$pts)
  }

  # Fundo arredondado, azul claro do céu do app
  $raio = 114.0 * $k; $d = $raio * 2
  $fundo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $fundo.AddArc(0, 0, $d, $d, 180, 90)
  $fundo.AddArc(($Tam - $d), 0, $d, $d, 270, 90)
  $fundo.AddArc(($Tam - $d), ($Tam - $d), $d, $d, 0, 90)
  $fundo.AddArc(0, ($Tam - $d), $d, $d, 90, 90)
  $fundo.CloseFigure()
  $g.FillPath((Pincel '#eaf6ff'), $fundo)
  Elipse (Pincel '#d7edff') 256 268 196 196

  # Zona de segurança do maskable
  $g.TranslateTransform(($Tam / 2), ($Tam / 2))
  $g.ScaleTransform($Escala, $Escala)
  $g.TranslateTransform((-$Tam / 2), (-$Tam / 2))

  $verde = Pincel '#55d6a0'; $verde2 = Pincel '#3fc38c'; $verde3 = Pincel '#2fae7a'
  $barriga = Pincel '#eafff5'; $escuro = Pincel '#2d3436'

  # Cauda e pernas
  Trio $verde2 @(@(170, 350), @(78, 372), @(92, 318), @(168, 320))
  Elipse $verde2 222 393 22 33
  Elipse $verde2 288 393 22 33
  Elipse $verde3 222 426 33 15
  Elipse $verde3 288 426 33 15
  # Espinhos
  Trio $verde3 @(@(162, 288), @(110, 274), @(154, 244))
  Trio $verde3 @(@(154, 232), @(104, 198), @(152, 178))
  Trio $verde3 @(@(176, 166), @(144, 120), @(192, 124))
  # Corpo
  Elipse $verde 256 318 106 92
  Elipse $barriga 265 340 66 57
  Elipse $verde2 176 322 26 15
  Elipse $verde2 336 322 26 15
  # Cabeça
  Elipse $verde 254 212 101 88
  Elipse $barriga 254 252 57 44
  $rosa = Pincel '#ffb3e6'
  Elipse $rosa 184 250 19 19
  Elipse $rosa 324 250 19 19
  # Olhos felizes e sorriso
  $caneta = New-Object System.Drawing.Pen ((Cor '#2d3436'), (9.0 * $k))
  $caneta.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $caneta.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($caneta, (212 * $k), (186 * $k), (26 * $k), (24 * $k), 200, 140)
  $g.DrawArc($caneta, (270 * $k), (186 * $k), (26 * $k), (24 * $k), 200, 140)
  $g.FillPie($escuro, (218 * $k), (200 * $k), (74 * $k), (60 * $k), 0, 180)
  $g.FillPie((Pincel '#ff7675'), (240 * $k), (240 * $k), (35 * $k), (32 * $k), 0, 180)
  # A moeda
  Elipse (Pincel '#e1a83e') 372 352 46 46
  Elipse (Pincel '#ffeaa7') 372 352 36 36
  $fonte = New-Object System.Drawing.Font ('Segoe UI', (30.0 * $k), [System.Drawing.FontStyle]::Bold)
  $centro = New-Object System.Drawing.StringFormat
  $centro.Alignment = [System.Drawing.StringAlignment]::Center
  $centro.LineAlignment = [System.Drawing.StringAlignment]::Center
  $caixa = New-Object System.Drawing.RectangleF ((336 * $k), (316 * $k), (72 * $k), (72 * $k))
  $g.DrawString('R$', $fonte, (Pincel '#b8860b'), $caixa, $centro)

  $g.Dispose()
  $bmp.Save($Arquivo, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "gerado: $Arquivo"
}

$base = $PSScriptRoot
New-IconeDino 192 "$base\cofrinho-192.png" 1.0
New-IconeDino 180 "$base\cofrinho-180.png" 1.0
New-IconeDino 512 "$base\cofrinho-512.png" 1.0
New-IconeDino 512 "$base\cofrinho-mask.png" 0.70
