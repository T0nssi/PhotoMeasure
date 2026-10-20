PhotoMeasure v0.6.0
===================
Phone photos only ............ open app\index.html (Chrome / Edge). No installation.
Industrial camera (Basler) ... install pylon (Developer) + ASP.NET Core Runtime x64 (8 or newer, 10 recommended),
                               then double-click "Start PhotoMeasure Camera.cmd" -> http://127.0.0.1:5090
Industrial camera (Hikrobot) . install Hikrobot MVS (x64) + ASP.NET Core Runtime x64, close the MVS client,
                               then double-click "Start PhotoMeasure Camera.cmd" (see CameraBridge\README.md, 1b)
Self-test (offline) .......... open app\selftest.html, press Run all tests - before and after every change.
Maintenance guide (TH/EN) .... open app\maintenance.html - how to find, change, test, release and roll back code.
New in bridge 0.6.0 ........... Hikrobot GigE / USB3 cameras (e.g. MV-CS200-10GC) through the Hikrobot MVS runtime.
New in 0.6.0 .................. Training tab: save the characters of the OCR boxes while measuring, check their
                               labels, train your own character reader and use it instead of the built-in OCR.
New in 0.5.3 .................. Station calibration (measure without REF holes, Camera tab -> Station calibration)
                               and processing time per step (Measure tab -> Processing time, CSV log).
Details: app\README.md (program) and CameraBridge\README.md (camera). Work instruction: Help tab (Thai / English).
