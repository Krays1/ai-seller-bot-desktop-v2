@echo off
call "%~dp0_env.bat"
title Bot Desktop - OmniVoice
cd /d "%OMNI_DIR%"

if not exist "%OMNI_DIR%\omnivoice_server.py" (
  echo Missing OmniVoice at %OMNI_DIR%
  pause
  exit /b 1
)

if not exist "%VOICES%" mkdir "%VOICES%"
set "OMNIVOICE_VOICES_DIR=%VOICES%"
set "OMNIVOICE_DEVICE=cuda"
echo OmniVoice :8002
echo Voices: %VOICES%
%PY% omnivoice_server.py --host 127.0.0.1 --port 8002 --voices-dir "%VOICES%" --device cuda --num-step 10
if errorlevel 1 pause
