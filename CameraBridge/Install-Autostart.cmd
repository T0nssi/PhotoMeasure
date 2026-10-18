@echo off
rem Starts the Camera Bridge (minimized) when this Windows user logs on
set TARGET=%~dp0..\Start PhotoMeasure Camera.cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\PhotoMeasure Camera Bridge.lnk'); .TargetPath='%TARGET%'; .WorkingDirectory='%~dp0..'; .WindowStyle=7; .Save()"
echo Done: the Camera Bridge starts automatically after logon.
pause
