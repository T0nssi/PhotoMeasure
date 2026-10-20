# Photo Measurement – portable program

Measure parts from phone photos. Two reference holes on the part give the scale and the position. You build a measurement program (OMM-style) once on a master photo. Then you measure many photos at once and export Excel, PDF or Word reports in English, Thai or both.

Version 0.6.0. Concept: "Photo Measurement Program – Concept Design" in the Laser Marking Conception project.

## Start

1. Unzip the folder anywhere, for example on a USB stick.
2. Double-click `index.html`. Chrome or Edge is recommended.
3. On the first start, create the admin account. Then create a program, save it to the library, and add operators in the Users tab.

**With an industrial camera (v0.5):** start `Start PhotoMeasure Camera.cmd` one folder up instead. The **Camera Bridge** opens the same program at `http://127.0.0.1:5090` and adds a **📷 Camera** tab (see *Industrial camera* below and `CameraBridge/README.md`).

There is no installer, no server and no internet. All libraries are in `lib/`, and the photos never leave the PC. The first start takes about 2 s while the vision engine (OpenCV) loads.

```
PhotoMeasure\
  index.html          the program
  css\ js\            program code
  lib\                OpenCV.js, ZXing (DataMatrix), ExcelJS, jsPDF, docx, exifr
  examples\           example program (Bracket DZZ0.pm.json) + sample photos
```

## Work instruction (Help tab)

- The **Help** tab is an illustrated work instruction in **Thai and English**; it follows the language selector in the header.
- It has 9 sections: workflow, login, admin program set-up, operator measuring, fixing ERR, reports, photo rules, troubleshooting and the industrial camera.
- 25 screenshots with numbered red callouts (`help/th`, `help/en`) match the numbered steps.
- **🖨 Print / Save as PDF** prints it as an A4 document (about 16 pages).

## Maintenance and self-test (offline)

- **`maintenance.html`** – maintenance guide in Thai and English: code map, how to find the code behind a button, safe change workflow with Git, 15 common change recipes, reading errors (F12 / bridge log / Diagnose.cmd), release checklist and rollback, rebuilding the Camera Bridge offline (`CameraBridge\Build-Bridge.cmd`).
- **`selftest.html`** – one-click offline test: measures 3 reference photos with a fixed program and compares every value with the golden results (±0.01 mm, ΔE ±0.5, texts and OK/NG exact), tests the station calibration (synthetic dot-grid plate, a part image turned 12° and shifted, the blocks for wrong images), builds all 4 reports and checks the Camera Bridge, the camera driver (pylon or Hikrobot MVS) and a camera grab. It detects e.g. a 0.5 % error in the diameter calculation. Run it before and after every change and before every release.
- Both are linked in the **Users** tab.

## Industrial camera (v0.5)

A Basler USB 3.0 camera (tested target: acA4600-10uc) is connected through the **Camera Bridge**, a small local .NET program in `..\CameraBridge`. It uses the Basler pylon .NET API and serves this app at `http://127.0.0.1:5090` (this PC only).
Since bridge 0.6.0 it also connects **Hikrobot (Hikvision machine vision) GigE / USB3 cameras** through the Hikrobot MVS runtime. See `..\CameraBridge\README.md`.

| Function | Where | Who |
|---|---|---|
| Camera setting: list, connect / disconnect, auto-reconnect, info (model, serial, firmware, temperature, driver, USB speed or GigE IP), camera name, settings file export/import (Basler `.pfs`, Hikrobot `.mfs`), user sets and start-up set | 📷 Camera tab → Camera card, Camera setup card | Admin |
| Camera setup: exposure, gain, black level, gamma, pixel format, white balance (R/G/B, *Auto once*), image area (ROI, mirror X/Y, binning), frame rate, shutter mode, trigger, Line2 output. Only settings the camera has are shown, with its real limits. Histogram with over-exposure, focus value | Camera setup card | Admin |
| **Save to program**: camera settings are stored in the part program and applied when the program is selected; **📷 Grab master** takes the master image from the camera | Camera setup card · Program tab | Admin |
| Live view (zoom, crosshair, grid, over-exposure in red, master overlay and master REF circles), freeze | 📷 Camera tab | All |
| **📷 Grab** (button, Space key, foot switch): full-resolution image → measured with the selected program → big OK/NG banner; the image goes into the Measure list and the reports | 📷 Camera tab, Measure tab | All |
| Hardware trigger (TriggerMode On, Line1): every triggered image is measured (**Auto**) | 📷 Camera tab | All |
| Record images: save image, sequence (N images every T s), auto-save after measuring (all / NG only, image and/or result picture), file-name pattern, folder per day, keep-days, list and re-measure recorded images | Record card | All (settings: Admin) |

