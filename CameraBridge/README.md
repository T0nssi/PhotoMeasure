# PhotoMeasure Camera Bridge (v0.6.0)

The Camera Bridge is a small local program that connects an industrial camera to PhotoMeasure: a **Basler** camera (pylon) or, since 0.6.0, a **Hikrobot** camera (Hikvision machine vision, MVS).

- It serves the PhotoMeasure web app at **http://127.0.0.1:5090** and adds the **📷 Camera** tab:
  - camera connection and setup;
  - live view;
  - grab → measure;
  - recording.
- It talks to the camera through the **Basler pylon .NET API** (installed with pylon) or the **Hikrobot MVS runtime** `MvCameraControl.dll` (installed with MVS). Nothing from Basler or Hikrobot is shipped in this folder. A PC needs only the software of the camera brand it uses.
- It listens on **127.0.0.1 only**, so other PCs on the network cannot reach it.

## 1. Install (once per PC)

1. **Basler pylon Software Suite, Windows x64.** Choose the **Developer** profile, which includes the pylon .NET API (`Basler.Pylon.dll`). pylon 26.x was confirmed with the acA4600-10uc in pylon Viewer.
2. **Microsoft ASP.NET Core Runtime, x64, version 8 or newer.** Get the "ASP.NET Core Runtime – Windows x64 installer" from https://dotnet.microsoft.com/download/dotnet. **Version 10 (LTS) is recommended**, because .NET 8 support ends on 10 Nov 2026. The bridge runs on 8, 9 or 10.
3. Plug the camera into a **USB 3.0 port on the PC**, not into a hub.
4. Close **pylon Viewer**. Only one program at a time can open the camera.

### 1b. Hikrobot camera (instead of steps 1, 3 and 4)

Hikrobot area-scan cameras with **GigE Vision** or **USB3 Vision** (MV-CA, MV-CS, MV-CU, MV-CE … series). Not supported: Hikrobot smart cameras / vision sensors (MV-SC, ID series), which run their own tools and do not stream raw images, and Hikvision CCTV / IP security cameras.

1. Install the **Hikrobot MVS** software (Windows x64, version 3.x or 4.x, free from the Hikrobot website). It installs the camera runtime (`MvCameraControl.dll` in `C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64`) and the GigE / USB drivers.
2. Install the ASP.NET Core Runtime (step 1.2 above).
3. **GigE camera:** connect it to its own network card (1 Gbit, jumbo frames on if possible). In the **MVS client**, check that the camera is found and that its IP address is in the subnet of the network card (MVS shows a warning and can set the IP). **USB3 camera:** use a USB 3.0 port directly on the PC.
4. Check the image in the MVS client, then **close the MVS client**. Only one program at a time can open the camera.

The bridge finds the runtime through `%MVCAM_COMMON_RUNENV%` (set by the MVS installer) or the default folder. If it is somewhere else, set `mvsLibrary` in `bridge.config.json`. Basler cameras found by MVS are skipped (pylon handles them).

Notes for Hikrobot cameras:
- The settings use the standard GenICam names, so the setup panel looks the same. Real differences: the trigger input is usually **Line0** (opto-isolated), the trigger selector is `FrameBurstStart`, and the white-balance ratios are integers (1024 = 1.0).
- Settings files are MVS `.mfs` files (the ⬇/⬆ buttons show `.mfs`). The MVS client can read them too. A Basler `.pfs` file cannot be loaded into a Hikrobot camera, and the other way round.
- Camera settings saved in a part program belong to that camera brand. After changing the brand, set up the camera again and **Save to program**.

## 2. Start

Double-click **`Start PhotoMeasure Camera.cmd`** in the PhotoMeasure folder.

- A black window opens and shows the bridge log. Keep it open; closing it stops the bridge.
- Chrome or Edge opens `http://127.0.0.1:5090`.
- If the bridge is already running, the script only opens the page.

On the first start the browser has no users or programs at this address yet. Move them over once:

1. Open `app\index.html` as before.
2. In the Users tab, click **⬇ Backup (users + programs)**.
3. Open `http://127.0.0.1:5090`.
4. On the login screen, click **⬆ Restore a backup** and choose the backup file.

Other start scripts in the `CameraBridge` folder:

