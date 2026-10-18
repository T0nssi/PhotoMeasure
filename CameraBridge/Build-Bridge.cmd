@echo off
rem Rebuilds CameraBridge.dll from source\CameraBridge (needs the .NET 8 SDK x64 or newer; works offline).
setlocal
cd /d "%~dp0"
where dotnet >nul 2>nul || goto :nosdk
dotnet --list-sdks | findstr /R /C:"^[89]\." /C:"^1[0-9]\." >nul || goto :nosdk
echo Building the Camera Bridge... (close the running Camera Bridge first)
dotnet publish "source\CameraBridge\CameraBridge.csproj" -c Release -o "%~dp0." --nologo -p:SatelliteResourceLanguages=en
if errorlevel 1 goto :failed
del /q web.config nuget.config CameraBridge.pdb 2>nul
echo.
echo   Build succeeded. Start the bridge again and run app\selftest.html
echo.
pause
goto :eof
:failed
echo.
echo   BUILD FAILED - read the first "error" line above: file(line,column): error code: message
echo   Undo your last change if you cannot fix it (see app\maintenance.html, section 5).
echo.
pause
goto :eof
:nosdk
echo.
echo   The .NET SDK (8 or newer, x64) is not installed. It is only needed to rebuild the bridge.
echo   Install it from the offline installer (dotnet-sdk-8.x-win-x64.exe) and run this file again.
echo.
pause
