@echo off
call "%~dp0_env.bat"
title Bot Desktop V2
cd /d "%APP_ROOT%"

if not exist "%APP_ROOT%\node_modules\electron" (
  echo npm install...
  call npm install
)

if not exist "%APPDATA%\ai-seller-bot-desktop-v2\settings.json" (
  echo Importing bots/channels/voices into v2 AppData...
  node "%APP_ROOT%\tools\import-from-desktop.js"
)

echo Starting Bot Desktop V2...
call npm start
if errorlevel 1 pause
