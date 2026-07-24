# -*- mode: python ; coding: utf-8 -*-
import os

adb_files = []
platform_tools_dir = os.path.expanduser(r'~\AppData\Local\Android\Sdk\platform-tools')
files_to_bundle = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'libwinpthread-1.dll']

for fname in files_to_bundle:
    fpath = os.path.join(platform_tools_dir, fname)
    if os.path.exists(fpath):
        adb_files.append((fpath, '.'))

a = Analysis(
    ['agent.py'],
    pathex=[],
    binaries=adb_files,
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ADB_Mobile_Agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
