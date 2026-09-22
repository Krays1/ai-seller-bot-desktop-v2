@echo off
REM Shared paths for Bot Desktop V2 boot farm
set "APP_ROOT=%~dp0"
set "APP_ROOT=%APP_ROOT:~0,-1%"
set "VOICES=%APP_ROOT%\omnivoice voices"
set "WALL_ROOT=E:\zello-wall-for-friend"
set "OMNI_DIR=%WALL_ROOT%\OmniVoice-master"
set "OMNIVOICE_URL=http://127.0.0.1:8002"
set "STT_URL=http://127.0.0.1:9000"
set "FORGE_URL=http://127.0.0.1:7860"
set "VISION_MODEL=qwen2.5vl:3b"
REM YouTube: play up to 5 min (trim longer tracks); any channel key-up stops TX
if not defined YOUTUBE_MAX_DURATION_SEC set "YOUTUBE_MAX_DURATION_SEC=300"
if not defined YOUTUBE_INTERRUPT_GRACE_MS set "YOUTUBE_INTERRUPT_GRACE_MS=0"

REM YouTube music (already installed on this PC — wire absolute paths for Electron)
if not defined YT_DLP_PATH if exist "%LocalAppData%\Programs\Python\Python310\Scripts\yt-dlp.exe" (
  set "YT_DLP_PATH=%LocalAppData%\Programs\Python\Python310\Scripts\yt-dlp.exe"
)
if not defined FFMPEG_PATH (
  for /f "delims=" %%I in ('where ffmpeg 2^>nul') do (
    if not defined FFMPEG_PATH set "FFMPEG_PATH=%%I"
  )
)
if not defined FFMPEG_PATH if exist "%LocalAppData%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffmpeg.exe" (
  set "FFMPEG_PATH=%LocalAppData%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin\ffmpeg.exe"
)

set "PY="
where py >nul 2>&1 && (
  py -3.10 -c "import sys" >nul 2>&1 && set "PY=py -3.10"
)
if not defined PY if exist "%LocalAppData%\Programs\Python\Python310\python.exe" (
  set "PY=%LocalAppData%\Programs\Python\Python310\python.exe"
)
if not defined PY set "PY=python"
