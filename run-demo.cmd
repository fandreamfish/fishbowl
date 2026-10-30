@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE set "NODE=C:\Users\24358\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

%NODE% src\demo.ts
set "RC=%errorlevel%"
echo.
echo exit code: %RC%
pause
exit /b %RC%
