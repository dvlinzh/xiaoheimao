@echo off
rem XiaoHeiMao C# shell build.
rem Compiler: roslyn\csc.exe (Microsoft.Net.Compilers.Toolset, one-time download, see README).
rem WebView2 managed assemblies: wv2\ (NuGet pkg). Runtime is system-bundled.
setlocal
set HERE=%~dp0
set CSC=%HERE%roslyn\csc.exe

rem Cat sprites: copied from the shared asset source (single source of truth)
if not exist "%HERE%assets" mkdir "%HERE%assets"
copy /y "%HERE%..\src\renderer\assets\cat\cat-*.png" "%HERE%assets\" >nul
rem WebView2 native loader AND managed assemblies must sit next to the exe
rem (.NET Framework resolves referenced dlls from the app dir at runtime)
copy /y "%HERE%wv2\runtimes\win-x64\native\WebView2Loader.dll" "%HERE%" >nul
copy /y "%HERE%wv2\lib\net462\Microsoft.Web.WebView2.Core.dll" "%HERE%" >nul
copy /y "%HERE%wv2\lib\net462\Microsoft.Web.WebView2.WinForms.dll" "%HERE%" >nul

"%CSC%" /nologo /unsafe /target:winexe /platform:x64 /optimize+ /out:"%HERE%PetCat.exe" "%HERE%PetCat.cs" "%HERE%Shell.cs" /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:"%HERE%wv2\lib\net462\Microsoft.Web.WebView2.Core.dll" /r:"%HERE%wv2\lib\net462\Microsoft.Web.WebView2.WinForms.dll"
if %errorlevel%==0 (echo BUILD OK: %HERE%PetCat.exe) else (echo BUILD FAILED & exit /b 1)