| Script | Use |
|---|---|
| `Install-Autostart.cmd` / `Remove-Autostart.cmd` | Start the bridge automatically when you log on to Windows (shortcut in the Startup folder, minimized). |
| `Start-Simulator.cmd` | Also offers a **simulated camera**, which plays the PNG/BMP images in `sim\`. Use it for training without a camera. Put your own recorded PNGs in `sim\`. |
| `Diagnose.cmd` | Writes `diagnostics.txt`: pylon assembly and Hikrobot MVS runtime found or not, versions, and cameras found. Send this file when something does not work. |

## 3. What the Camera tab does

The functions match the requirements in the integration plan:

1. **Camera setting.**
   - Choose a camera and connect or disconnect.
   - After an unplug the bridge reconnects automatically, and at start it connects to the default camera.
   - The info table shows model, serial, firmware, temperature, driver, and the USB speed (or the IP address of a GigE camera). It warns when a USB camera runs at USB 2 speed.
   - You can give each camera a name.
   - Export or import the camera settings as a file: pylon `.pfs` for Basler (pylon Viewer can also read it) or MVS `.mfs` for Hikrobot (the MVS client can also read it).
   - Save or load the camera's user sets, and choose the start-up set.
2. **Camera setup.**
   - Settings: exposure (time, auto once), gain, black level, gamma, pixel format, white balance (R/G/B, auto once, light preset), image area (width, height, offsets, center, Reverse X/Y, binning, decimation), shutter mode (Rolling / Global reset release), frame-rate limit, trigger (mode, source, edge, delay) and Line2 output.
   - Only the settings that the connected camera actually has are shown, with its real limits.
   - Settings that are locked while grabbing (for example Width or PixelFormat) are changed by pausing acquisition automatically.
   - Setup aids: a histogram with an over-exposure warning (over-exposed pixels are shown in red in the live view), and a focus value with a 15 s graph. Turn the lens until the value is highest.
   - **Save to program** stores the settings in the part program. They are applied when the program is selected.
   - **📷 Grab master** (Program tab) takes the master image from the camera and stores the camera settings at the same time.
3. **Record image.**
   - Save the current image, or record a sequence (N images, one every T s).
   - Auto-save after measuring: every image, or NG/CHECK only. It can save the raw image (PNG or BMP, lossless) and the result picture (JPEG with the measurements drawn).
   - File-name pattern: `{program} {serial} {status} {camera} {user} {date} {time} {ms} {n}`.
   - Files go into one folder per day. Old folders are deleted after the number of keep-days you set.
   - Recorded images are listed. Click **Measure** to measure one again.
4. **Grab and live mode.**
   - Live view at about 10 fps, scaled to the screen. You can zoom and pan, show a crosshair and a grid, and blend the master overlay with its REF circles to place the part.
   - **Freeze** holds the image.
   - **📷 Grab** (button, Space key or a USB foot switch that sends Space) takes a full-resolution frame. It skips one frame so that the exposure surely started after the click (rolling shutter). The frame is measured with the selected program and shown with a big OK/NG banner. The same Grab button is also on the Measure tab.
   - **Hardware trigger:** set TriggerMode On with source Line1. Every triggered frame is then measured when **Auto (trigger)** is ticked.

Admins see everything. Operators see the live view, Grab, Freeze, the result and recording.

## 4. Folders and settings

```
PhotoMeasure\
  app\                         PhotoMeasure web app (also works alone as app\index.html)
  CameraBridge\
    CameraBridge.dll …         the bridge (.NET 8, framework-dependent)
    bridge.config.json         settings (see below)
    data\shots\yyyy-MM-dd\     every grab as PNG (kept KeepShotDays, default 7) – used for re-measuring
    data\images\yyyy-MM-dd\    recorded images (or the folder set in the Record card)
    data\logs\                 bridge-yyyy-MM-dd.log, timing-yyyy-MM-dd.csv (processing time per image)
    sim\                       images for the simulator
    source\                    C# source (CameraBridge), FakePylon (test double of the pylon API) and FakeMvs (test double of the Hikrobot MVS runtime)
  Start PhotoMeasure Camera.cmd
```

`bridge.config.json`:

| Key | Default | Meaning |
|---|---|---|
| `port` | 5090 | Web port on 127.0.0.1. |
| `appDir` | `../app` | PhotoMeasure web app folder. |
| `dataDir` | `data` | Shots, recordings and logs. |
| `pylonAssembly` | "" | Full path of `Basler.Pylon.dll`, if it is not found automatically. The bridge searches `%PYLON_DEV_DIR%` and `C:\Program Files\Basler`. |
| `mvsLibrary` | "" | Full path of the Hikrobot `MvCameraControl.dll`, if it is not found automatically. The bridge searches `%MVCAM_COMMON_RUNENV%\Win64_x64` and `Common Files\MVS\Runtime\Win64_x64`. |
| `defaultCamera`, `autoConnect` | "", true | Serial number to connect at start (empty = first camera). |
| `simulator`, `simFolder` | false, `sim` | Offer the simulated camera. |
| `keepShotDays` | 7 | Days to keep grabs in `data\shots`. |
| `record` | | Record settings, also editable in the Camera tab: `folder`, `format` (png/bmp), `pattern`, `autoSave` (off/all/ng), `saveRaw`, `saveResult`, `keepDays`. |
| `cameraNames` | {} | Friendly names by serial number. |
| `openBrowser` | true | Open the page when the bridge starts. |

## 5. API (for maintenance)

Everything runs on `http://127.0.0.1:5090`:

