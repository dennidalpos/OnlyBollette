param([string]$SnapshotDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'test-results'))
$ErrorActionPreference = 'Stop'
$checked = 0
foreach ($category in @('luce','gas')) {
    $snapshot = Get-Content -LiteralPath (Join-Path $SnapshotDirectory "$category-snapshot.json") -Raw | ConvertFrom-Json
    $offers = @($snapshot.offers | Where-Object sourceUrl -match '\.xml$')
    if ($offers.Count -lt 20) { throw "Expected at least 20 live offers for $category" }
    $sourceUrl = $offers[0].sourceUrl
    [xml]$feed = (Invoke-WebRequest -Uri $sourceUrl -TimeoutSec 90).Content
    $lookup = @{}
    foreach ($raw in $feed.ListaOfferteMercatoLibero.offerta) { $lookup[[string]$raw.IdentificativiOfferta.COD_OFFERTA] = $raw }
    foreach ($offer in ($offers | Select-Object -First 20)) {
        $raw = $lookup[$offer.id]
        if (!$raw) { throw "Missing source record: $($offer.id)" }
        if ($raw.DettaglioOfferta.TIPO_CLIENTE -ne '01') { throw "Non-domestic record: $($offer.id)" }
        if ([string]$raw.DettaglioOfferta.NOME_OFFERTA -cne $offer.name) { throw "Name mismatch: $($offer.id)" }
        $expectedPrices = @($raw.ComponenteImpresa | ForEach-Object { $_.IntervalloPrezzi } | ForEach-Object {
            [double]::Parse(([string]$_.PREZZO).Replace(',','.'), [Globalization.CultureInfo]::InvariantCulture)
        })
        $actualPrices = @($offer.components | ForEach-Object { [double]$_.amount })
        if ($expectedPrices.Count -ne $actualPrices.Count) { throw "Component count mismatch: $($offer.id)" }
        for ($i=0; $i -lt $actualPrices.Count; $i++) {
            if ([Math]::Abs($expectedPrices[$i]-$actualPrices[$i]) -gt 0.0000001) { throw "Price mismatch: $($offer.id)" }
        }
        if ($null -ne $offer.firstYearCost) { throw "Unsupported full annual estimate: $($offer.id)" }
        $checked++
    }
}
Write-Output "PASS: $checked energy offers independently matched to official XML (names, domestic eligibility, every price component)."
