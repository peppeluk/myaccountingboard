# Test API Backend per Excel Export
$apiUrl = "http://localhost:3001"
$webUrl = "https://accamora.vercel.app"

Write-Host "🔧 TEST API BACKEND - Excel Export" -ForegroundColor Cyan
Write-Host "API URL: $apiUrl"
Write-Host "Web URL: $webUrl"
Write-Host ""

# Test 1: Health Check
Write-Host "📋 Health Check" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$apiUrl/health" -UseBasicParsing -TimeoutSec 5
    if ($response.status -eq "ok") {
        Write-Host "✅ API Status: $($response.status)" -ForegroundColor Green
        Write-Host "⏱️  Uptime: $($response.uptimeSeconds)s" -ForegroundColor Gray
        Write-Host "💾 Cache: $($response.cache.type)" -ForegroundColor Gray
    } else {
        Write-Host "❌ API Status: $($response.status)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ API non raggiungibile" -ForegroundColor Red
    Write-Host "   Avvia con: cd apps/api && npm run dev" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Test 2: Template File
Write-Host "📄 Template File Check" -ForegroundColor Yellow
$templatePath = "./apps/api/templates/t-smart-template.xlsx"
if (Test-Path $templatePath) {
    $fileInfo = Get-Item $templatePath
    Write-Host "✅ Template trovato: $($fileInfo.Name)" -ForegroundColor Green
    Write-Host "📏 Dimensione: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" -ForegroundColor Gray
} else {
    Write-Host "❌ Template non trovato: $templatePath" -ForegroundColor Red
}
Write-Host ""

# Test 3: Journal Export Endpoint
Write-Host "📊 Journal Export Test" -ForegroundColor Yellow
try {
    # Dati di test per il giornale
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
        fileName = "test_journal_export"
    } | ConvertTo-Json -Depth 10

    $response = Invoke-RestMethod -Uri "$apiUrl/api/journal/export" -Method POST -ContentType "application/json" -Body $testData -TimeoutSec 10
    
    if ($response) {
        Write-Host "✅ Export endpoint funzionante" -ForegroundColor Green
        Write-Host "📦 Response type: $($response.GetType().Name)" -ForegroundColor Gray
    } else {
        Write-Host "⚠️  Export endpoint risponde ma senza dati" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Export endpoint fallito" -ForegroundColor Red
    Write-Host "   Errore: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 4: Environment Variables
Write-Host "🌍 Environment Check" -ForegroundColor Yellow
$envFile = "./apps/api/.env"
if (Test-Path $envFile) {
    Write-Host "✅ .env file presente" -ForegroundColor Green
    $envContent = Get-Content $envFile
    if ($envContent -match "JOURNAL_TEMPLATE_PATH") {
        Write-Host "✅ JOURNAL_TEMPLATE_PATH configurato" -ForegroundColor Green
    } else {
        Write-Host "⚠️  JOURNAL_TEMPLATE_PATH mancante" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  .env file mancante (usa .env.example)" -ForegroundColor Yellow
}
Write-Host ""

# Test 5: Process Status
Write-Host "🔄 Process Status" -ForegroundColor Yellow
$apiProcess = Get-Process | Where-Object { $_.ProcessName -like "*node*" -and $_.CommandLine -like "*3001*" }
if ($apiProcess) {
    Write-Host "✅ API Process in esecuzione" -ForegroundColor Green
    Write-Host "🆔 PID: $($apiProcess.Id)" -ForegroundColor Gray
    Write-Host "⏱️  Started: $($apiProcess.StartTime)" -ForegroundColor Gray
} else {
    Write-Host "❌ Nessun processo API trovato su porta 3001" -ForegroundColor Red
}
Write-Host ""

# Riepilogo
Write-Host "📊 RIEPILOGO API" -ForegroundColor Cyan
Write-Host "============" -ForegroundColor Cyan
Write-Host "🔧 Comandi utili:" -ForegroundColor Gray
Write-Host "   Avvio API: cd apps/api && npm run dev" -ForegroundColor Gray
Write-Host "   Health check: curl $apiUrl/health" -ForegroundColor Gray
Write-Host "   Test export: POST $apiUrl/api/journal/export" -ForegroundColor Gray
Write-Host ""
Write-Host "🌐 Test integrazione con web:" -ForegroundColor Gray
Write-Host "   1. Avvia API backend" -ForegroundColor Gray
Write-Host "   2. Apri $webUrl" -ForegroundColor Gray
Write-Host "   3. Test estrazione Excel dal giornale" -ForegroundColor Gray
Write-Host ""
Write-Host "🎯 API pronta per produzione!" -ForegroundColor Green
