# =============================================================
# AI Image Studio - v2 hidden launcher
# - This script opens a dedicated browser app window, starts services hidden,
#   and writes logs.
# - App shutdown button calls stop_v2.ps1 through the local backend.
# =============================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$OllamaExe = "C:\ollama\ollama.exe"
$FrontendDir = Join-Path $Root "frontend"
$FrontendNextDevDir = Join-Path $FrontendDir ".next\dev"
$FrontendGlobalsCss = Join-Path $FrontendDir "app\globals.css"

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
  $client = $null
  $async = $null
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(300, $false)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    if ($async -and $async.AsyncWaitHandle) {
      $async.AsyncWaitHandle.Close()
    }
    if ($client) {
      $client.Close()
      $client.Dispose()
    }
  }
}

function Wait-Port([int]$Port, [int]$TimeoutSec) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    if (Test-Port $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Wait-PortDown([int]$Port, [int]$TimeoutSec) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    if (-not (Test-Port $Port)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-PortOwnerProcessId([int]$Port) {
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($connection) { return [int]$connection.OwningProcess }
  } catch {
    return $null
  }
  return $null
}

function Test-PathInside([string]$Path, [string]$ParentPath) {
  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd("\")
  $fullParent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd("\")
  return $fullPath.Equals($fullParent, [System.StringComparison]::OrdinalIgnoreCase) -or
    $fullPath.StartsWith($fullParent + "\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-FrontendDevCacheStale {
  if (-not (Test-Path $FrontendGlobalsCss)) { return $false }
  if (-not (Test-Path $FrontendNextDevDir)) { return $false }

  $chunksDir = Join-Path $FrontendNextDevDir "static\chunks"
  $compiledCss = Get-ChildItem -LiteralPath $chunksDir -Filter "app_globals*.css" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $compiledCss) { return $true }

  $sourceCss = Get-Item -LiteralPath $FrontendGlobalsCss
  return $sourceCss.LastWriteTime -gt $compiledCss.LastWriteTime
}

function Stop-FrontendDevServer {
  $ownerProcessId = Get-PortOwnerProcessId 3000
  if (-not $ownerProcessId) { return }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerProcessId" -ErrorAction SilentlyContinue
  $commandLine = if ($process) { $process.CommandLine } else { "" }
  $frontendPath = [System.IO.Path]::GetFullPath($FrontendDir)
  $isLikelyFrontend = $commandLine -and (
    $commandLine -like "*next*" -or
    $commandLine -like "*npm*" -or
    $commandLine -like "*$frontendPath*"
  )

  if (-not $isLikelyFrontend) {
    Write-Log ("frontend cache stale but port 3000 owner is not recognized: PID {0}" -f $ownerProcessId)
    return
  }

  Write-Log ("stopping stale frontend dev server PID {0}" -f $ownerProcessId)
  & taskkill.exe /PID $ownerProcessId /T /F 2>$null | Out-Null
  [void](Wait-PortDown 3000 15)
}

function Clear-FrontendDevCache {
  if (-not (Test-Path $FrontendNextDevDir)) { return }
  $nextDir = Join-Path $FrontendDir ".next"
  if (-not (Test-PathInside $FrontendNextDevDir $nextDir)) {
    Write-Log "skip frontend dev cache clear: unexpected path"
    return
  }

  Write-Log "clearing frontend .next dev cache"
  Remove-Item -LiteralPath $FrontendNextDevDir -Recurse -Force -ErrorAction SilentlyContinue
}

function Ensure-FrontendDevCacheFresh {
  if (-not (Test-FrontendDevCacheStale)) { return }

  Write-Log "frontend globals.css is newer than compiled dev css"
  if (Test-Port 3000) {
    Stop-FrontendDevServer
  }
  Clear-FrontendDevCache
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

  Ensure-FrontendDevCacheFresh

  if (-not (Test-Port 3000)) {
    Write-Log "starting frontend"
    Start-Process -FilePath "npm.cmd" `
      -ArgumentList @("run", "dev") `
      -WorkingDirectory $FrontendDir `
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

