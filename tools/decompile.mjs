// Regenerates decompiled/ from your local Kapps install so its code can be read, searched,
// edited and debugged. Nothing it writes is committed (decompiled/ is gitignored) — it's
// Kapps' own code, rebuilt locally from whatever version you have installed.
//
//   decompiled/raw/      app.asar extracted byte-for-byte (minified, exactly what ships; this is
//                        what kapps-country-flags-patch.js's anchor strings must match)
//   decompiled/app/      the same tree, unminified and pretty-printed but otherwise unchanged, so
//                        Kapps can run straight from it (see tools/dev.mjs)
//   decompiled/modules/  every webpack bundle split back into its individual modules, for reading
//
// Usage (from tools/, after `npm install`):  node decompile.mjs [path\to\app.asar]
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import prettier from 'prettier';
import { webcrack } from 'webcrack';
import { findAppDir, findStockAsar, decompiledDir, emptyDir, extractAsar } from './shared.mjs';

// Binary/asset folders that are copied as-is.
const SKIP_DIRS = ['iRacingBrowserApps', 'libs', 'fonts', 'img'];

// Webpack's module ids are hashes of each module's source path, so they're the same in every
// bundle that includes the module and stable across Kapps versions as long as the file isn't
// moved. Names for Kapps' own main-process modules (index.js), worked out by reading them; the
// renderer's modules mostly name themselves via angular.module("...").
const MODULE_NAMES = {
  56: 'settings',
  162: 'firewall-rules',
  638: 'utils',
  1425: 'racing-overlay-layers',
  2850: 'standings-settings-migration',
  3500: 'auto-updater',
  4413: 'gamepad',
  4472: 'tray',
  5286: 'overlays-data',
  5936: 'account',
  6150: 'overlay-url-params',
  7308: 'windows',
  7427: 'ir-browser-app-process',
  8583: 'deep-merge',
};

const readable = (code) =>
  webcrack(code, { unpack: false, deobfuscate: false, unminify: true, jsx: false, mangle: false }).then((r) => r.code);

async function prettify(code, file) {
  const ext = path.extname(file);
  if (ext === '.js') {
    let out;
    try {
      out = await readable(code);
      new vm.Script(out, { filename: file }); // syntax check only
    } catch (e) {
      console.warn(`  ! unminify failed for ${file}, pretty-printing only: ${e.message}`);
      out = code;
    }
    return prettier.format(out, { parser: 'babel' });
  }
  // 'strict' never adds or removes whitespace that could change how inline elements render.
  const opts = { '.html': { parser: 'html', htmlWhitespaceSensitivity: 'strict', printWidth: 120 }, '.css': { parser: 'css' } }[ext];
  if (!opts) return null;
  try {
    return await prettier.format(code, opts);
  } catch (e) {
    console.warn(`  ! left ${file} as-is, prettier can't parse it: ${e.message.split('\n')[0]}`);
    return null;
  }
}

