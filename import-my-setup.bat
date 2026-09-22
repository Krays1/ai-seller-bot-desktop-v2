@echo off
REM Re-import bots/channels/voices/LLM URLs from your mature Desktop
setlocal
cd /d "%~dp0"
node tools\import-from-desktop.js
pause
