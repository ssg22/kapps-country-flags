// Helpers shared by decompile.mjs and dev.mjs.
import fs from 'fs';
import path from 'path';
import asar from '@electron/asar';

export const repoRoot = path.resolve(import.meta.dirname, '..');
export const decompiledDir = path.join(repoRoot, 'decompiled');

// Newest local Kapps install (%LOCALAPPDATA%\kapps\app-<version>), picking the version
// numerically for the same reason kapps-country-flags-patch.js does.
export function findAppDir() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'kapps');
  if (!fs.existsSync(base)) throw new Error(`Could not find ${base}. Is Kapps installed?`);
  const versionOf = (n) => n.slice(4).split('.').map((x) => parseInt(x, 10) || 0);
  const dirs = fs.readdirSync(base).filter((n) => /^app-\d/.test(n));
  if (!dirs.length) throw new Error(`No app-* folder found under ${base}.`);
  dirs.sort((a, b) => {
    const [va, vb] = [versionOf(a), versionOf(b)];
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) - (vb[i] || 0);
    }
    return 0;
  });
  return path.join(base, dirs[dirs.length - 1]);
}

// The stock app.asar: the patch script's backup if the install is patched, otherwise wherever
// dev.mjs may have parked it.
export function findStockAsar(appDir) {
  const asarPath = path.join(appDir, 'resources', 'app.asar');
  return [asarPath + '.original-backup', asarPath + '.dev-disabled', asarPath].find((p) => fs.existsSync(p));
}

export const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

// Empties dir rather than deleting it, since it may be the target of a dev junction. Antivirus and
// indexers briefly lock freshly written files on Windows, so deletes are retried on EBUSY & co.
export function emptyDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const ent of fs.readdirSync(dir)) {
    for (let attempt = 1; ; attempt++) {
      try {
        fs.rmSync(path.join(dir, ent), { recursive: true, force: true });
        break;
      } catch (e) {
        if (attempt >= 10 || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      }
    }
  }
}

// @electron/asar reads unpacked files from "<archive>.unpacked" beside the archive, which only
// exists for the real app.asar — so extract from a copy with the install's folder linked next to it.
export function extractAsar(asarPath, unpackedDir, outDir) {
  const copy = path.join(decompiledDir, 'extract.asar');
  fs.copyFileSync(asarPath, copy);
  if (!isLink(copy + '.unpacked')) fs.symlinkSync(unpackedDir, copy + '.unpacked', 'junction');
  emptyDir(outDir);
  try {
    asar.extractAll(copy, outDir);
  } finally {
    fs.rmSync(copy);
    fs.rmSync(copy + '.unpacked');
  }
}
