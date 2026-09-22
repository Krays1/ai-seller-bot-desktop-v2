@echo off
call "%~dp0_env.bat"
title Bot Desktop - Local STT
cd /d "%APP_ROOT%\tools"

echo Local Whisper STT :9000
echo Python: %PY%
%PY% -c "import fastapi,uvicorn,transformers,torch,soundfile,numpy" >nul 2>&1
if errorlevel 1 (
  echo Installing STT deps...
  %PY% -m pip install fastapi uvicorn python-multipart soundfile numpy transformers accelerate torch --index-url https://download.pytorch.org/whl/cu128
  %PY% -m pip install fastapi uvicorn python-multipart soundfile numpy transformers accelerate
)

%PY% local-stt-server.py
if errorlevel 1 pause
