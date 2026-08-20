@echo off
title Vitalis Rayos - puente del consultorio
cd /d "%~dp0"
:inicio
node agente.js
echo.
echo El puente se detuvo. Reiniciando en 10 segundos...
timeout /t 10 >nul
goto inicio
