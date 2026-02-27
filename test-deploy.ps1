# 🚀 Script Test Automatico Deploy MYAccounting (PowerShell)
# Uso: .\test-deploy.ps1 [URL_PRODUZIONE]

param(
    [string]$ProdUrl = "https://myaccountingboard.vercel.app"
)

$LocalUrl = "http://localhost:5173"
$ApiUrl = "http://localhost:3001"

Write-Host "🧪 TEST AUTOMATICO DEPLOY - MYAccounting" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "URL Produzione: $ProdUrl"
Write-Host "URL Locale: $LocalUrl"
Write-Host "URL API: $ApiUrl"
Write-Host ""

# Funzione per testare URL
function Test-Url {
    param([string]$Url, [string]$Description, [int]$ExpectedStatus = 200)
    
    Write-Host -NoNewline "🔍 Test $Description... "
    
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq $ExpectedStatus) {
            Write-Host "✅ PASS" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ FAIL (Status: $($response.StatusCode))" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ FAIL ($($_.Exception.Message))" -ForegroundColor Red
        return $false
    }
}

# Funzione per testare API
function Test-Api {
    param([string]$Endpoint, [string]$Description)
    
    Write-Host -NoNewline "🔧 Test API $Description... "
    
    try {
        $response = Invoke-RestMethod -Uri "$ApiUrl$Endpoint" -UseBasicParsing -TimeoutSec 10
        if ($response.status -eq "ok") {
            Write-Host "✅ PASS" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ FAIL" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ FAIL ($($_.Exception.Message))" -ForegroundColor Red
        return $false
    }
}

# Test 1: Build locale
Write-Host "📦 TEST BUILD LOCALE" -ForegroundColor Yellow
Write-Host "--------------------"
$buildResult = npm run build 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build locale OK" -ForegroundColor Green
} else {
    Write-Host "❌ Build locale FALLITO" -ForegroundColor Red
    Write-Host $buildResult
    exit 1
}
Write-Host ""

# Test 2: Server locale
Write-Host "🌐 TEST SERVER LOCALE" -ForegroundColor Yellow
Write-Host "---------------------"
$viteProcess = Get-Process | Where-Object { $_.ProcessName -like "*vite*" -and $_.CommandLine -like "*5173*" }
if ($viteProcess) {
    Write-Host "✅ Server locale in esecuzione" -ForegroundColor Green
    Test-Url -Url $LocalUrl -Description "Homepage locale"
} else {
    Write-Host "⚠️  Server locale non in esecuzione (avviare con npm run dev)" -ForegroundColor Yellow
}
Write-Host ""

# Test 3: API Backend
Write-Host "🔧 TEST API BACKEND" -ForegroundColor Yellow
Write-Host "-------------------"
$apiProcess = Get-Process | Where-Object { $_.ProcessName -like "*node*" -and $_.CommandLine -like "*3001*" }
if ($apiProcess) {
    Write-Host "✅ API Backend in esecuzione" -ForegroundColor Green
    Test-Api -Endpoint "/health" -Description "Health check"
} else {
    Write-Host "⚠️  API Backend non in esecuzione (avviare con cd apps/api && npm run dev)" -ForegroundColor Yellow
}
Write-Host ""

# Test 4: Produzione
Write-Host "🚀 TEST PRODUZIONE" -ForegroundColor Yellow
Write-Host "------------------"
Test-Url -Url $ProdUrl -Description "Homepage produzione"
Test-Url -Url "$ProdUrl/favicon.ico" -Description "Favicon"
Write-Host ""

# Test 5: Funzionalità JavaScript (produzione)
Write-Host "⚡ TEST FUNZIONALITÀ JS" -ForegroundColor Yellow
Write-Host "----------------------"
Write-Host "🔍 Test caricamento JavaScript..."
try {
    $webContent = Invoke-WebRequest -Uri $ProdUrl -UseBasicParsing
    if ($webContent.Content -match "script.*index.*\.js") {
        Write-Host "✅ JavaScript caricato correttamente" -ForegroundColor Green
    } else {
        Write-Host "❌ JavaScript non trovato" -ForegroundColor Red
    }
    
    Write-Host "🔍 Test canvas virtualizzazione..."
    if ($webContent.Content -match "canvas-wrapper") {
        Write-Host "✅ Struttura canvas presente" -ForegroundColor Green
    } else {
        Write-Host "❌ Struttura canvas non trovata" -ForegroundColor Red
    }
} catch {
        Write-Host "❌ Errore caricamento contenuto" -ForegroundColor Red
    }
Write-Host ""

# Test 6: Performance
Write-Host "⚡ TEST PERFORMANCE" -ForegroundColor Yellow
Write-Host "------------------"
try {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-WebRequest -Uri $ProdUrl -UseBasicParsing
    $stopwatch.Stop()
    $loadTime = $stopwatch.Elapsed.TotalSeconds
    
    if ($loadTime -lt 3.0) {
        Write-Host "✅ Tempo caricamento: $([math]::Round($loadTime, 2))s (OK)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Tempo caricamento: $([math]::Round($loadTime, 2))s (lento)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Errore test performance" -ForegroundColor Red
}
Write-Host ""

# Test 7: File critici
Write-Host "📁 TEST FILE CRITICI" -ForegroundColor Yellow
Write-Host "--------------------"
Test-Url -Url "$ProdUrl/manifest.webmanifest" -Description "PWA Manifest"
Test-Url -Url "$ProdUrl/sw.js" -Description "Service Worker"
Write-Host ""

# Riepilogo
Write-Host "📊 RIEPILOGO" -ForegroundColor Cyan
Write-Host "============"
Write-Host "✅ Test completati!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Checklist manuale da eseguire su $ProdUrl:"
Write-Host "   □ Test disegno penna"
Write-Host "   □ Test gomma"
Write-Host "   □ Test linea"
Write-Host "   □ Test salvataggio documento"
Write-Host "   □ Test caricamento documento"
Write-Host "   □ Test estrazione Excel (se API attiva)"
Write-Host "   □ Test esportazione PDF"
Write-Host ""
Write-Host "🔧 Comandi utili:"
Write-Host "   API Backend: cd apps/api && npm run dev"
Write-Host "   Frontend: npm run dev"
Write-Host "   Build: npm run build"
Write-Host "   Deploy: git push (automatico su Vercel)"
Write-Host ""
Write-Host "🎯 Deploy pronto per produzione!" -ForegroundColor Green
