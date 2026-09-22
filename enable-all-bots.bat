@echo off
REM Force-enable EVERY imported bot, then you Connect in the app
setlocal
cd /d "%~dp0"
node tools\enable-all-bots.js
pause
