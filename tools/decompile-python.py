# Decompiles Kapps' own Python backend (server/chat/betbot/bettertp/irsdk/update) out of the
# cx_Freeze library.zip bundled in app.asar.unpacked. Python 3.10 bytecode, so this uses
# pycdc (github.com/zrax/pycdc) rather than uncompyle6/decompyle3, which stop at 3.8.
# Stock pycdc mishandles several 3.6+/3.10 opcodes (try/except, closures, keyword calls,
# f(*a, **kw)) and silently drops most of these files, so build it with tools/pycdc-py310.patch:
#   git clone https://github.com/zrax/pycdc && cd pycdc && git checkout b428976
#   git apply ..\path\to\tools\pycdc-py310.patch
#   cmake -S . -B build -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release && cmake --build build
#   (from an "x64 Native Tools" prompt; VS 2019 Build Tools works)
# Output is for reading, not running: control flow around try/except and some boolean
# conditions can come out wrong, so check anything that matters against the _disasm/ files.
# Usage:
#   set PYCDC_DIR=<folder containing pycdc.exe and pycdas.exe>
#   py -I tools\decompile-python.py [path\to\library.zip] [path\to\pycdc-dir]
# Output: decompiled/python/<module>.py, plus pycdas disassembly in decompiled/python/_disasm/
# to check against wherever pycdc's output is incomplete or wrong.
import os, re, subprocess, sys, zipfile
from pathlib import Path

# library.zip also contains the stdlib and third-party packages; these are the only top-level
# entries that are Kapps' own code. cx_Freeze flattens packages to "<pkg>__init__.pyc" /
# "<pkg>__main__.pyc", which we turn back into <pkg>/__init__.py etc.
OWN = re.compile(r'^(BUILD_CONSTANTS|irsdk|update|(server|chat|betbot|bettertp)__(init|main)__)\.pyc$')


def find_library_zip():
    base = Path(os.environ.get('LOCALAPPDATA', '')) / 'kapps'
    if not base.exists():
        sys.exit(f'Could not find {base}. Pass the library.zip path as an argument.')
    # Numeric component-wise sort, same as findAsar() in kapps-country-flags-patch.js.
    version_of = lambda p: [int(x) if x.isdigit() else 0 for x in p.name[4:].split('.')]
    dirs = sorted((p for p in base.iterdir() if re.match(r'app-\d', p.name)), key=version_of)
    if not dirs:
        sys.exit(f'No app-* folder found under {base}.')
    return dirs[-1] / 'resources' / 'app.asar.unpacked' / 'iRacingBrowserApps' / 'lib' / 'library.zip'


def out_name(pyc):
    m = re.match(r'^(\w+?)__(init|main)__\.pyc$', pyc)
    return f'{m[1]}/__{m[2]}__' if m else pyc[:-4]


def main():
    lib = Path(sys.argv[1]) if len(sys.argv) > 1 else find_library_zip()
    tools = Path(sys.argv[2] if len(sys.argv) > 2 else os.environ.get('PYCDC_DIR', ''))
    pycdc, pycdas = tools / 'pycdc.exe', tools / 'pycdas.exe'
    if not pycdc.exists() or not pycdas.exists():
        sys.exit(f'pycdc.exe/pycdas.exe not found in "{tools}". Set PYCDC_DIR or pass it as the 2nd argument.')
    out = Path(__file__).resolve().parent.parent / 'decompiled' / 'python'
    pyc_dir = out / '_pyc'
    print('Source library.zip:', lib)

    with zipfile.ZipFile(lib) as z:
        names = [n for n in z.namelist() if OWN.match(n)]
        for name in names:
            mod = out_name(name)
            pyc = pyc_dir / name
            pyc.parent.mkdir(parents=True, exist_ok=True)
            pyc.write_bytes(z.read(name))
            src, dis = out / f'{mod}.py', out / '_disasm' / f'{mod}.txt'
            src.parent.mkdir(parents=True, exist_ok=True)
            dis.parent.mkdir(parents=True, exist_ok=True)
            # pycdc writes partial output plus warnings to stderr; keep both in the .py so gaps are visible.
            r = subprocess.run([str(pycdc), str(pyc)], capture_output=True, text=True, errors='replace')
            warn = ''.join(f'# pycdc: {l}\n' for l in r.stderr.splitlines())
            src.write_text(warn + r.stdout, encoding='utf-8')
            r = subprocess.run([str(pycdas), str(pyc)], capture_output=True, text=True, errors='replace')
            dis.write_text(r.stdout + r.stderr, encoding='utf-8')
            gaps = r'Unsupported opcode|Decompyle incomplete|Unsupported Node'
            n_gaps = len(re.findall(gaps, src.read_text(encoding='utf-8')))
            print(f'  {mod}.py' + (f'  ({n_gaps} gap(s))' if n_gaps else ''))
    print(f'Done: {len(names)} modules -> {out}')


if __name__ == '__main__':
    main()
