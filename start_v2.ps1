# =============================================================
# AI Image Studio - v2 hidden launcher
# - This script opens a dedicated browser app window, starts services hidden,
#   and writes logs.
# - App shutdown button calls stop_v2.ps1 through the local backend.
# =============================================================

$ErrorActionPreference = "Continue"

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$OllamaExe = "C:\ollama\ollama.exe"

$LogsDir = Join-Path $Root "logs"
$LauncherLog = Join-Path $LogsDir "launcher-v2.log"
$LogBackend = Join-Path $LogsDir "backend.log"
$LogBackendErr = Join-Path $LogsDir "backend.err.log"
$LogFrontend = Join-Path $LogsDir "frontend.log"
$LogFrontendErr = Join-Path $LogsDir "frontend.err.log"
$BrowserProfileDir = Join-Path $Root "data\launcher-chrome"
$LegacyBrowserProfileDir = Join-Path $Root "data\launcher-browser"
$LoadingFile = Join-Path $Root "launcher\loading.html"

if (-not (Test-Path $LogsDir)) {
  New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LauncherLog -Value $line -Encoding UTF8
}

function Test-Port([int]$Port) {
  return [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port $Port `
    -WarningAction SilentlyContinue -InformationLevel Quiet)
}

function Wait-Port([int]$Port, [int]$TimeoutSec) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    if (Test-Port $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Resolve-ChromeExe {
  $commands = @(
    (Get-Command "chrome.exe" -ErrorAction SilentlyContinue).Source
  ) | Where-Object { $_ }

  $candidates = @(
    $commands,
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Stop-LauncherBrowserByProfile([string]$ProfileDir) {
  if (-not $ProfileDir) { return }
  $profile = [System.IO.Path]::GetFullPath($ProfileDir).TrimEnd("\")
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = $_.CommandLine
    if ($cmd -and $cmd -like "*$profile*") {
      Write-Log ("closing stale launcher browser PID {0}" -f $_.ProcessId)
      & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null
    }
  }
}

function Start-LauncherBrowser {
  Stop-LauncherBrowserByProfile $LegacyBrowserProfileDir
  Stop-LauncherBrowserByProfile $BrowserProfileDir

  if (-not (Test-Path $BrowserProfileDir)) {
    New-Item -ItemType Directory -Path $BrowserProfileDir | Out-Null
  }

  $target = "http://localhost:3000/loading"
  if (Test-Path $LoadingFile) {
    $target = ([System.Uri](Resolve-Path $LoadingFile).Path).AbsoluteUri
  }

  $browser = Resolve-ChromeExe
  if ($browser) {
    Write-Log "opening Chrome launcher browser: $browser"
    Start-Process -FilePath $browser -ArgumentList @(
      "--user-data-dir=`"$BrowserProfileDir`"",
      "--app=$target",
      "--no-first-run",
      "--disable-features=Translate"
    ) | Out-Null
  } else {
    Write-Log "Chrome executable not found; launcher browser not opened"
  }
}

try {
  Write-Log "launcher start: $Root"
  Start-LauncherBrowser

  if (-not (Test-Path $VenvPython)) {
    Write-Log "missing venv python: $VenvPython"
    exit 1
  }

  if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    if (Test-Path $OllamaExe) {
      Write-Log "starting ollama"
      Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden | Out-Null
      Start-Sleep -Seconds 2
    } else {
      Write-Log "ollama executable not found: $OllamaExe"
    }
  } else {
    Write-Log "ollama already running"
  }

  if (-not (Test-Port 8001)) {
    Write-Log "starting backend"
    Start-Process -FilePath $VenvPython `
      -ArgumentList @(
        "-m", "uvicorn", "main:app",
        "--host", "127.0.0.1",
        "--port", "8001",
        "--no-access-log"
      ) `
      -WorkingDirectory "$Root\backend" `
      -WindowStyle Hidden `
      -RedirectStandardOutput $LogBackend `
      -RedirectStandardError $LogBackendErr | Out-Null
  } else {
    Write-Log "backend port already listening"
  }

  if (Wait-Port 8001 120) {
    Write-Log "backend ready"
  } else {
    Write-Log "backend wait timeout"
  }

  $env:NEXT_PUBLIC_USE_MOCK = "false"
  $env:NEXT_PUBLIC_STUDIO_API = "http://localhost:8001"
  $env:NEXT_PUBLIC_ENABLE_LOCAL_SHUTDOWN = "true"

  if (-not (Test-Port 3000)) {
    Write-Log "starting frontend"
    Start-Process -FilePath "npm.cmd" `
      -ArgumentList @("run", "dev") `
      -WorkingDirectory "$Root\frontend" `
      -WindowStyle Hidden `
      -RedirectStandardOutput $LogFrontend `
      -RedirectStandardError $LogFrontendErr | Out-Null
  } else {
    Write-Log "frontend port already listening"
  }

  if (Wait-Port 3000 90) {
    Write-Log "frontend ready"
  } else {
    Write-Log "frontend wait timeout"
  }

  $downCount = 0
  while ($true) {
    Start-Sleep -Seconds 3
    $backendAlive = Test-Port 8001
    $frontendAlive = Test-Port 3000
    if ($backendAlive -or $frontendAlive) {
      $downCount = 0
    } else {
      $downCount++
      if ($downCount -ge 10) {
        Write-Log "ports down for 30 seconds; launcher exit"
        break
      }
    }
  }
} catch {
  Write-Log ("launcher fatal: " + $_.Exception.Message)
  exit 1
}

