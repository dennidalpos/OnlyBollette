param([Parameter(Mandatory)][string]$OutputPath, [switch]$ComponentBlocks, [switch]$MissingEnergyUnit, [switch]$ValidityRange)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(1800, 2100)
$bitmap.SetResolution(96, 96)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$font = [System.Drawing.Font]::new('Arial', 24)
$smallFont = [System.Drawing.Font]::new('Arial', 17)
try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $rows = @(
        @(50, 50, 'Condizioni contrattuali'),
        @(50, 100, 'Recesso con preavviso'),
        @(50, 150, 'di trenta giorni.'),
        @(1000, 50, 'Informazioni generali'),
        @(1000, 100, 'Importo da pagare 99 euro'),
        @(1000, 150, 'Totale storico 800 euro'),
        @(50, 300, 'Componente energia'),
        @(650, 300, '0,12 euro/kWh'),
        @(1000, 300, 'Informazioni estranee'),
        @(50, 440, 'Dati della fornitura'),
        @(1000, 440, 'Informazioni generali'),
        @(50, 490, 'Tipologia cliente'),
        @(560, 490, 'Domestico non residente'),
        @(1000, 490, 'Cliente domestico residente'),
        @(50, 540, 'Potenza impegnata'),
        @(560, 540, '4,5 kW'),
        @(1000, 540, 'Tariffa bioraria'),
        @(50, 590, 'Tipologia tariffa'),
        @(560, 590, 'Monoraria'),
        @(50, 740, 'Consumi'),
        @(50, 790, 'Consumo annuo'),
        @(50, 840, 'dal 01/01/2025 al 31/12/2025'),
        @(50, 890, '3.120 kWh'),
        @(50, 990, 'Consumo fatturato 250 kWh'),
        @(50, 1100, 'Dettaglio componenti vendita'),
        @(50, 1160, 'Voce'), @(450, 1160, 'Periodo'), @(850, 1160, 'Unità'), @(1050, 1160, 'Prezzo unitario'), @(1450, 1160, 'Importo'),
        @(50, 1220, 'Componente energia'), @(450, 1220, '01/01/2026 - 31/01/2026'), @(850, 1220, 'euro/kWh'), @(1050, 1220, '1,123456'), @(1450, 1220, '112,35'),
        @(50, 1280, 'Quota fissa vendita'), @(450, 1280, '01/01/2026 - 31/01/2026'), @(850, 1280, 'euro/mese'), @(1050, 1280, '10'), @(1450, 1280, '10'),
        @(50, 1340, 'Dispacciamento'), @(450, 1340, '01/01/2026 - 31/01/2026'), @(850, 1340, 'euro/kWh'), @(1050, 1340, '0,015'), @(1450, 1340, '1,50'),
        @(50, 1400, 'DISPbt'), @(450, 1400, '01/01/2026 - 31/01/2026'), @(850, 1400, 'euro/anno'), @(1050, 1400, '6'), @(1450, 1400, '0,50'),
        @(50, 1490, 'Prezzo energia: perdite escluse; perdite di rete 10%'),
        @(50, 1560, 'Spesa annua sostenuta 999 euro'),
        @(50, 1640, 'Scadenza delle condizioni economiche'),
        @(50, 1690, '31/12/2025'),
        @(50, 1740, 'Le condizioni continueranno ad applicarsi'),
        @(50, 1790, 'fino alla comunicazione di nuove condizioni.'),
        @(50, 1900, 'Condizioni economiche applicabili dal 01/01/2026 al 31/12/2099'),
        @(50, 2000, 'Prezzo fisso')
    )
    if ($ValidityRange) {
        $rows = @($rows | Where-Object { $_[1] -ne 1640 -and $_[1] -ne 1690 -and $_[1] -ne 1900 })
        $rows += ,@(50, 1640, 'Validità condizioni economiche: dal 01/01/2025 al 31/12/2025')
    }
    if ($ComponentBlocks) {
        $rows = @()
        $components = @(
            @('Commercializzazione e vendita - parte fissa', 'euro/pdp/mese', '9,12345678', '2'),
            @('Componente di dispacciamento (parte fissa)', 'euro/pdp/mese', '0,23456789', '2'),
            @('Corrispettivo Energia', 'euro/kWh', '0,14567890', '200'),
            @('Perdite su Corrispettivo Energia', 'euro/kWh', '0,14567890', '19'),
            @('Dispacciamento', 'euro/kWh', '0,02345678', '200'),
            @('Quota energia', 'euro/kWh', '0,00987654', '200')
        )
        for ($index = 0; $index -lt $components.Count; $index++) {
            $component = $components[$index]
            $y = 50 + $index * 260
            $rows += @(@(50, $y, $component[0]), @(850, $y, 'tipo prezzo'), @(1150, $y, 'prezzo'), @(1450, $y, 'quantità'), @(1650, $y, 'euro'))
            $periods = @('DAL 01/05/2026 AL 31/05/2026', 'DAL 01/06/2026 AL 30/06/2026')
            for ($offset = 0; $offset -lt $periods.Count; $offset++) {
                $lineY = $y + 60 + $offset * 60
                $rows += @(@(50, $lineY, $periods[$offset]), @(850, $lineY, $component[1]), @(1150, $lineY, $component[2]), @(1450, $lineY, $component[3]), @(1650, $lineY, '29,14'))
            }
        }
    }
    foreach ($row in $rows) {
        $compactUnit = $ComponentBlocks -and $row[0] -eq 850 -and $row[1] -eq 630
        if ($compactUnit -and $MissingEnergyUnit) { continue }
        $drawFont = if ($compactUnit) { $smallFont } else { $font }
        $x = if ($compactUnit) { $row[0] + 30 } else { $row[0] }
        $graphics.DrawString($row[2], $drawFont, [System.Drawing.Brushes]::Black, [float]$x, [float]$row[1])
    }
    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $font.Dispose()
    $smallFont.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
