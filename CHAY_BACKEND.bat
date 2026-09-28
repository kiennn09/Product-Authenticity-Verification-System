@echo off
title BACKEND - AuthentiChain (KHONG TAT CUA SO NAY)
cd /d "%~dp0backend"
:loop
echo ================================================
echo  Dang khoi dong backend...
echo ================================================
call npm start
echo.
echo [!] Backend vua dung. Tu khoi dong lai sau 3 giay...
timeout /t 3 >nul
goto loop
