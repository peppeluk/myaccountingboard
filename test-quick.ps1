# Test rapido produzione
$url = "https://accamora.vercel.app/"

Write-Host "🧪 TEST RAPIDO PRODUZIONE" -ForegroundColor Cyan
Write-Host "URL: $url"
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    
    # Test performance
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $response2 = Invoke-WebRequest -Uri $url -UseBasicParsing
    $stopwatch.Stop()
    $loadTime = [math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
    Write-Host "⚡ Load time: $loadTime s" -ForegroundColor Yellow
    
    # Test canvas
    if ($response.Content -match "canvas-wrapper") {
        Write-Host "✅ Canvas structure found" -ForegroundColor Green
    } else {
        Write-Host "❌ Canvas structure missing" -ForegroundColor Red
    }
    
    # Test JavaScript
    if ($response.Content -match "index-.*\.js") {
        Write-Host "✅ JavaScript loaded" -ForegroundColor Green
    } else {
        Write-Host "❌ JavaScript missing" -ForegroundColor Red
    }
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "📋 Manual tests to run in browser:" -ForegroundColor Cyan
Write-Host "  □ Pen drawing"
Write-Host "  □ Eraser tool"
Write-Host "  □ Line tool"
Write-Host "  □ Save/Load document"
Write-Host "  □ PDF export"
Write-Host "  □ Excel export (if API available)"
