# Gera os PNGs do ícone do DOMI a partir da mesma geometria do icons/icon.svg.
#
# Usa System.Drawing (vem com o Windows) porque o repositório não tem — e não
# deve ter — dependência de build. Rode com:  powershell -File icons/gerar-icones.ps1
Add-Type -AssemblyName System.Drawing

$COBALTO = '#2A52C9'
$BRANCO  = '#FFFFFF'

function New-Icone {
  param([int]$Tam, [string]$Arquivo, [double]$Escala = 1.0)

  $bmp = New-Object System.Drawing.Bitmap($Tam, $Tam)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $k = $Tam / 512.0

  # --- fundo: quadrado de cantos arredondados, cor chapada ---
  $raio = 128.0 * $k
  $d = $raio * 2
  $fundo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $fundo.AddArc(0, 0, $d, $d, 180, 90)
  $fundo.AddArc(($Tam - $d), 0, $d, $d, 270, 90)
  $fundo.AddArc(($Tam - $d), ($Tam - $d), $d, $d, 0, 90)
  $fundo.AddArc(0, ($Tam - $d), $d, $d, 90, 90)
  $fundo.CloseFigure()
  $brushFundo = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($COBALTO))
  $g.FillPath($brushFundo, $fundo)

  # A zona de segurança do ícone maskable: o desenho encolhe para o recorte
  # circular de alguns lançadores não comer o arco.
  $g.TranslateTransform(($Tam / 2), ($Tam / 2))
  $g.ScaleTransform($Escala, $Escala)
  $g.TranslateTransform((-$Tam / 2), (-$Tam / 2))

  $branco = [System.Drawing.ColorTranslator]::FromHtml($BRANCO)

  # --- a cúpula: arco de 180° com pontas arredondadas ---
  # Centro (256, 344) e raio 132, como no SVG. O retângulo do AddArc é o
  # quadrado que circunscreve esse círculo.
  $cx = 256.0 * $k; $cy = 344.0 * $k; $r = 132.0 * $k
  $pen = New-Object System.Drawing.Pen($branco, (46.0 * $k))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($pen, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2), 180, 180)

  # --- a base: pílula ---
  $bx = 112.0 * $k; $by = 372.0 * $k; $bw = 288.0 * $k; $bh = 46.0 * $k
  $br = $bh / 2
  $base = New-Object System.Drawing.Drawing2D.GraphicsPath
  $base.AddArc($bx, $by, ($br * 2), $bh, 90, 180)
  $base.AddArc(($bx + $bw - $br * 2), $by, ($br * 2), $bh, 270, 180)
  $base.CloseFigure()
  $brushBase = New-Object System.Drawing.SolidBrush($branco)
  $g.FillPath($brushBase, $base)

  $g.Dispose()
  $destino = Join-Path $PSScriptRoot $Arquivo
  $bmp.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "gerado: $Arquivo ($Tam px)"
}

New-Icone -Tam 192 -Arquivo 'icon-192.png'
New-Icone -Tam 512 -Arquivo 'icon-512.png'
# Maskable: 80% do quadro, para sobreviver ao recorte circular do Android
New-Icone -Tam 512 -Arquivo 'icon-maskable.png' -Escala 0.8
