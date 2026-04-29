param(
  [int]$DelaySec = 0,
  [switch]$KillOllama,
  [switch]$CloseBrowser
)

# =============================================================
# AI Image Studio - v2 non-interactive shutdown
# - Used by the local backend shutdown endpoint.
# - Also safe to run manually as an emergency cleanup helper.
# =============================================================

$ErrorActionPreference = "Continue"

$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$LogsDir = Join-Path $Root "logs"
$ShutdownLog = Join-Path $LogsDir "shutdown-v2.log"
$BrowserProfileDir = Join-Path $Root "data\launcher-chrome"
$LegacyBrowserProfileDir = Join-Path $Root "data\launcher-browser"

if (-not (Test-Path $LogsDir)) {
  New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $ShutdownLog -Value $line -Encoding UTF8
}

function Kill-PortOwner([int]$Port, [string]$Label) {
  $owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  if (-not $owners) {
    Write-Log ":$Port $Label not listening"
    return
  }

  foreach ($targetPid in $owners) {
    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "unknown" }
    Write-Log "killing :$Port $Label PID $targetPid ($name)"
    & taskkill.exe /PID $targetPid /T /F 2>$null | Out-Null
  }
}

function Kill-ComfyUI {
  $comfyCount = 0
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $path = $_.ExecutablePath
    if ($path -and $path -like "*ComfyUI*") {
      $comfyCount++
      Write-Log ("killing ComfyUI PID {0} ({1})" -f $_.ProcessId, (Split-Path $path -Leaf))
      & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null
    }
  }
  if ($comfyCount -eq 0) {
    Write-Log "ComfyUI not found"
  }
}

function Kill-Ollama {
  if ($KillOllama) {
    Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object {
      Write-Log ("killing Ollama PID {0}" -f $_.Id)
      & taskkill.exe /PID $_.Id /T /F 2>$null | Out-Null
    }
  } else {
    Write-Log "Ollama preserved"
  }
}

function Close-LauncherBrowser {
  if (-not $CloseBrowser) {
    Write-Log "launcher browser preserved"
    return
  }

  $profiles = @(
    [System.IO.Path]::GetFullPath($BrowserProfileDir).TrimEnd("\"),
    [System.IO.Path]::GetFullPath($LegacyBrowserProfileDir).TrimEnd("\")
  )
  $closed = 0
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = $_.CommandLine
    $matchesProfile = $false
    foreach ($profile in $profiles) {
      if ($cmd -and $cmd -like "*$profile*") {
        $matchesProfile = $true
        break
      }
    }
    if ($matchesProfile) {
      $closed++
      Write-Log ("closing launcher browser PID {0}" -f $_.ProcessId)
      & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null
    }
  }
  if ($closed -eq 0) {
    Write-Log "launcher browser not found"
  }
}

if ($DelaySec -gt 0) {
  Start-Sleep -Seconds $DelaySec
}

Write-Log "shutdown start"

Start-Sleep -Milliseconds 700
Kill-ComfyUI

Start-Sleep -Milliseconds 700
Kill-Ollama

Start-Sleep -Milliseconds 700
Kill-PortOwner 3000 "frontend"

Start-Sleep -Milliseconds 700
Kill-PortOwner 8001 "backend"

Start-Sleep -Milliseconds 1200
Close-LauncherBrowser

Write-Log "shutdown complete"

