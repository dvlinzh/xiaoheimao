@echo off
rem One-click launcher for mind-board-pet (C# native shell + data service).
rem Requires Node.js >= 18. ASCII wrapper: logic lives in scripts/launch.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
pause
