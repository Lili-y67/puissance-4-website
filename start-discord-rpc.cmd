@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\discord-rpc\package.json" (
  echo [Puissance 4 RPC] Dependances manquantes.
  echo Lance d'abord : npm.cmd install
  echo.
  pause
  exit /b 1
)

title Puissance 4 - Discord Rich Presence
echo Demarrage du Rich Presence Puissance 4...
echo Garde Discord Desktop et cette fenetre ouverts.
echo.
npm.cmd run rpc

echo.
echo Le compagnon Discord s'est arrete.
pause
