@echo off
setlocal
cd /d "%~dp0"
title Puissance 4 - Discord Rich Presence

where node.exe >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Puissance 4 RPC] Node.js n'est pas installe.
  echo Telecharge-le depuis https://nodejs.org/
  echo puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\discord-rpc\package.json" (
  echo.
  echo [Puissance 4 RPC] Installation au premier lancement...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo L'installation a echoue. Verifie ta connexion internet.
    pause
    exit /b 1
  )
)

echo.
echo [Puissance 4 RPC] Demarrage...
echo Garde Discord Desktop et cette fenetre ouverts.
echo.
node companion.js

echo.
echo Le compagnon s'est arrete.
pause