// Splits one webpack bundle into decompiled/modules/<bundle>/: Kapps' own modules at the top level,
// npm libraries under lib/, and requires of Node/Electron built-ins restored to their real names.
async function splitBundle(code, relPath) {
  const result = await webcrack(code, { unpack: true, deobfuscate: false, unminify: true, jsx: false, mangle: false });
  if (!result.bundle) return 0;
  const outDir = path.join(decompiledDir, 'modules', relPath.replace(/\.js$/, ''));
  const modules = [...result.bundle.modules.values()].map((m) => ({ id: String(m.id), isEntry: m.isEntry, code: m.code }));

  const externals = {}; // id -> require() name, for modules that just re-export a built-in
  for (const m of modules) {
    const ext = /^module\.exports = require\(\/\*webcrack:missing\*\/"\.\/(.+?)\.js"\);?\s*$/.exec(m.code);
    if (ext) externals[m.id] = ext[1].startsWith('libs/') ? `./${ext[1]}` : ext[1];
  }

  const files = {}; // id -> path relative to outDir
  const taken = new Set();
  for (const m of modules) {
    if (externals[m.id]) continue;
    // CoffeeScript-compiled Kapps modules assign straight to variables hoisted into the bundle's
    // outer scope, so their first real statement is a bare assignment; npm libraries never do that.
    const body = m.code.replace(/^(var [\w$]+( = (\[\]\.indexOf|\{\}\.hasOwnProperty|\[\]\.slice))?;\n)+/, '');
    m.kapps = m.isEntry || (/^(\(\{|[A-Za-z_$][\w$]* = )/.test(body) && !body.startsWith('__WEBPACK_AMD'));
    const ngName = /angular\.module\("([^"]+)",\s*\[/.exec(m.code)?.[1];
    let name = m.isEntry ? 'index' : MODULE_NAMES[m.id] || (m.kapps && ngName) || m.id;
    if (taken.has(name)) name = `${name}.${m.id}`;
    taken.add(name);
    files[m.id] = (m.kapps ? '' : 'lib/') + name + '.js';
  }

  const requiredBy = {};
  for (const m of modules) {
    if (!files[m.id]) continue;
    const from = path.posix.dirname(files[m.id]);
    let out = m.code.replace(/require\((\/\*webcrack:missing\*\/)?"\.\/([^"]+?)\.js"\)/g, (all, missing, target) => {
      if (missing) return `require("${target}")`;
      if (externals[target]) return `require("${externals[target]}")`;
      if (!files[target]) return all;
      (requiredBy[target] ||= []).push(files[m.id]);
      const rel = path.posix.relative(from, files[target]);
      return `require("${rel.startsWith('.') ? rel : './' + rel}")`;
    });
    try {
      out = await prettier.format(out, { parser: 'babel' });
    } catch {}
    const dest = path.join(outDir, files[m.id]);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
  }

  const rows = modules
    .filter((m) => files[m.id])
    .sort((a, b) => b.kapps - a.kapps || files[a.id].localeCompare(files[b.id]))
    .map((m) => `| ${files[m.id]} | ${m.id} | ${m.kapps ? 'kapps' : 'lib'} | ${m.code.length} | ${(requiredBy[m.id] || []).join(', ')} |`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, '_index.md'),
    `# ${relPath}\n\nSplit from \`decompiled/raw/${relPath}\`. Ids are webpack module ids (stable across bundles/versions).\n` +
      `Built-ins re-exported by stub modules: ${Object.values(externals).sort().join(', ') || 'none'}\n\n` +
      `| file | id | kind | bytes | required by |\n|---|---|---|---|---|\n${rows.join('\n')}\n`
  );
  return modules.length;
}

function walkFiles(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.includes(r)) out.push(...walkFiles(dir, r));
    } else out.push(r);
  }
  return out;
}

async function main() {
  // Decompile stock Kapps, not a copy already modified by kapps-country-flags-patch.js.
  const asarPath = process.argv[2] || findStockAsar(findAppDir());
  console.log('Source:', asarPath);

  const rawDir = path.join(decompiledDir, 'raw');
  const prettyDir = path.join(decompiledDir, 'app');
  emptyDir(path.join(decompiledDir, 'modules'));
  extractAsar(asarPath, path.join(path.dirname(asarPath), 'app.asar.unpacked'), rawDir);
  emptyDir(prettyDir);
  fs.cpSync(rawDir, prettyDir, { recursive: true });
  const version = JSON.parse(fs.readFileSync(path.join(rawDir, 'package.json'), 'utf8')).version;
  console.log(`Extracted Kapps ${version}`);

  let bundles = 0;
  for (const rel of walkFiles(prettyDir)) {
    const file = path.join(prettyDir, rel);
    const code = fs.readFileSync(file, 'utf8');
    const pretty = await prettify(code, rel);
    if (pretty == null) continue;
    fs.writeFileSync(file, pretty);
    if (rel.endsWith('.js')) {
      const n = await splitBundle(code, rel);
      if (n) {
        bundles++;
        console.log(`  ${rel} (${n} modules)`);
      }
    }
  }
  fs.writeFileSync(path.join(decompiledDir, 'VERSION'), version + '\n');
  console.log(`Done: decompiled/ now holds Kapps ${version} (${bundles} webpack bundles split into decompiled/modules/).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