- `GET /api/status`
- `GET /api/diag`
- `GET /api/cameras`
- `POST /api/cameras/open {id}`
- `POST /api/cameras/close`
- `POST /api/cameras/name {serial,name}`
- `GET|PUT /api/camera/features`
- `POST /api/camera/auto {what: exposure|gain|balance}`
- `POST /api/camera/userset {action: load|save|startup, set}`
- `GET|POST /api/camera/config` (.pfs, Hikrobot: .mfs)
- `POST /api/grab`
- `GET /api/shots/{id}`
- `POST /api/timing {cols, vals}` – appends one processing-time row to `data\logs\timing-YYYY-MM-DD.csv`

The grab answer (`POST /api/grab`) includes `timing: {waitMs, convertMs}` (request → frame, camera buffer → RGB) and `serial`.
- `POST /api/record {shotId? | count, intervalMs, vars}`
- `POST /api/record/stop`
- `POST /api/record/upload?name=`
- `GET /api/record/list?day=`
- `GET /api/files/{day}/{name}`
- `GET|PUT /api/settings`
- WebSocket `/ws`:
  - JSON events: `hello`, `state`, `stats`, `shot`, `record`, `error`;
  - binary live frames: a 24-byte header `PMLV`, then RGB data;
  - the client sends `{type:"live", on, maxDim, fps}`.

To rebuild from source, with the .NET 8 SDK installed: `cd source\CameraBridge` then `dotnet publish -c Release -o ..\..`.

## 6. Troubleshooting

| Symptom | Action |
|---|---|
| The start script says the ASP.NET Core Runtime is missing | Install it (step 1.2). |
| `pylon: Basler.Pylon.dll not found` | Install pylon with the Developer profile, or set `pylonAssembly`. Run `Diagnose.cmd`. |
| `…could not be loaded into .NET 8` | The installed pylon .NET API only supports .NET Framework. Install a current pylon version. Send `diagnostics.txt`. |
| No camera in the list | Close pylon Viewer / the MVS client, re-plug into USB 3.0 and press ↻. Check the camera LED. |
| `hikrobot: MvCameraControl.dll not found` | Install Hikrobot MVS (x64), or set `mvsLibrary`. Run `Diagnose.cmd`. |
| Hikrobot GigE camera not in the list, or no images | Open the MVS client: set the camera IP into the subnet of the network card, allow the camera in the Windows firewall, then close MVS. |
| `cannot open camera … access denied` | The MVS client or another program has the camera open. Close it. |
| `No image from the camera (timeout)` | TriggerMode is On, or the exposure is very long. Set TriggerMode Off. |
| USB shows *High speed (USB 2)* | Use a blue USB 3.0 port directly on the PC. |
| Colours look wrong or the image is too dark or bright | Use *Auto once* for white balance (white card in view) and for exposure. Then **Save to program**. |

## 7. Status of testing

- **Tested here:**
  - the bridge with the **simulated camera**, end to end in the browser: grab master → build the program → live view → camera settings → grab and measure → auto-save → sequence → measure tab → report → backup/restore → operator view → `file://` mode;
  - the **pylon driver** against a **test double of the pylon .NET API** (`source/FakePylon`): enumeration, settings with selectors (white balance R/G/B, trigger), value correction, auto once, user sets, `.pfs`, software and hardware trigger, and colour conversion.
- the **Hikrobot driver** against a **test double of the MVS C runtime** (`source/FakeMvs`, a small C library): enumeration (GigE info, IP), open / busy camera, settings with selectors (white balance R/G/B, Line2), integer increments, value clipping, settings that are locked while grabbing, auto once, user sets, `.mfs` export / import, software trigger, SDK colour conversion and the built-in fallback, live view and grab in the browser.
  To repeat it on Linux: `gcc -shared -fPIC -O2 -o libMvCameraControl.so source/FakeMvs/fake_mvs.c`, set `mvsLibrary` to that file, start the bridge (environment `FAKE_MVS_BUSY=1` simulates a camera used by another program, `FAKE_MVS_NOCONVERT=1` a runtime without pixel conversion).
- **Not tested yet: a real Hikrobot camera.** The structure layouts follow the 64-bit MVS C API; the first run on the station PC is the real test. If anything fails, run `Diagnose.cmd` and send `diagnostics.txt` and the bridge log.
- **Not tested yet: the real Basler acA4600-10uc.**
  - The first run on the station PC is the real test (phase P0/P1 of the plan).
  - If anything fails, run `Diagnose.cmd`, open **Diagnostics** in the Camera tab and send the log `data\logs\bridge-<date>.log`.
