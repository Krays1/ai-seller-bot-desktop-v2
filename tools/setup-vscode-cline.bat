@echo off
title VS Code + Cline setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-vscode-cline.ps1"
pause
