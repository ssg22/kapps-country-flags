@echo off
setlocal enabledelayedexpansion
set "BASE=%LOCALAPPDATA%\kapps"

if not exist "%BASE%" (
  echo Could not find %BASE%. Is Kapps installed on this PC?
  pause
  exit /b 1
)

rem Pick the highest version number, comparing each component numerically. Sorting by name
rem (/o-n) gets this wrong -- it ranks 1.24.9 above 1.24.38 -- which never mattered while only
rem one app-* folder existed, but Squirrel leaves the previous version behind after an update.
rem Building a zero-padded key (1.24.38 -> 00001.00024.00038) makes a plain string compare correct.
set "VERDIR="
set "BESTKEY="
for /f "delims=" %%D in ('dir "%BASE%\app-*" /b /ad 2^>nul') do (
  set "V=%%D"
  set "V=!V:app-=!"
  for /f "tokens=1-4 delims=." %%a in ("!V!") do (
    set "P1=00000%%a" & set "P2=00000%%b" & set "P3=00000%%c" & set "P4=00000%%d"
    set "KEY=!P1:~-5!.!P2:~-5!.!P3:~-5!.!P4:~-5!"
  )
  if not defined BESTKEY (
    set "BESTKEY=!KEY!"
    set "VERDIR=%%D"
  ) else if "!KEY!" GTR "!BESTKEY!" (
    set "BESTKEY=!KEY!"
    set "VERDIR=%%D"
  )
)

if not defined VERDIR (
  echo No app-* folder found under %BASE%.
  pause
  exit /b 1
)

set "EXE=%BASE%\%VERDIR%\Kapps.exe"
if not exist "%EXE%" (
  echo Could not find %EXE%
  pause
  exit /b 1
)

echo Using Kapps install: %BASE%\%VERDIR%
echo.
echo IMPORTANT: fully quit Kapps first (tray icon -^> Quit Kapps) before continuing.
pause

rem Pass the resolved path explicitly so the runtime and the target are guaranteed to be the
rem same install -- the script can find it on its own, but then both would be picking the
rem version independently and could disagree.
set ELECTRON_RUN_AS_NODE=1
"%EXE%" "%~dp0kapps-country-flags-patch.js" "%BASE%\%VERDIR%\resources\app.asar"
set ELECTRON_RUN_AS_NODE=

echo.
echo Done. Relaunch Kapps to see the change.
pause
