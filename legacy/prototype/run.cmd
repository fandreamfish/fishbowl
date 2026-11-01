@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"

if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)

if not defined PY (
  set "PY=C:\Users\24358\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
)

%PY% -X utf8 run.py
set "RC=%errorlevel%"

echo.
echo exit code: %RC%
pause
exit /b %RC%
