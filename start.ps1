# ==============================================================
#  AI Image Studio - 빠른 시작 / 자연 종료 스크립트
#  - Ollama (없으면 시작) -> Backend(8001) -> Frontend(3000) 순차 기동
#  - Backend lifespan 이 ComfyUI(8000) 자동 기동/종료를 관리
#  - 이 창에서 Ctrl+C 또는 창 닫기 -> 모든 서비스 graceful 종료
# ==============================================================

$ErrorActionPreference = "Continue"

# 한글 출력 보장
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 프로젝트 루트 = 이 스크립트가 놓인 폴더
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$OllamaExe  = "C:\ollama\ollama.exe"

# 로그 디렉토리 — Backend/Frontend 가 Hidden 으로 돌아도 여기서 로그 확인 가능
$LogsDir       = Join-Path $Root "logs"
$LogBackend    = Join-Path $LogsDir "backend.log"
$LogBackendErr = Join-Path $LogsDir "backend.err.log"
$LogFrontend   = Join-Path $LogsDir "frontend.log"
$LogFrontendErr= Join-Path $LogsDir "frontend.err.log"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }

# 추적용 글로벌 상태
$Global:S = [ordered]@{
    Backend              = $null
    Frontend             = $null
    OllamaStartedByUs    = $false
    Cleaned              = $false
}

# ─── 유틸 ───────────────────────────────────────────────────────

function Write-Stage([string]$msg, [string]$color = "Cyan") {
    Write-Host ""
    Write-Host ("=== " + $msg) -ForegroundColor $color
}

