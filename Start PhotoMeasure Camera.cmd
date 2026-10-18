@echo off
rem PhotoMeasure with an industrial camera: starts the Camera Bridge and opens http://127.0.0.1:5090
setlocal
cd /d "%~dp0CameraBridge"
where dotnet >nul 2>nul || goto :noruntime
dotnet --list-runtimes | findstr /R /C:"Microsoft.AspNetCore.App [89]\." /C:"Microsoft.AspNetCore.App 1[0-9]\." >nul || goto :noruntime
title PhotoMeasure Camera Bridge
dotnet CameraBridge.dll %*
if errorlevel 1 pause
goto :eof
:noruntime
echo.
echo   The Microsoft ASP.NET Core Runtime (x64, version 8 or newer) is not installed.
echo   Install "ASP.NET Core Runtime - Windows x64 installer" (version 10 recommended),
echo   then start this file again.
echo.
start "" "https://dotnet.microsoft.com/download/dotnet/10.0"
pause
