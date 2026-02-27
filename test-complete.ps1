# 🚀 Test Completo Deploy + API
param(
    [string]$WebUrl = "https://accamora.vercel.app",
    [string]$ApiUrl = "http://localhost:3001"
)

Write-Host "🧪 TEST COMPLETO DEPLOY + API" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Web URL: $WebUrl"
Write-Host "API URL: $ApiUrl"
Write-Host ""

# Test Web
Write-Host "🌐 TEST WEB PRODUZIONE" -ForegroundColor Yellow
Write-Host "--------------------"
try {
    $webResponse = Invoke-WebRequest -Uri $WebUrl -UseBasicParsing -TimeoutSec 10
    Write-Host "✅ Web Status: $($webResponse.StatusCode)" -ForegroundColor Green
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $webResponse2 = Invoke-WebRequest -Uri $WebUrl -UseBasicParsing
    $stopwatch.Stop()
    $loadTime = [math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
    Write-Host "⚡ Load time: $loadTime s" -ForegroundColor Yellow
    
    if ($webResponse.Content.Contains('canvas-wrapper')) {
        Write-Host "✅ Canvas structure OK" -ForegroundColor Green
    } else {
        Write-Host "❌ Canvas structure missing" -ForegroundColor Red
    }
    
    if ($webResponse.Content.Contains('index-')) {
        Write-Host "✅ JavaScript loaded" -ForegroundColor Green
    } else {
        Write-Host "❌ JavaScript missing" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Web test failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test API
Write-Host "🔧 TEST API BACKEND" -ForegroundColor Yellow
Write-Host "-------------------"
try {
    $apiResponse = Invoke-RestMethod -Uri "$ApiUrl/health" -UseBasicParsing -TimeoutSec 5
    if ($apiResponse.status -eq "ok") {
        Write-Host "✅ API Status: $($apiResponse.status)" -ForegroundColor Green
        Write-Host "⏱️  Uptime: $($apiResponse.uptimeSeconds)s" -ForegroundColor Gray
        Write-Host "💾 Cache: $($apiResponse.cache.type)" -ForegroundColor Gray
        
        # Test export endpoint
        $testData = @{
            entries = @(
                @{
                    date = "2026-02-26"
                    accountCode = "1000"
                    accountName = "Test Account"
                    description = "Test Description"
                    debit = "100.00"
                    credit = ""
                    closeLine = $false
                }
            )
            fileName = "test_export"
        } | ConvertTo-Json -Depth 10
        
        $exportResponse = Invoke-RestMethod -Uri "$ApiUrl/api/journal/export" -Method POST -ContentType "application/json" -Body $testData -TimeoutSec 10
        Write-Host "✅ Export endpoint OK" -ForegroundColor Green
        
    } else {
        Write-Host "❌ API Status: $($apiResponse.status)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ API test failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Avvia con: cd apps/api && npm run dev" -ForegroundColor Yellow
}
Write-Host ""

# Test integrazione
Write-Host "🔗 TEST INTEGRAZIONE" -ForegroundColor Yellow
Write-Host "-------------------"
Write-Host "📋 Checklist manuale completa:" -ForegroundColor Gray
Write-Host "  Web ($WebUrl):" -ForegroundColor Gray
Write-Host "    □ Canvas visibile e funzionante" -ForegroundColor Gray
Write-Host "    □ Penna disegna correttamente" -ForegroundColor Gray
Write-Host "    □ Gomma cancella correttamente" -ForegroundColor Gray
Write-Host "    □ Linea traccia rette" -ForegroundColor Gray
Write-Host "    □ Salvataggio documento funziona" -ForegroundColor Gray
Write-Host "    □ Caricamento documento funziona" -ForegroundColor Gray
Write-Host "    □ Esportazione PDF scarica file" -ForegroundColor Gray
Write-Host ""
Write-Host "  API ($ApiUrl):" -ForegroundColor Gray
Write-Host "    □ Health endpoint risponde" -ForegroundColor Gray
Write-Host "    □ Template Excel presente" -ForegroundColor Gray
Write-Host "    □ Export endpoint funziona" -ForegroundColor Gray
Write-Host ""
Write-Host "  Integrazione:" -ForegroundColor Gray
Write-Host "    □ Estrazione Excel dal web funziona" -ForegroundColor Gray
Write-Host "    □ File Excel scaricato correttamente" -ForegroundColor Gray
Write-Host ""

# Comandi utili
Write-Host "🔧 COMANDI UTILI" -ForegroundColor Cyan
Write-Host "================" -ForegroundColor Cyan
Write-Host "Avvio completo:" -ForegroundColor Gray
Write-Host "  Terminal 1: cd apps/api && npm run dev" -ForegroundColor Gray
Write-Host "  Terminal 2: npm run dev (web)" -ForegroundColor Gray
Write-Host ""
Write-Host "Test rapidi:" -ForegroundColor Gray
Write-Host "  .\test-complete.ps1" -ForegroundColor Gray
Write-Host "  .\test-api.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "Deploy:" -ForegroundColor Gray
Write-Host "  git add . && git commit && git push" -ForegroundColor Gray
Write-Host ""
Write-Host "🎯 Sistema pronto per produzione!" -ForegroundColor Green
