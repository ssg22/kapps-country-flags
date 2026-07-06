@echo off
setlocal enabledelayedexpansion
set "BASE=%LOCALAPPDATA%\kapps"

if not exist "%BASE%" (
  echo Could not find %BASE%. Is Kapps installed on this PC?
  pause
  exit /b 1
)

set "VERDIR="
for /f "delims=" %%D in ('dir "%BASE%\app-*" /b /ad /o-n 2^>nul') do (
  if not defined VERDIR set "VERDIR=%%D"
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

set ELECTRON_RUN_AS_NODE=1
"%EXE%" "%~dp0kapps-country-flags-patch.js"
set ELECTRON_RUN_AS_NODE=

echo.
echo Done. Relaunch Kapps to see the change.
pause
