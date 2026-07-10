@echo off
title Prospection Garages - Bifco
cd /d "%~dp0"

echo.
echo   ============================================
echo     Prospection Garages - demarrage...
echo   ============================================
echo.

if not exist "node_modules\nodemailer" (
  echo   Premiere utilisation : installation en cours...
  call npm install
  echo.
)

REM Ouvre le navigateur apres 2 secondes
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:3000"

node server.js

echo.
echo   L'application s'est arretee. Appuie sur une touche pour fermer.
pause >nul