function Wait-ForPort([int]$port, [int]$timeoutSec = 60) {
    # 2026-04-25: HTTP Invoke-WebRequest 폴링이 PowerShell HTTP client 의
    # 누적 timeout 으로 backend 정상 listen 후에도 fail 하는 케이스 발견 →
    # TCP 포트 listen 여부만 확인하는 단순 polling 으로 교체.
    # 메인 대기 루프(240 라인 부근) 의 Test-NetConnection 패턴과 동일.
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        $alive = Test-NetConnection -ComputerName 127.0.0.1 -Port $port `
            -WarningAction SilentlyContinue -InformationLevel Quiet
        if ($alive) { return $true }
        Start-Sleep -Milliseconds 500
        Write-Host "." -NoNewline
    }
    return $false
}

function Stop-Tree([System.Diagnostics.Process]$proc, [int]$graceSec = 8) {
    # taskkill /T 로 프로세스 트리를 graceful 시도 → 타임아웃 시 /F 강제
    if (-not $proc) { return }
    try { if ($proc.HasExited) { return } } catch { return }

    $targetPid = $proc.Id
    Write-Host ("  · PID {0} 정상 종료 시도..." -f $targetPid)
    & taskkill.exe /PID $targetPid /T 2>$null | Out-Null

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $graceSec) {
        try { if ($proc.HasExited) { return } } catch { return }
        Start-Sleep -Milliseconds 300
    }

    Write-Host ("  · PID {0} 강제 종료..." -f $targetPid) -ForegroundColor DarkYellow
    & taskkill.exe /PID $targetPid /T /F 2>$null | Out-Null
}

function Stop-Orphans {
    # lifespan 이 못 따라잡은 고아 프로세스 정리 (ComfyUI · node 잔여)
    $killed = 0

    # ComfyUI Electron/Python 잔여 — 경로로 식별 (다른 python/node 는 보호)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
        $path = $_.ExecutablePath
        if (-not $path) { return }
        $needsKill = $false
        if ($path -like "*ComfyUI*") { $needsKill = $true }
        # backend 가 spawn 한 ComfyUI main.py python 도 경로로 걸러짐 (embedded python)
        if ($needsKill) {
            Write-Host ("  · orphan 정리 PID {0} ({1})" -f $_.ProcessId, (Split-Path $path -Leaf))
            & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null
            $killed++
        }
    }

    if ($killed -eq 0) { Write-Host "  · orphan 없음" }
}

function Cleanup {
    if ($Global:S.Cleaned) { return }
    $Global:S.Cleaned = $true

    Write-Stage "서비스 종료 중" "Yellow"

    # 1) Frontend 먼저 (소비자 측)
    if ($Global:S.Frontend) {
        Write-Host "Frontend 종료..."
        Stop-Tree $Global:S.Frontend 5
    }

    # 2) Backend 종료 (lifespan 의 stop_comfyui 에게 시간 줌)
    if ($Global:S.Backend) {
        Write-Host "Backend 종료 (ComfyUI lifespan shutdown 포함, 최대 20초 대기)..."
        Stop-Tree $Global:S.Backend 20
    }

    # 3) 고아 프로세스 정리 (ComfyUI 가 살아있으면)
    Write-Host "고아 프로세스 점검..."
    Stop-Orphans

    # 4) Ollama — 우리가 켰을 때만 종료 (원래 실행 중이었으면 보존)
    if ($Global:S.OllamaStartedByUs) {
        Write-Host "Ollama 종료 (우리가 시작한 경우만)..."
        Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object {
            & taskkill.exe /PID $_.Id /T /F 2>$null | Out-Null
        }
    } else {
        Write-Host "Ollama 유지 (기존 실행 중)" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "[OK] 모든 서비스 종료 완료" -ForegroundColor Green
}

# 창 닫기 / 세션 종료 시에도 호출되도록 등록
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Cleanup } -SupportEvent

# ─── 메인 실행 ──────────────────────────────────────────────────

try {
    Write-Host ""
    Write-Host "AI Image Studio — 빠른 시작" -ForegroundColor Green
    Write-Host "─────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ("프로젝트: {0}" -f $Root) -ForegroundColor DarkGray

    # venv 검증
    if (-not (Test-Path $VenvPython)) {
        throw "Python venv 를 찾을 수 없음: $VenvPython"
    }

    # --- 1/3  Ollama ---
    Write-Stage "1/3  Ollama (11434)"
    $ollamaRunning = [bool](Get-Process ollama -ErrorAction SilentlyContinue)
    if ($ollamaRunning) {
        Write-Host "[v] 이미 실행 중 - 그대로 사용 (종료 시에도 유지)" -ForegroundColor Yellow
    } elseif (Test-Path $OllamaExe) {
        Write-Host ("시작 (Hidden): {0} serve" -f $OllamaExe)
        # Hidden — 작업표시줄에서도 안 보임. 종료는 taskkill /PID 로 처리됨.
        Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden | Out-Null
        $Global:S.OllamaStartedByUs = $true
        Start-Sleep 2
        Write-Host "헬스체크" -NoNewline
        if (Wait-ForPort 11434 10) {
            Write-Host ""
            Write-Host " [v] Ollama 준비 완료" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host " [!] Ollama 응답 없음 - 모델 로드 시 자동 복구" -ForegroundColor DarkYellow
        }
    } else {
        Write-Host ("[!] Ollama 실행 파일 없음 ({0}) - 스킵 (backend 온디맨드)" -f $OllamaExe) -ForegroundColor DarkYellow
    }

    # --- 2/3  Backend (ComfyUI lifespan 자동 기동) ---
    Write-Stage "2/3  Backend (8001) - ComfyUI lifespan 포함"

    # Hidden + 로그 파일 redirect — PS wrapper 없이 venv python 직접 실행
    # 로그는 logs/backend.log / backend.err.log 에서 실시간 확인 가능 (tail 로 추적)
    $Global:S.Backend = Start-Process -FilePath $VenvPython `
        -ArgumentList @(
            "-m", "uvicorn", "main:app",
            "--host", "127.0.0.1",
            "--port", "8001",
            "--no-access-log"
        ) `
        -WorkingDirectory "$Root\backend" `
        -WindowStyle Hidden `
        -RedirectStandardOutput $LogBackend `
        -RedirectStandardError  $LogBackendErr `
        -PassThru

    Write-Host "대기" -NoNewline
    if (Wait-ForPort 8001 120) {
        Write-Host ""
        Write-Host " [v] Backend 준비 완료" -ForegroundColor Green
        Write-Host "     (ComfyUI 는 첫 기동이면 모델 로드까지 추가 시간 소요)" -ForegroundColor DarkGray
    } else {
        Write-Host ""
        Write-Host " [!] Backend 헬스체크 타임아웃 - Backend 콘솔 로그 확인" -ForegroundColor Red
    }

    # --- 3/3  Frontend ---
    Write-Stage "3/3  Frontend (3000)"

    # Hidden + 로그 파일 redirect — npm.cmd 직접 실행 (PS wrapper 제거)
    # 환경변수는 자식 프로세스에 그대로 상속됨
    $env:NEXT_PUBLIC_USE_MOCK    = 'false'
    $env:NEXT_PUBLIC_STUDIO_API  = 'http://localhost:8001'
    $Global:S.Frontend = Start-Process -FilePath "npm.cmd" `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory "$Root\frontend" `
        -WindowStyle Hidden `
        -RedirectStandardOutput $LogFrontend `
        -RedirectStandardError  $LogFrontendErr `
        -PassThru

    Write-Host "대기" -NoNewline
    if (Wait-ForPort 3000 60) {
        Write-Host ""
        Write-Host " [v] Frontend 준비 완료" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host " [!] Frontend 응답 지연 - Frontend 콘솔 로그 확인" -ForegroundColor DarkYellow
    }

    # --- 요약 & 대기 ---
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "   AI Image Studio 실행 중" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  Frontend : http://localhost:3000"          -ForegroundColor White
    Write-Host "  Backend  : http://localhost:8001/api/health" -ForegroundColor Gray
    Write-Host "  ComfyUI  : http://localhost:8000 (backend 관리, GUI 없음)" -ForegroundColor Gray
    Write-Host "  Ollama   : http://localhost:11434 (Hidden)"   -ForegroundColor Gray
    Write-Host "--------------------------------------------" -ForegroundColor Green
    Write-Host "  로그 파일 (실시간):" -ForegroundColor DarkGray
    Write-Host ("    {0}" -f $LogBackend)  -ForegroundColor DarkGray
    Write-Host ("    {0}" -f $LogFrontend) -ForegroundColor DarkGray
    Write-Host "--------------------------------------------" -ForegroundColor Green
    Write-Host "  이 창에서  Ctrl+C  ->  모두 정상 종료"       -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""

    # 브라우저 자동 열기
    Start-Sleep 1
    Start-Process "http://localhost:3000" | Out-Null

    # 대기 루프 — 포트 헬스체크 + 30초 grace counter.
    # 기존 방식(`$Global:S.Backend.HasExited`) 은 PowerShell 콘솔 프로세스만 감지해서
    # 내부 uvicorn/npm 이 죽어도 콘솔이 살아 있으면 못 잡았음. 이제는 실제 포트로 확인.
    $backendDownCount  = 0
    $frontendDownCount = 0
    $graceThreshold    = 10   # 3초 × 10 = 30초
    while ($true) {
        Start-Sleep 3
        try {
            $backendAlive  = Test-NetConnection -ComputerName 127.0.0.1 -Port 8001 `
                -WarningAction SilentlyContinue -InformationLevel Quiet
            $frontendAlive = Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 `
                -WarningAction SilentlyContinue -InformationLevel Quiet

            if ($backendAlive)  { $backendDownCount  = 0 } else { $backendDownCount++ }
            if ($frontendAlive) { $frontendDownCount = 0 } else { $frontendDownCount++ }

            if ($backendDownCount -ge $graceThreshold) {
                Write-Host "[!] Backend 포트 8001 30초 응답 없음 → 전체 정리" -ForegroundColor Red
                break
            }
            if ($frontendDownCount -ge $graceThreshold) {
                Write-Host "[!] Frontend 포트 3000 30초 응답 없음 → 전체 정리" -ForegroundColor Red
                break
            }
        } catch {}
    }
} finally {
    Cleanup
}
