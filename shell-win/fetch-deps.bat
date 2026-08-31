@echo off
rem Fetch build dependencies (one-time, ~50MB):
rem   roslyn\  = Microsoft.Net.Compilers.Toolset (modern C# compiler; the Win11 built-in csc is C#5 only)
rem   wv2\     = Microsoft.Web.WebView2 managed assemblies + native loader
rem Both are dev-side only. The shipped exe needs none of them (WebView2 runtime is in Win11).
setlocal
set HERE=%~dp0

curl -sL -o "%HERE%roslyn.zip" "https://api.nuget.org/v3-flatcontainer/microsoft.net.compilers.toolset/4.14.0/microsoft.net.compilers.toolset.4.14.0.nupkg"
powershell -c "Expand-Archive -Force '%HERE%roslyn.zip' '%HERE%roslyn-tmp'"
mkdir "%HERE%roslyn" 2>nul
powershell -c "Copy-Item -Recurse -Force '%HERE%roslyn-tmp\tasks\net472\*' '%HERE%roslyn\'"
rmdir /s /q "%HERE%roslyn-tmp" & del "%HERE%roslyn.zip"

curl -sL -o "%HERE%wv2.zip" "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4191.47/microsoft.web.webview2.1.0.4191.47.nupkg"
powershell -c "Expand-Archive -Force '%HERE%wv2.zip' '%HERE%wv2'"
del "%HERE%wv2.zip"

echo DEPS OK
