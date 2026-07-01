@echo off
setlocal
cd /d "%~dp0"

set PORT=5173
set URL=http://localhost:%PORT%/
set BUNDLED_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe

echo Starting Micro:Bit Face Tracking Controller...
echo.
echo Keep this window open while using the app.
echo Open: %URL%
echo.

powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 1) ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  echo A local server is already running.
  start "" "%URL%"
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "%URL%"
  py -3 -m http.server %PORT%
  goto :done
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "%URL%"
  python -m http.server %PORT%
  goto :done
)

if exist "%BUNDLED_PY%" (
  start "" "%URL%"
  "%BUNDLED_PY%" -m http.server %PORT%
  goto :done
)

echo Python was not found on this computer.
echo Install Python, or run this folder from any local web server.
pause

:done
endlocal