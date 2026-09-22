#Requires -Version 5.1
<#
  Quick setup: VS Code + Cline → local Ollama (Qwen 3 Coder)
  Friend already has Ollama installed.

  Run in PowerShell (right-click → Run with PowerShell, or):
    powershell -ExecutionPolicy Bypass -File setup-vscode-cline.ps1
#>

$ErrorActionPreference = 'Stop'
$PreferredModels = @(
  'qwen3-coder:30b',
  'qwen3-coder-30b:latest',
  'qwen3-coder:latest',
  'qwen2.5-coder:32b',
  'qwen2.5-coder:14b'
)

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "VS Code + Cline setup (Ollama local)" -ForegroundColor Green
Write-Host "This installs VS Code (if missing) and the Cline extension." -ForegroundColor DarkGray

# --- Ollama check ---
Write-Step "Checking Ollama"
if (-not (Test-Command 'ollama')) {
  Write-Host "ERROR: ollama not found in PATH. Install Ollama first, then re-run." -ForegroundColor Red
  Write-Host "https://ollama.com/download" -ForegroundColor Yellow
  exit 1
}

try {
  $null = Invoke-WebRequest -Uri 'http://127.0.0.1:11434' -UseBasicParsing -TimeoutSec 3
  Write-Host "Ollama is reachable at http://127.0.0.1:11434"
} catch {
  Write-Host "Ollama CLI found, but server not responding. Starting 'ollama serve' in background..." -ForegroundColor Yellow
  Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

$installed = @()
try {
  $installed = @(ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object {
    ($_ -split '\s+')[0]
  } | Where-Object { $_ })
} catch {
  $installed = @()
}

Write-Host "Installed models:"
if ($installed.Count -eq 0) {
  Write-Host "  (none listed — will pull a coder model)" -ForegroundColor Yellow
} else {
  $installed | ForEach-Object { Write-Host "  $_" }
}

$pick = $PreferredModels | Where-Object { $installed -contains $_ } | Select-Object -First 1
if (-not $pick) {
  Write-Step "Pulling qwen3-coder:30b (large download — leave this running)"
  ollama pull qwen3-coder:30b
  $pick = 'qwen3-coder:30b'
} else {
  Write-Host "Using existing model: $pick" -ForegroundColor Green
}

# Optional long-context alias for Cline
Write-Step "Creating long-context alias for Cline (32k) — recommended"
$modelfile = Join-Path $env:TEMP 'cline-qwen-modelfile'
@"
FROM $pick
PARAMETER num_ctx 32768
"@ | Set-Content -Path $modelfile -Encoding ascii
try {
  ollama create qwen3-coder-32k -f $modelfile
  $clineModel = 'qwen3-coder-32k'
  Write-Host "Created model: qwen3-coder-32k" -ForegroundColor Green
} catch {
  Write-Host "Could not create 32k alias — use $pick in Cline instead." -ForegroundColor Yellow
  $clineModel = $pick
}

# --- VS Code ---
Write-Step "Checking Visual Studio Code (not Visual Studio)"
$codeCmd = $null
if (Test-Command 'code') {
  $codeCmd = 'code'
} else {
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
    "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $codeCmd = $c; break }
  }
}

if (-not $codeCmd) {
  Write-Host "VS Code not found. Installing with winget..." -ForegroundColor Yellow
  if (-not (Test-Command 'winget')) {
    Write-Host "ERROR: winget missing. Install VS Code manually:" -ForegroundColor Red
    Write-Host "https://code.visualstudio.com/download" -ForegroundColor Yellow
    Write-Host "Then re-run this script." -ForegroundColor Yellow
    exit 1
  }
  winget install --id Microsoft.VisualStudioCode -e --accept-source-agreements --accept-package-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [System.Environment]::GetEnvironmentVariable('Path', 'User')
  Start-Sleep -Seconds 2
  if (Test-Command 'code') {
    $codeCmd = 'code'
  } elseif (Test-Path "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd") {
    $codeCmd = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
  } else {
    Write-Host "VS Code installed — close this window, open a NEW PowerShell, re-run script to install Cline." -ForegroundColor Yellow
    exit 0
  }
}

Write-Host "VS Code OK: $codeCmd"

# --- Cline extension ---
Write-Step "Installing Cline extension"
& $codeCmd --install-extension saoudrizwan.claude-dev --force
Write-Host "Cline extension installed." -ForegroundColor Green

# --- How-to card ---
$guide = @"
========================================
 DONE — how to use Cline with Qwen
========================================

1. Open Visual Studio CODE (purple icon), not Visual Studio.
2. File → Open Folder → pick your project → Trust the folder.
3. Click the Cline icon in the left sidebar (robot).
4. Open the gear / settings in the Cline panel.
5. Set:
     API Provider : Ollama
     Base URL     : http://127.0.0.1:11434
     Model        : $clineModel
6. Save, then ask Cline something like: "list the files in this folder"

Tips:
- Keep Ollama running while using Cline.
- Prefer model: $clineModel  (32k context). Fallback: $pick
- If the model list is empty, click refresh or restart VS Code.

Ollama models on this PC:
$(if ($installed.Count) { ($installed | ForEach-Object { "  - $_" }) -join "`n" } else { "  (see ollama list)" })
========================================
"@

Write-Host $guide -ForegroundColor White
$guidePath = Join-Path $PSScriptRoot 'CLINE-SETUP-NOTES.txt'
try {
  Set-Content -Path $guidePath -Value $guide -Encoding UTF8
  Write-Host "Saved notes: $guidePath" -ForegroundColor DarkGray
} catch {
  # ignore if read-only
}

Write-Host "Press Enter to exit..."
[void][System.Console]::ReadLine()
