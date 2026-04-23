# ══════════════════════════════════════════════════════════════
#  AI Image Studio — 비상 종료 / 청소 스크립트
#  start.ps1 이 비정상 종료됐거나 포트가 잡혀있을 때 수동 실행
# ══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "🧹 AI Image Studio 비상 정리" -ForegroundColor Yellow
Write-Host ""

# 1) 포트 기반 정리 — 8001 (backend), 3000 (frontend)
function Kill-PortOwner([int]$port, [string]$label) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
              Select-Object -ExpandProperty OwningProcess -Unique
    if (-not $owners) {
        Write-Host ("  · :{0} ({1}) — 사용 중 아님" -f $port, $label) -ForegroundColor DarkGray
        return
    }
    foreach ($targetPid in $owners) {
        $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        $name = if ($p) { $p.ProcessName } else { "?" }
        Write-Host ("  · :{0} ({1}) 점유 PID {2} ({3}) 종료" -f $port, $label, $targetPid, $name)
        & taskkill.exe /PID $targetPid /T /F 2>$null | Out-Null
    }
}

Kill-PortOwner 3000 "Frontend"
Kill-PortOwner 8001 "Backend"

# 2) ComfyUI 전수 검색 후 종료 (경로 기반 — 다른 python/electron 보호)
Write-Host ""
Write-Host "ComfyUI 프로세스 검색..."
$found = 0
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.ExecutablePath -and $_.ExecutablePath -like "*ComfyUI*") {
        Write-Host ("  · PID {0} ({1}) 종료" -f $_.ProcessId, (Split-Path $_.ExecutablePath -Leaf))
        & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null
        $found++
    }
}
if ($found -eq 0) { Write-Host "  · 없음" -ForegroundColor DarkGray }

# 3) Ollama — 옵션 (기본은 유지)
Write-Host ""
$ans = Read-Host "Ollama 도 종료할까요? (y/N)"
if ($ans -eq "y" -or $ans -eq "Y") {
    Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("  · Ollama PID {0} 종료" -f $_.Id)
        & taskkill.exe /PID $_.Id /T /F 2>$null | Out-Null
    }
}

Write-Host ""
Write-Host "✅ 정리 완료" -ForegroundColor Green
Write-Host ""
