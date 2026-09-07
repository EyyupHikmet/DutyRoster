@echo off
REM Double-clickable launcher for Windows.
REM .ps1 files have no default file association, so double-clicking run.ps1
REM opens or does nothing instead of running it. This wrapper runs it properly.
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
echo.
echo Bu pencereyi kapatmak icin bir tusa basin. / Press any key to close.
pause >nul
