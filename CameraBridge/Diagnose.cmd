@echo off
rem Writes diagnostics.txt: pylon .NET API and Hikrobot MVS runtime found / loaded, versions, cameras found
cd /d "%~dp0"
echo Checking pylon, Hikrobot MVS and cameras...
dotnet --list-runtimes > diagnostics.txt 2>&1
dotnet CameraBridge.dll --diag >> diagnostics.txt 2>&1
notepad diagnostics.txt
