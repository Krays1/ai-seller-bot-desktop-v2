@echo off
setlocal
call "%~dp0_env.bat"
title AI-Seller - Local STT
cd /d "%~dp0tools"
echo Local Whisper STT http://127.0.0.1:9000
echo Python: %PY%
%PY% local-stt-server.py
if errorlevel 1 pause
