// Runs your installed Kapps from decompiled code instead of its app.asar, with debuggers enabled.
//
//   node dev.mjs start [--patched]   launch Kapps with the main process inspectable on port 9229
//                                    and every window (overlays included) on port 9222. Runs from
//                                    decompiled/app, or with --patched from decompiled/patched:
//                                    stock Kapps with kapps-country-flags-patch.js applied
//   node dev.mjs patch               rebuild decompiled/patched from the current patch script; works
//                                    while Kapps is running, then reload the window (Ctrl+R)
//   node dev.mjs link [--patched]    just point the install at the decompiled code
//   node dev.mjs unlink              go back to the stock app.asar
//   node dev.mjs status
//
// Electron only falls back to a resources\app\ folder when there's no app.asar, so linking renames
// app.asar to app.asar.dev-disabled (untouched otherwise) until you unlink.
//
// Attach to 9229 with VS Code ("Attach to Kapps main process" in .vscode/launch.json) or
// chrome://inspect; open http://localhost:9222 in Chrome for the windows. Kapps uses your real
// settings either way. Edits take effect when you reload the window (Ctrl+R in its DevTools) or,
// for main-process code, when you restart Kapps.
import fs from 'fs';
import path from 'path';
import { spawn, execSync, execFileSync } from 'child_process';
import { findAppDir, findStockAsar, repoRoot, decompiledDir, isLink, extractAsar } from './shared.mjs';

const appDir = findAppDir();
const kappsExe = path.join(appDir, 'Kapps.exe');
const resources = path.join(appDir, 'resources');
const unpackedDir = path.join(resources, 'app.asar.unpacked');
const stockAsar = path.join(resources, 'app.asar');
const parkedAsar = stockAsar + '.dev-disabled';
const patchedApp = path.join(decompiledDir, 'patched');
const target = process.argv.includes('--patched') ? patchedApp : path.join(decompiledDir, 'app');
// Junctions resolve to their real path, so Kapps' own code sees __dirname = decompiled\<tree> and
// looks for its native libs and Python exes in decompiled\app.asar.unpacked — point that back.
const links = [
  { at: path.join(resources, 'app'), to: target },
  { at: path.join(decompiledDir, 'app.asar.unpacked'), to: unpackedDir },
];

function kappsRunning() {
  return execSync('tasklist /fi "imagename eq Kapps.exe" /fo csv /nh', { encoding: 'utf8' }).includes('Kapps.exe');
}

// Applies the patch to a copy of stock app.asar, the same way users run it, and extracts the result.
// A running Kapps holds its native libs open, so only the files that changed are copied over.
function patch() {
  const copy = path.join(decompiledDir, 'patched.asar');
  const fresh = path.join(decompiledDir, 'patched.new');
  fs.copyFileSync(findStockAsar(appDir), copy);
  // the patch installs the LMU bridge into the app.asar.unpacked next to the asar it patches: for this
  // copy that's the junction back to the install's
  if (!isLink(links[1].at)) fs.symlinkSync(links[1].to, links[1].at, 'junction');
  try {
    execFileSync(kappsExe, [path.join(repoRoot, 'kapps-country-flags-patch.js'), copy], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    extractAsar(copy, unpackedDir, fresh);
    for (const rel of fs.readdirSync(fresh, { recursive: true })) {
      const [from, to] = [path.join(fresh, rel), path.join(patchedApp, rel)];
      if (!fs.statSync(from).isFile() || (fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to)))) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  } finally {
    for (const f of [copy, copy + '.original-backup', fresh]) fs.rmSync(f, { recursive: true, force: true });
  }
  console.log(`Built ${patchedApp}`);
}

function link() {
  if (kappsRunning()) throw new Error('Kapps is running — quit it from the tray icon first.');
  if (target === patchedApp) patch();
  if (!fs.existsSync(path.join(target, 'package.json'))) throw new Error(`${target} is missing — run \`node decompile.mjs\` first.`);
  const want = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version;
  const installed = path.basename(appDir).slice(4);
  if (want !== installed) {
    throw new Error(`${target} is Kapps ${want} but the installed version is ${installed} — re-run \`node decompile.mjs\`.`);
  }
  for (const { at, to } of links) {
    if (isLink(at)) fs.rmSync(at);
    else if (fs.existsSync(at)) throw new Error(`${at} exists and isn't a link this script made — not touching it.`);
    fs.symlinkSync(to, at, 'junction');
  }
  if (fs.existsSync(stockAsar)) {
    if (fs.existsSync(parkedAsar)) throw new Error(`Both app.asar and app.asar.dev-disabled exist in ${resources} — sort that out by hand.`);
    fs.renameSync(stockAsar, parkedAsar);
  }
  console.log(`Linked: ${resources}\\app -> ${target} (app.asar parked as app.asar.dev-disabled)`);
}

function unlink() {
  if (kappsRunning()) throw new Error('Kapps is running — quit it from the tray icon first.');
  if (fs.existsSync(parkedAsar) && !fs.existsSync(stockAsar)) fs.renameSync(parkedAsar, stockAsar);
  for (const { at } of links) if (isLink(at)) fs.rmSync(at);
  console.log('Unlinked: Kapps will load its stock app.asar again.');
}

function start() {
  link();
  console.log('Main process: attach a debugger to localhost:9229   Windows: http://localhost:9222');
  // VS Code (itself Electron) sets ELECTRON_RUN_AS_NODE for processes it spawns, which would make
  // Kapps.exe run as plain Node instead of as Kapps.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Kapps' own logging (electron-log) goes to %APPDATA%\kapps\logs as usual; console output lands here.
  spawn(kappsExe, ['--inspect=9229', '--remote-debugging-port=9222'], { stdio: 'inherit', env });
}

function status() {
  const linked = isLink(links[0].at) && !fs.existsSync(stockAsar);
  console.log(`Install: ${appDir}`);
  console.log(linked ? `Running from: ${fs.readlinkSync(links[0].at)}` : 'Running from: stock app.asar');
  console.log(`Kapps running: ${kappsRunning() ? 'yes' : 'no'}`);
}

const commands = { start, patch, link, unlink, status };
const cmd = commands[process.argv[2] || 'status'];
if (!cmd) {
  console.error(`Usage: node dev.mjs ${Object.keys(commands).join('|')} [--patched]`);
  process.exit(1);
}
try {
  cmd();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
