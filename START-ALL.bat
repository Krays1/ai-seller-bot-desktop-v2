@echo off
REM Start Bot Desktop V2: Forge + OmniVoice + STT + Electron
setlocal EnableExtensions
call "%~dp0_env.bat"
cd /d "%APP_ROOT%"

title Bot Desktop V2 START
echo.
echo === Bot Desktop V2 on this PC ===
echo AppData:   %APPDATA%\ai-seller-bot-desktop-v2
echo Voices:    %VOICES%
echo OmniVoice: %OMNIVOICE_URL%
echo STT:       %STT_URL%
echo Forge:     http://127.0.0.1:7860
echo Ollama:    http://192.168.1.92:11434  (Other PC brain / vision)
echo Vision:    qwen2.5vl:3b
echo.

if not exist "%APP_ROOT%\node_modules\electron\" (
  echo Installing npm packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist "%APP_ROOT%\node_modules\sharp\" (
  echo Installing sharp...
  call npm install sharp --save
)

if not exist "%VOICES%\*.wav" (
  if exist "E:\zello-bot-desktop\omnivoice voices\" (
    echo Copying voice WAVs...
    robocopy "E:\zello-bot-desktop\omnivoice voices" "%VOICES%" /E /XO /NFL /NDL /NJH /NJS >nul
  )
)

if not exist "%APP_ROOT%\stable-diffusion-webui-forge-main\webui-user.bat" (
  echo Linking Forge into this folder...
  if exist "E:\New folder\stable-diffusion-webui-forge-main\webui-user.bat" (
    mklink /J "%APP_ROOT%\stable-diffusion-webui-forge-main" "E:\New folder\stable-diffusion-webui-forge-main"
  ) else if exist "E:\zello-wall-for-friend\stable-diffusion-webui-forge-main\webui-user.bat" (
    mklink /J "%APP_ROOT%\stable-diffusion-webui-forge-main" "E:\zello-wall-for-friend\stable-diffusion-webui-forge-main"
  ) else (
    echo WARNING: No Forge install found to link.
  )
)

set "SETTINGS_JSON=%APPDATA%\ai-seller-bot-desktop-v2\settings.json"
if /I "%FORCE_IMPORT%"=="1" goto do_import
if not exist "%SETTINGS_JSON%" goto do_import
echo Keeping existing v2 settings (set FORCE_IMPORT=1 to re-import).
goto after_import

:do_import
echo Refreshing account credentials into v2 AppData (keeps enabled ticks)...
node "%APP_ROOT%\tools\import-from-desktop.js"
if errorlevel 1 (
  echo Import warning - continuing with existing settings.
)
:after_import

echo [0/4] Vision model qwen2.5vl:3b + settings...
node "%APP_ROOT%\tools\ensure-vision-model.js"
if errorlevel 2 (
  echo Vision model not on Ollama yet — start Ollama on the brain PC, then re-run or: ollama pull qwen2.5vl:3b
)

echo [1/4] Forge Stable Diffusion API...
start "Bot Desktop Forge" cmd /k "%~dp04-start-forge.bat"

echo Waiting for Forge :7860 (first boot can take several minutes)...
set /a _n=0
:wait_forge
set /a _n+=1
curl.exe -s -m 3 "http://127.0.0.1:7860/sdapi/v1/sd-models" 2>nul | findstr /i "title model_name" >nul
if not errorlevel 1 goto forge_ok
if %_n% GEQ 120 (
  echo Forge still loading - continue anyway. Pictures need :7860 ready.
  goto after_forge
)
timeout /t 3 /nobreak >nul
goto wait_forge
:forge_ok
echo Forge OK.
:after_forge

echo [2/4] OmniVoice...
start "Bot Desktop OmniVoice" cmd /k "%~dp01-start-omnivoice.bat"

echo Waiting for OmniVoice...
set /a _n=0
:wait_omni
set /a _n+=1
curl.exe -s -m 3 "%OMNIVOICE_URL%/health" 2>nul | findstr /i "ok healthy ready status" >nul
if not errorlevel 1 goto omni_ok
if %_n% GEQ 90 (
  echo OmniVoice still starting - continue anyway.
  goto after_omni
)
timeout /t 2 /nobreak >nul
goto wait_omni
:omni_ok
echo OmniVoice OK.
:after_omni

echo [3/4] Local STT...
start "Bot Desktop STT" cmd /k "%~dp02-start-stt.bat"
timeout /t 2 /nobreak >nul

echo [4/4] App v2...
start "Bot Desktop V2" cmd /k "%~dp03-start-app.bat"

echo.
echo Opened 4 windows: Forge + OmniVoice + STT + App.
echo Live = hear/reply. Roster = Join/Speak/Name. Engines = brain/STT/TTS.
echo Pictures: "Sugar show us a cat"  (needs Forge). Photos: auto-describe (needs qwen2.5vl:3b).
echo.
pause
