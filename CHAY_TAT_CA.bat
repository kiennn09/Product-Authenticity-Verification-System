@echo off
cd /d "%~dp0"
start "BACKEND" cmd /k CHAY_BACKEND.bat
timeout /t 2 >nul
start "FRONTEND" cmd /k CHAY_FRONTEND.bat
timeout /t 8 >nul
start http://localhost:5173
