@echo off
rem MyEinkauf lokal am PC starten. Fenster schliessen = Server beenden.
cd /d "%~dp0"
set PORT=8080

set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY (
  echo Python wurde nicht gefunden. Bitte von https://www.python.org installieren.
  pause
  exit /b 1
)

echo MyEinkauf laeuft auf http://localhost:%PORT%
echo Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.
start "" "http://localhost:%PORT%"
%PY% -m http.server %PORT% --bind 127.0.0.1
pause
