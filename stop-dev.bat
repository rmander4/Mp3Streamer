@echo off
setlocal

echo Stopping Mp3Streamer backend...
taskkill /F /IM Mp3Streamer.Api.exe >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq Mp3Streamer Backend*" >nul 2>&1

echo Stopping Mp3Streamer frontend (port 5173)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /F /PID %%p >nul 2>&1
)
taskkill /F /T /FI "WINDOWTITLE eq Mp3Streamer Frontend*" >nul 2>&1

echo Done.
endlocal
