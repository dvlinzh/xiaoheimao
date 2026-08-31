@echo off
rem Health check launcher (ASCII wrapper, logic in check-health.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-health.ps1"
pause
