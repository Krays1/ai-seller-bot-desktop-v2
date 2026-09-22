@echo off
REM Start Forge (Stable Diffusion WebUI) with --api for bot "show us" pictures
setlocal EnableExtensions
call "%~dp0_env.bat"
cd /d "%APP_ROOT%\stable-diffusion-webui-forge-main"

if not exist "webui-user.bat" (
  echo Forge not found at:
  echo   %APP_ROOT%\stable-diffusion-webui-forge-main
  echo Create a junction to your Forge install, or copy the folder here.
  pause
  exit /b 1
)

title Bot Desktop Forge
echo.
echo === Forge / Stable Diffusion (API on :7860) ===
echo Folder: %CD%
echo IMPORTANT: One Forge window only.
echo.

REM Kill leftover Forge python locks
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'stable-diffusion-webui-forge-main' -and $_.Name -match 'python' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 /nobreak >nul

REM Ensure --api is in COMMANDLINE_ARGS (webui-user.bat should already set it)
call webui-user.bat
