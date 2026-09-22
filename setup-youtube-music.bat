@echo off
REM Ensure yt-dlp + ffmpeg for "bot play SONG"
setlocal EnableExtensions
call "%~dp0_env.bat"
cd /d "%APP_ROOT%"

echo.
echo === YouTube music deps ===
echo.

set "YT_OK=0"
if defined YT_DLP_PATH if exist "%YT_DLP_PATH%" (
  echo yt-dlp: %YT_DLP_PATH%
  "%YT_DLP_PATH%" --version
  set "YT_OK=1"
) else (
  where yt-dlp >nul 2>&1 && (
    where yt-dlp
    yt-dlp --version
    set "YT_OK=1"
  )
)

if "%YT_OK%"=="0" (
  echo yt-dlp not found — installing via pip...
  %PY% -m pip install -U yt-dlp
  if errorlevel 1 (
    echo FAILED to install yt-dlp
    pause
    exit /b 1
  )
  where yt-dlp
  yt-dlp --version
)

echo.
if defined FFMPEG_PATH if exist "%FFMPEG_PATH%" (
  echo ffmpeg: %FFMPEG_PATH%
) else (
  where ffmpeg >nul 2>&1 && where ffmpeg || (
    echo ffmpeg not on PATH — install from https://www.gyan.dev/ffmpeg/builds/ or winget install ffmpeg
  )
)

echo.
echo Music commands:  bot play never gonna give you up
echo                  bot stop
echo Cache folder: %%APPDATA%%\ai-seller-bot-desktop-v2\channel-games\youtube-cache
echo.
pause
