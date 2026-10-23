# Developer tools

Tooling for working on this patch: decompiling Kapps into readable code, running Kapps from that code, and attaching debuggers. People who only want to apply the patch don't need any of this.

The decompiled code is Kapps' own, so it is **never committed**. Everything lands in `decompiled/` (gitignored) and is rebuilt from your local install.

## Setup

Requires Node 22+ and Windows.

```
cd tools
npm install
node decompile.mjs
```

The decompile takes about 20 seconds. It uses the newest `%LOCALAPPDATA%\kapps\app-*` install. If the patch has been applied, it decompiles `app.asar.original-backup` instead, so you always get stock Kapps. You can also pass a path to an `app.asar`.

| Folder | What it is |
|---|---|
| `decompiled/raw/` | `app.asar` extracted byte-for-byte: minified, exactly as shipped. The anchor strings in `kapps-country-flags-patch.js` have to match this. |
| `decompiled/app/` | The same tree, unminified with [webcrack](https://github.com/j4k0xb/webcrack) and pretty-printed with Prettier. It behaves identically, so Kapps can run from it. |
| `decompiled/modules/` | Each of the 29 webpack bundles split into its modules. Kapps' own modules are at the top level, npm libraries are under `lib/`, and every bundle has an `_index.md`. |
| `decompiled/python/` | The Python backend (`server.exe` etc.), decompiled for reading only. See below. |

## Finding your way around

- **Kapps is written in CoffeeScript with AngularJS 1.8.** That's why the code has hoisted `var` lists and `[].indexOf` helpers.
- **Main process:** `modules/index/`. `index.js` is the entry point; the rest have descriptive names (`windows.js`, `racing-overlay-layers.js`, `settings.js`, `tray.js`, ...).
- **Overlays:** each one is a separate bundle under `modules/apps/server/...`. Fuel Calculator, for example, is `modules/apps/server/fuel-calc/fuel-calc/ir.fuel-calc.js`.
- **Module file names:**
  - Webpack module ids are hashes of the source path, so the same id means the same module in every bundle and every Kapps version. `5286` (`overlays-data.js`, the default settings for every widget) appears in most bundles.
  - Names come from `angular.module("…")` where a module defines one.
  - Otherwise they come from `MODULE_NAMES` in `decompile.mjs`. Add to it when you work out what a module does.
- **Telemetry:** every overlay connects to `ws://localhost:8182/ws`, served by the Python `server.exe`.

### Turning a change into a patch

`kapps-country-flags-patch.js` edits the minified files, not the pretty ones:

1. Work out the change in `decompiled/app/` (or read it in `modules/`).
2. Find the same code in `decompiled/raw/`. Searching for a nearby string literal is usually quickest.
3. Copy the exact minified text from `raw/` as the `mustReplace` anchor.

## Running and debugging Kapps from `decompiled/app`

```
node dev.mjs start               # run decompiled/app (quit Kapps from the tray first)
node dev.mjs start --patched     # run stock Kapps with kapps-country-flags-patch.js applied
node dev.mjs patch               # rebuild the patched copy while Kapps runs, then Ctrl+R the window
node dev.mjs unlink              # back to stock when you're done
node dev.mjs status
```

`--patched` is the loop for working on the patch itself. It applies the patch to a copy of stock `app.asar` exactly the way users run it, and extracts the result to `decompiled/patched/`. What you see is what ships. If an anchor no longer matches, the build fails the same way the patch would for a user.

**What `start` changes in the install.** Electron only loads a `resources\app\` folder when there's no `app.asar`, so `start` (via `link`):

- renames `resources\app.asar` to `app.asar.dev-disabled`;
- adds a `resources\app` junction pointing at `decompiled\app` (or `decompiled\patched`);
- adds a `decompiled\app.asar.unpacked` junction pointing back at the install, so Kapps still finds its native libs and Python exes.

`unlink` reverses all three. While linked, the install runs your working copy. Applying the patch won't work then, because there's no `app.asar` for it to find.

**Debugging:**

- **Main process:** inspector on port 9229. Use "Attach to Kapps main process" in `.vscode/launch.json`, or `chrome://inspect`.
- **Windows and overlays:** open `http://localhost:9222` in Chrome, or use "Attach to Kapps window".
- **Seeing your edits:** edits under `decompiled/app/apps/...` show up when you reload that window (Ctrl+R in its DevTools). Main-process edits need a Kapps restart.
- Kapps uses your real settings (`%APPDATA%\kapps`) in this mode too.
- **Updates:** if Kapps updates itself, re-run `node decompile.mjs`. `dev.mjs` refuses to link a decompile that doesn't match the installed version.

## Python backend

`decompile-python.py` decompiles Kapps' own modules out of the cx_Freeze `library.zip`: `server`, `chat`, `betbot`, `bettertp`, `irsdk`, `update`. The bytecode is Python 3.10, so it needs a [pycdc](https://github.com/zrax/pycdc) built with `pycdc-py310.patch`. Build steps are at the top of the script.

The output is for reading only. pycdc gets some `try/except` ordering and boolean conditions wrong, so check anything that matters against the `_disasm/` files next to it. `irsdk` is kutu's open-source [pyirsdk](https://github.com/kutu/pyirsdk) 1.3.7, so read the upstream source for that one.