- Camera images are measured at full resolution (up to 6000 px); the bridge keeps every grab for 7 days (`data\shots`) so photos can be re-measured and reported without holding them in browser memory.
- **Users and programs:** the browser keeps data per address, so `index.html` and `http://127.0.0.1:5090` have separate users and libraries. Move them once with **⬇ Backup (users + programs)** in the Users tab and **⬆ Restore a backup** on the first-start login screen.
- `index.html` opened as a file still works without the bridge (phone photos). If the bridge runs, the file version can use the camera too.

## Station calibration – measuring without REF holes (v0.5.3)

For a **fixed camera station** (camera distance, lens and focus never change) the scale can come from a calibration made once, instead of reference holes in every image.

1. **Calibrate** (📷 Camera tab → *Station calibration*, admin): put a certified **dot-grid plate** (square pattern, known pitch) at the height of the measured part surface, focus, **📷 Grab plate** (or *Load plate image*). The result shows the scale (µm/px, px/mm), X/Y scale, squareness, dot error RMS/max, lens distortion at the corner and plate coverage, with a picture of the dot errors. **Save calibration** stores it on this PC for the camera serial number (`localStorage pm.stations`, included in the backup file), with the image size, camera image-area settings, date, user and validity (days). A ring / pin gauge of known Ø can be used instead (less accurate).
2. **Daily check**: grab the plate again → *Check against saved* (limit ±0.05 %, logged in the history of the calibration).
3. **Program**: Reference = *Fixed calibration (station, no REF holes)*, choose the station and the part position:
   - *Fixture* – the part is always at the same place (no search, fastest);
   - *Search position* – the part may be shifted;
   - *Search position + rotation* – shifted and turned.
   The part is found by matching edges of the master's report area (coarse-to-fine), then refined on the program's circles (and lines). The origin of the program is the image centre (◎ REF1 moves it); set the **datum** on part features for X/Y values.
4. **Protection**: no calibration, another image size (ROI / binning) or another camera → **FAIL**; calibration expired → **CHECK**; part larger / smaller than the master (height, distance, focus changed: > 1 % on circle spacing or > 4 % on a diameter) → **CHECK**; image does not match the master → **CHECK**.

Accuracy depends on the plate and the set-up: the part surface must be at the plate's height (or use a telecentric lens), and the camera must be square to the part.

## Trained character reader – Training tab (v0.6.0)

When the built-in OCR (Tesseract) misreads your marks, teach the program your own characters.

1. **Part program:** one 🔤 Text (OCR) box per text line, a small margin, no 2D code or part edge inside; correct format (e.g. `AAA9`).
2. **Collect:** Measure tab → **💾 Save characters** (this photo), or Training tab → tick **Save characters of every measured photo**. The element properties have a 💾 button for the master too. Each character is cut out (own segmentation: flat-field, Otsu, row/column profiles, dot-peen gaps joined, part edges dropped) and stored as a 32×32 image with a small picture. Its label comes from the reading only if the number of characters matches, the format is met and the confidence is ≥ 60 %; otherwise `?`.
3. **Check labels (Training tab):** filter by program/element, label, state, source. Click an image and type the character (sets the label as checked and moves on), Enter = correct, Delete = delete, Shift/Ctrl-click for many. Import image files or a folder (`A/001.png`), or a data file. After a first training, the filter **Reader disagrees with label** shows the probably wrong labels; **🤖 Pre-label** fills `?` labels.
4. **Train:** small neural network (1024 → 64/128/256 → characters) in a Web Worker, Adam, augmentation (rotation, size, shift, contrast, noise), early stopping on the validation set. Split per character 70 % training / 15 % validation / 15 % test (fixed seed). Result: accuracies, chart per epoch, how high the real error rate may still be, confused pairs, test mistakes (click to check).
5. **Use:** readers table → choose the text element → **Use in program**, or the element's *Reader* select. **Save the program to the library.** Readers stay on this PC (IndexedDB `pm-train`); move them with **⬇ Export reader** / **⬆ Data / reader…**; back up the images with **⬇ Export data**. **Test on new images** measures accuracy on images the reader has never seen.

