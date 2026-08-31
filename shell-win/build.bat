@echo off
rem XiaoHeiMao C# shell build — uses Windows built-in csc.exe (zero install).
rem Output: shell-win\PetCat.exe (single file, only needs .NET Framework 4.x, bundled with Win11)
setlocal
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set HERE=%~dp0

rem Cat sprites: copied from the shared asset source (single source of truth)
if not exist "%HERE%assets" mkdir "%HERE%assets"
copy /y "%HERE%..\src\renderer\assets\cat\cat-idle.png" "%HERE%assets\" >nul
copy /y "%HERE%..\src\renderer\assets\cat\cat-walk.png" "%HERE%assets\" >nul
copy /y "%HERE%..\src\renderer\assets\cat\cat-sleep.png" "%HERE%assets\" >nul

"%CSC%" /nologo /unsafe /target:winexe /platform:x64 /optimize+ /out:"%HERE%PetCat.exe" "%HERE%PetCat.cs" /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll
if %errorlevel%==0 (echo BUILD OK: %HERE%PetCat.exe) else (echo BUILD FAILED & exit /b 1)
