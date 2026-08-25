@echo off
setlocal
cd /d "%~dp0"

start "Mp3Streamer Backend" cmd /k "cd /d "%~dp0server\Mp3Streamer.Api" && dotnet run --no-launch-profile"
start "Mp3Streamer Frontend" cmd /k "cd /d "%~dp0client\mp3streamer-web" && npm run dev -- --host 0.0.0.0"

echo Backend and frontend are starting in separate windows.
echo Backend:  http://localhost:5288
echo Frontend: http://localhost:5173  (also reachable via this PC's LAN IP)
endlocal