The file version (index.html) and the Camera Bridge version (http://127.0.0.1:5090) keep separate storage, like programs and users: move character data and readers with Export / Import.

Reading with a trained reader takes about 20–60 ms per text box (Tesseract: 0.3–2 s). The format still applies: each position chooses the most likely allowed character; extra blobs are dropped by the format length.
Limits: one text line per box gives the best result (two lines without anything between them work with *Lines: several*); the reader answers only with characters it was trained on.

## Processing time (v0.5.3)

Every measured image gets a time per step (ms): queue, grab / wait / convert (camera: button → image, from the bridge), transfer, load, circles, align, prep, tools, ocr, code, judge, sn, display, **total** (in the app) and **cycle** (camera: button → result).

- Measure tab → photo info row **Time** (hover for all steps); Camera banner and status bar show the last cycle time.
- Measure tab → **⏱ Processing time**: n / average / 95 % / max per step for this session, **cycle-time limit** (warning with the slowest step), **⬇ CSV**.
- With the Camera Bridge every row is also appended to `CameraBridge\data\logs\timing-YYYY-MM-DD.csv` (switch *Log to the bridge*).
- The Self-Test shows the time of each test photo.

## Workflow

### 1 · Part program

1. **Load master photo.** Use a sharp photo, taken straight from above.
2. **◎ REF1:** click inside reference hole 1. Then **◎ REF2:** click inside hole 2.
   - Yellow circles show the holes the program found.
3. Enter **REF1 Ø** and **REF2 Ø** from the drawing (mm). You can also enter the REF1–REF2 distance from the drawing. If you leave it empty, it is calculated from the master photo.
4. Add measuring tools by drawing on the photo. Each tool searches for an edge inside its dashed search area.

   | Tool | How to draw | Result |
   |---|---|---|
   | ○ Circle | drag from the centre to the edge | circle (Ø, centre, roundness) |
   | ◜ Arc | click 3 points on the arc | circle from part of a contour |
   | ／ Line | drag along the edge; the arrow shows the scan direction | line (angle, straightness) |
   | ✛ Edge point | drag across the edge | point |
   | ▦ 2D code area | drag from the code centre to a corner | serial number from the DataMatrix |
   | ▭ Report area | drag a rectangle | crop of the picture in reports |

   Click a tool in the Elements list to edit it:
   - search area numbers (mm)
   - edge polarity: any, dark→bright, bright→dark
   - edge choice: strongest, first, last
   - threshold, number of scan lines, outlier removal, flip direction, redraw

5. **Construct** new elements from existing ones:
   - midpoint
   - intersection of 2 lines
   - perpendicular foot
   - line through 2 points
   - circle through 3 points
   - parallel, perpendicular, bisector
6. **Dimensions:** distance (XY / X only / Y only), X, Y, diameter, radius, angle, area, roundness, straightness, parallelism, perpendicularity, position (Ø), concentricity (Ø).
   - Nominal is pre-filled from the master; set **Tol + / Tol −**.
   - Form checks use an upper limit only.
7. **Datum:** reported X/Y are measured from the origin element (default REF1), with the X axis toward REF2 (or along a line) and Y up or down.
8. **Save program** to a `.pm.json` file. This file includes the master photo.
   - The last program is also kept automatically in the browser.
   - Use **Open program…** to load a saved file.

### 2 · Measure photos

1. **Add photos…** (or drag and drop). You can add many at once.
2. For each photo the program:
   - finds REF1/REF2 (circle detection, size and spacing ratios, and image matching with the master to resolve 180° turns);
   - rotates and scales the photo into the master view (**Aligned**);
   - runs all tools and checks the tolerances;
   - reads the DataMatrix; the serial becomes the photo name and can be edited;
   - takes the date/time from EXIF, or the file date if there is none.
3. Review the photos:
   - **◀ ▶** or the arrow keys move between photos.
   - **Same view for all** keeps the zoom and position, so you compare the same spot on every part.
   - **Original** shows the photo as taken.
   - **Rotate 90°** turns the view.
4. Status:
   - **OK** / **NG** by tolerances.
   - **CHECK** when an element failed or the alignment is doubtful. This happens when the reference diameters disagree with the spacing by more than 8 %, or the match with the master is below 0.35 (wrong part, wrong hole, strong tilt).
5. To fix references:
   - **Swap REF1/REF2**;
   - **Pick REF1, REF2 by hand** (click both holes);
   - **Auto find refs** to go back to automatic.
6. After changing the program, press **Re-measure all**.

### 3 · Report

Set the inspector, company/department, language (English / ไทย / both), which photos to include, and the picture type (aligned report area, or the whole photo).

| Format | Content |
|---|---|
| Excel (.xlsx) | Summary sheet (one row per piece; nominal and tolerance rows; NG cells red). One sheet per photo with the annotated picture and dimension table. A Data sheet in long format for pivot tables |
| PDF | Summary page, then one page per photo: info, annotated picture, dimension table with OK/NG |
| Word (.docx) | Same content as the PDF, editable. Font Tahoma, so Thai displays correctly |
| CSV | One row per photo (UTF-8 with BOM, so Excel opens Thai correctly) |

Pictures show:

- cyan: reference circles
- green: OK
- red: NG
- magenta: dimension lines
- yellow dots: detected edge points

## Adjusting the image processing (new in 0.2)

| Setting | Where | What it does |
|---|---|---|
| Reference: 2 circles / 1 circle | Part program ▸ Part & reference circles | 2 circles: scale from REF1–REF2 spacing (checked against both diameters). 1 circle: scale from the REF1 diameter only; no cross-check, so 1 px error on the diameter = 100 ÷ (Ø in px) % scale error |
| Rotation from | same card | REF1→REF2 direction (2 circles) · a measured **line** (its direction) · an **edge point / circle** (direction REF1 → it) · **image match** with the master (search 360°, then 0.25° steps) · **none** (photo orientation kept, for a jig). With an element, the program first aligns roughly, measures the element, and turns the frame until the element has the same angle as on the master |
| Colour channel, brightness, contrast, gamma, auto levels, invert | Image processing card | Builds the gray image that **all** detection uses. A colour channel can separate a part from a coloured background. Tick **Processed image** to see the result |
| Match brightness to master | Image processing card | After alignment, scales the brightness/contrast of the part area to the master before the edges are searched (for photos taken in different light) |
| Circle detection | Image processing ▸ details | Roundness, axis ratio, radius range, blur, threshold blocks and offset, Canny limits, work size. Use when a reference hole is not found |
| Reference circle fit | Image processing ▸ details | Search ring (× r), edge threshold, number of rays for the sub-pixel REF fit |
| Search areas | Part program: select a tool, drag its handles (● move, ■ size, band, arc ends). Measure photos: **Adjust search areas** | Program areas change for all photos; in Measure photos the change is for that photo only (reported as "search area adjusted by hand"), with **Copy to program** to keep it |
| Image adjust (this photo) | Measure photos side panel | Brightness/contrast/gamma for one photo, on top of the program settings. **Match master** sets them from the comparison |
| Compared with master | Measure photos side panel, reports | Brightness, contrast, colour ΔE, size (px/mm → camera distance ratio), sharpness, rotation vs the master. Values are of the photo as taken |
| Master overlay | Measure photos toolbar | Blends the master over the aligned photo to check alignment and shape |
| Dark / light screen | ◐ in the header | Remembered per PC |

Tested on the sample photos:

- 1 circle + rotation from a line: REF1–C1 = 24.231 – 24.254 mm on 5 photos turned −70° … +160°.
- The same with rotation from image match: 24.230 – 24.254 mm.
- A copy 37 % darker, 1.39× farther and tinted was flagged in the comparison (brightness −37 %, contrast ×0.58, ΔE 15, size 72 %).
- "Match master" brought its line angle back in line with the other photos.

## Users, program library, ERR fixing and colour points (new in 0.3)

### Users and roles

- On the first start, the program asks you to create the **admin** account. After that, everyone logs in with a user name and password.
- Admins can add users in the **Users** tab.

| Role | Can do |
|---|---|
| Admin | Everything: create and change part programs, image processing, save programs to the library, delete them, manage users, copy per-photo fixes into the program, teach colours |
| Operator | Select a program from the library (Measure photos ▸ Program), add photos and measure, fix ERR on a photo (search area, edge settings, Auto search), adjust one photo's image, make reports |

- Programs are saved to the **program library** with **Save to library**. Each save adds a new version.
- Operators only see programs from the library. The program file export/import is still there for backups and for moving programs to another PC.
- Users, passwords (salted SHA-256 hashes) and the library are stored in this browser on this PC. The program remembers each user's last program.
- The reports show who measured each photo.
- The roles keep users to their work, but they are not a security system: anyone who can open the browser's developer tools on that PC can get around them.

### When a workpiece shows ERR

1. Press **🔧 Fix** next to the ERR value. The program follows the dimension back to the measuring tool that failed (also through constructions such as midpoints), zooms to it, and opens **Adjust search areas**.
2. Do one of the following:
   - Drag the area onto the edge.
   - Change edge polarity, choice or threshold for this photo.
   - Press **Auto search**. It tries wider areas (circle band up to 4×, line width up to 3×, point scan up to 2.5×), lower thresholds (60 % and 35 %), polarity "any" and the other edge choices. It keeps the result closest to the master: same diameter within 30 %, same line angle within 9°.
3. The changes apply to that photo only and are listed in the warnings and the report. An admin can **Copy to program**.

A circle result is now rejected when its size does not fit the search area, or when fewer than 30 % of the scan lines found the edge. Before this change, a misplaced area could return a wrong circle instead of ERR.

### Colour points

1. **🎨 Colour point**: drag from the centre of a colour spot to the edge of the area to sample.
   - The mean colour on the master is taught as the reference.
   - A dimension **Colour ΔE ≤ 10** is added. ΔE is CIE L\*a\*b\* 1976.
2. **White/gray reference**: tick this on a colour point placed on a white or neutral gray area of the part (or on a gray card next to it). Each photo's colours are then scaled per channel so this point matches the master, which corrects most lighting and white-balance differences between phone photos.
3. **Colour difference ΔE (2 points)**: compares two colour points on the same photo, for example two parts of an assembly.
4. **Re-teaching (admin, Measure photos ▸ Colour points)**: from the selected photo, or from the average of all OK photos.

Tested:

| Photo | ΔE without white ref | ΔE with white ref |
|---|---|---|
| Rotated copy | 1.4 | 1.8 |
| 37 % darker, red-tinted copy | 23.1 | 3.2 |
| Copy with a yellow stain on the colour point | 28.8 | 30.4 (NG) |

Rough guide to ΔE: below 2 is hard to see; 2–5 is visible side by side; above 10 is clearly different. For phone photos, use a white reference and a tolerance of about 8–12.

## Text (OCR), specifications and report filters (new in 0.4)

### Text (OCR)

- **🔤 Text (OCR)**: drag a box around one line of marked text on the master.
- The text is read on every photo with Tesseract 5 (LSTM, English model). It runs **offline** inside the program: `lib/ocr-pack.js`, about 8 MB, is loaded the first time OCR is used.
- Preparation of the text area:
  - it is cut out along the part frame, so rotated photos read the same;
  - the light is evened out (background division);
  - it is read normal and inverted, gray and thresholded, at 2 sizes, and the most confident reading that fits the format is kept.
- **Format**: one character per position: `A` letter, `9` digit, `X` letter or digit, `?` any, anything else is literal. Example: `AAA9` for "DZZ0".
  - The first reading suggests the format.
  - The format limits the allowed characters and corrects look-alikes: a `7` where a letter must be becomes `Z`, an `O` where a digit must be becomes `0`, and so on.
- **Text direction**: normal, 90°, 180° or 270°, for vertical marking such as the MJEK/3KQ6 text.
- **Serial number from**: DataMatrix, a text area, "DataMatrix, else text", or the file name.
- Tested on the bracket: "DZZ0" (84–86 %) and "0022" (93–96 %) were read correctly on the master and on 4 copies rotated −70° … +162°. Both matched the DataMatrix through `{DM:0-4}` and `{DM:4-8}`.

### Specifications

Every dimension (and colour / text check) has a specification:

| Type | Kinds | Example | OK when |
|---|---|---|---|
| Numeric | nominal ± tolerance | `2.900 +0.05/−0.05` | inside the tolerance |
| Numeric | range | `2.85 … 2.95` | min ≤ value ≤ max (one side may be empty) |
| Numeric | > · < · ≥ · ≤ | `≥ 6.95` | the comparison holds |
| Numeric | = · ≠ | `= 4 ±0.01` | equal (or not equal) within eps |
| Numeric | info only | | — |
| Text | = · ≠ · contains · starts with · ends with | `= {DM:0-4}` | — |
| Text | regular expression | `^[A-Z]{3}[0-9]$` | the expression matches |
| Text | fits format | | the reading fits the OCR format |

- Colour ΔE uses the numeric kinds, for example range `0 … 5`.
- In text checks, `{DM}` is the DataMatrix text, `{DM:a-b}` is characters a to b−1 of it, and `{T1}` is the text of another text area.
- `Aa` ignores upper/lower case.
- Programs from earlier versions keep working: their nominal/tolerance values are used as "nominal ± tolerance" and ≤ limits.

### Report filters

- **Photos**: all · NG/CHECK only · OK only · selected photo.
- **Dimension values**:
  - all values;
  - NG values only (NG and ERR rows; the summary keeps only dimensions that are NG on at least one photo);
  - OK values only;
  - summary only (no photo pages or sheets).
- Reports show the specification for each dimension, plus the 2D code and the text readings for each photo.

## Photo rules (for usable results)

- The camera must be **parallel to the part**. Tilt makes circles into ellipses and breaks the scale. The "Ref. diameter check" shows how far the two hole sizes disagree with their spacing; above 3 % you get a warning.
- Aim for **≥ 20 px/mm** (minimum set per program). Fill the frame with the part and use the phone's 2× lens rather than moving close (less perspective).
- Use a plain contrasting background and soft, even light. Avoid glare on shiny metal.
- Features on a different height than the reference holes are scaled slightly wrong (perspective).
- The values are indicative. This is not a calibrated measuring instrument; validate against a CMM/OMM before you use it for acceptance.

## Verified in development

Tested in headless Chromium with the user's sample photos:

- Part A (bracket DZZ0, metal) found both holes and read DataMatrix `DZZ00022`.
- Part B (MJEK, plastic) found its 3 holes plus one embossed circle and read `MJEK3KQ6`.
- Program on part A: 2 circles, 2 lines, 1 arc, 2 constructed points, 12 dimensions.
- Copies of the master rotated by +25°, −160° and +70° and scaled 0.85–1.1× repeat the main dimensions within ≈0.05 mm. Examples:
  - REF1–REF2: same value, since it is the scale reference.
  - L1–L2 distance: 14.290 – 14.294.
  - C1 Ø: 4.00 – 4.05.
- Part B measured with the part A program gives **CHECK** (match 0.30, scale disagreement 22 %), not false OK/NG values.
- Excel, PDF, Word and CSV were generated and opened in LibreOffice; Thai text renders correctly.
- After reopening a saved program, the master values are identical.
- Trained reader (v0.6.0): 10 camera images of part A, 80 character images labelled in the Training tab (keyboard), reader of 4 characters trained in 1.6 s; the built-in OCR misread `0022` on 6 of 10 images (`4002`, `0224`), the trained reader read `DZZ0` / `0022` on 10 of 10 in ≈ 20 ms. Segmentation tests: tight and bold fonts, dot-peen dots, two lines, a dark part edge in the box.

## Not in this version

- Ellipse, slot and free-contour tools; tangent constructions. Build a slot from 2 lines + 2 arcs.
- Lens distortion / perspective correction (the station calibration measures distortion but does not correct it yet).
- OCR of Thai text (only the English/Latin model is included) and of very small text: aim for at least 20 px character height in the photo.
- Saving measured batches as a project file. Reports are the record; keep the photos.
- Trained readers for symbols other than single characters (logos, Thai text) and for several lines with a 2D code between them.
