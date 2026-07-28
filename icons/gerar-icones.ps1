Add-Type -AssemblyName System.Drawing

function New-Icone {
  param([int]$Tam, [string]$Arquivo, [double]$Escala = 1.0)

  $bmp = New-Object System.Drawing.Bitmap($Tam, $Tam)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $k = $Tam / 512.0

  # Fundo arredondado com gradiente azul -> roxo (paleta Metronic)
  $raio = 114.0 * $k
  $d = $raio * 2
  $fundo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $fundo.AddArc(0, 0, $d, $d, 180, 90)
  $fundo.AddArc(($Tam - $d), 0, $d, $d, 270, 90)
  $fundo.AddArc(($Tam - $d), ($Tam - $d), $d, $d, 0, 90)
  $fundo.AddArc(0, ($Tam - $d), $d, $d, 90, 90)
  $fundo.CloseFigure()

  $p1 = New-Object System.Drawing.PointF(0, 0)
  $p2 = New-Object System.Drawing.PointF($Tam, $Tam)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $p1, $p2,
    [System.Drawing.ColorTranslator]::FromHtml('#0095e8'),
    [System.Drawing.ColorTranslator]::FromHtml('#7239ea'))
  $g.FillPath($grad, $fundo)

  # Zona de seguranca para o icone maskable
  $g.TranslateTransform(($Tam / 2), ($Tam / 2))
  $g.ScaleTransform($Escala, $Escala)
  $g.TranslateTransform((-$Tam / 2), (-$Tam / 2))

  # Telhado: o lar que abriga
  $branco = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $caneta = New-Object System.Drawing.Pen($branco, (42.0 * $k))
  $caneta.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $caneta.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $caneta.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts = @(
    (New-Object System.Drawing.PointF((104.0 * $k), (208.0 * $k))),
    (New-Object System.Drawing.PointF((256.0 * $k), (100.0 * $k))),
    (New-Object System.Drawing.PointF((408.0 * $k), (208.0 * $k)))
  )
  $g.DrawLines($caneta, [System.Drawing.PointF[]]$pts)

  # Colunas crescentes: o patrimonio acumulando mes a mes
  $barras = @(
    @{ x = 119.0; y = 316.0; h = 94.0;  a = 153 },
    @{ x = 222.0; y = 286.0; h = 124.0; a = 204 },
    @{ x = 325.0; y = 252.0; h = 158.0; a = 255 }
  )
  foreach ($b in $barras) {
    $x = $b.x * $k; $y = $b.y * $k; $w = 68.0 * $k; $h = $b.h * $k
    $pincel = New-Object System.Drawing.SolidBrush(
      [System.Drawing.Color]::FromArgb($b.a, 255, 255, 255))
    $forma = New-Object System.Drawing.Drawing2D.GraphicsPath
    $forma.AddArc($x, $y, $w, $w, 180, 180)
    $forma.AddArc($x, ($y + $h - $w), $w, $w, 0, 180)
    $forma.CloseFigure()
    $g.FillPath($pincel, $forma)
  }

  $g.Dispose()
  $bmp.Save($Arquivo, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "gerado: $Arquivo"
}

$base = 'D:\Projetos\meus-projetos\financas\icons'
New-Icone 192 "$base\icon-192.png" 1.0
New-Icone 512 "$base\icon-512.png" 1.0
New-Icone 512 "$base\icon-maskable.png" 0.70
