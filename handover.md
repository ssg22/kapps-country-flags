# Handover: testing on the sim-racing PC

Everything below was built and checked on the dev PC against a **simulated** Le Mans Ultimate session. This list covers what still needs the real game, the real iRacing, and you.

## 1. Get the latest patch onto the sim PC

Nothing from the LMU work or the Standings column titles has been committed yet.

- [ ] Wait until the pending code-review fixes are in, so you copy the final version.
- [ ] Pick one of these:
  - Ask Claude to commit and push, then `git pull` on the sim PC.
  - Or copy these two files into one folder on the sim PC:
    - `kapps-country-flags-patch.js`
    - `apply-country-flags-patch.bat`

## 2. Apply it

The patch edits the current `app.asar`. **If an older version of this patch is already applied, restore the stock file first**, or the patch will stop with an anchor error:

- [ ] Quit Kapps from the tray icon (**Quit Kapps**, not just closing the window).
- [ ] Only if an older patch is applied:
  1. Go to `%LOCALAPPDATA%\kapps\app-<version>\resources\`.
  2. Delete `app.asar`.
  3. Copy `app.asar.original-backup` and rename the copy to `app.asar`.
- [ ] Run `apply-country-flags-patch.bat` and check that it ends with **"Patched successfully!"**.
- [ ] Relaunch Kapps.

The patch is verified against Kapps 1.24.36, 1.24.38 and 1.24.40. If the sim PC has a different version and the patch stops with an error, send Claude the error message.

## 3. Le Mans Ultimate: first run

- [ ] In LMU, turn on **Settings → Gameplay → Enable Plugins**. This is how Kapps gets LMU's telemetry.
- [ ] In Kapps, open the **LMU** tab (under the iRacing icon) → **Racing Overlay**. LMU keeps its own profiles, separate from iRacing's.
- [ ] Start a session in LMU and open some widgets. Every widget except Track Map and Tyres should work.
- [ ] If nothing shows, check `%APPDATA%\kapps\iRacingBrowserApps\lmu.log`. It should say `Le Mans Ultimate bridge on port 8187` and then `LMU connected`.

## 4. LMU: things only the real game can confirm

These were built to match TinyPedal and the shared memory docs, but only tested against simulated data. Note anything that looks wrong; a screenshot is best.

### Standings
- [ ] Classes are grouped and coloured correctly: Hyper yellow, LMP2 blue, LMGT3 green, LMP2 (ELMS) pink, LMP3 purple, GTE orange. If any class comes out white, note its name as shown in LMU.
- [ ] Manufacturer logos, gaps, intervals and lap times look right, and the fastest lap is highlighted.
- [ ] **DMG** (damage) shows a sensible % after contact, and blank for undamaged cars.
- [ ] **FUEL** shows virtual energy in **blue** for cars that use VE (Hypercar; check whether LMGT3 does too), and fuel in **white** for LMP2.
- [ ] **TYRES** shows four dots per car (front left, front right / rear left, rear right): red soft, yellow medium, white hard, blue wet. Fit mixed tyres (e.g. softs front, hards rear) and check they show that way.
- [ ] There's no Rating column on LMU. That's expected until there's a source for Safety and Driver Rating (see section 6).
- [ ] **Column Titles** (Standings settings window → General): titles sit under each class header and line up with the columns.

### Relatives
- [ ] Every car shows, with class colours and gaps, and with no SOF, incidents or flags.

### Inputs and the rest
- [ ] Pedals and Inputs Graph: throttle, brake and **clutch** move the right way (the clutch was inverted to match iRacing).
- [ ] Steering turns the right way (left is left).
- [ ] Car Left/Right (spotter): cars alongside show on the **correct side**.
- [ ] Fuel Calculator: fuel in litres and per-lap usage look right. VE in the Fuel Calculator isn't done yet.
- [ ] Weather: air and track temperature, rain and wetness.
- [ ] Brake bias reads the same as in the car.
- [ ] Try both offline with AI and online multiplayer.

### New widgets (also check these in iRacing)
- [ ] **Delta Bar**: the number and bar follow your delta to your best lap, green when you're ahead (the bar fills right) and red when you're behind (it fills left). After the line, the finished lap's delta stays up for 3 s. In iRacing, also try the other "Compare to" laps.
- [ ] **Flags**: each badge appears only when it applies:
  - PIT timer on the pit lane, then the final time for 10 s;
  - LIMIT with the limiter on;
  - FUEL (or VE in LMU) when 2 laps or fewer are left;
  - READY / GREEN at a race start;
  - YELLOW / CAUTION, BLUE, LAST LAP / FINISH, BLACK FLAG / DSQ.
- [ ] Flags **traffic**: in a multiclass race, a faster class closing in shows its class and gap (e.g. HYPER 2.4s). Leaving the pits or rejoining from off track shows any car closing in. It should **not** show on the grid or while stopped in your pit box.
- [ ] Flags settings: add, remove and reorder badges, switch between side by side and stacked, and change the low-fuel laps and traffic gap.

## 5. iRacing: check nothing broke

- [ ] The Standings layer window opens, both with and without the Country Flag and Fastest Lap columns. A crash in that path was fixed on the way.
- [ ] Country flags show in Standings and Relatives.
- [ ] Column Titles on and off, with headers on and off, and with **Align** set to top, middle and bottom.
- [ ] The Standings settings window still offers the Flag, Joker and Tyre columns and SOF, and does **not** offer DMG or FUEL.
- [ ] Rejoin Helper and Weather work as before. Both were reworked to share code with the new Flags widget.
- [ ] Your iRacing profiles and layouts are unchanged.

## 6. Collect and bring back to Claude

Do these with LMU running. The main menu is enough for the first one; for the second you need to be in a car.

- [ ] **Swagger file** (lists every endpoint in LMU's local API, to find Safety and Driver Rating):
  ```powershell
  Invoke-WebRequest http://localhost:6397/swagger-schema.json -OutFile "$env:USERPROFILE\Desktop\lmu-swagger.json"
  ```
- [ ] **Where you see your Safety Rating and Driver Rating in the game**: which menu or screen, plus a screenshot.
- [ ] **One sample of the pit menu and damage data**, while in the car, for the planned pit-menu and damage features. A single call is fine; only rapid polling makes the in-game pit menu flicker.
  ```powershell
  Invoke-WebRequest http://localhost:6397/rest/garage/UIScreen/RepairAndRefuel -OutFile "$env:USERPROFILE\Desktop\lmu-repair-refuel.json"
  ```
- [ ] If anything failed, send:
  - `%APPDATA%\kapps\iRacingBrowserApps\lmu.log`
  - `%APPDATA%\kapps\logs\main.log`
  - screenshots

## Still to build (no action needed from you)

- Virtual energy in the Fuel Calculator
- Pit menu, aero and suspension damage, and max VE from LMU's API (needs the sample from section 6)
- MGU and Tyres widgets for LMU
- New Flat Spots and Damage widgets
- Safety and Driver Rating (needs the swagger file from section 6)
- README and LMU About page updates
