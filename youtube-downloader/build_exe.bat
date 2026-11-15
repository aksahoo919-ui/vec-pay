@echo off
REM Double-click this file on Windows to create "Easy Video Downloader.exe".
REM Needs Python 3.9+ from python.org (tick "Add python.exe to PATH" when installing).
setlocal
cd /d "%~dp0"

where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
%PY% --version >nul 2>nul || (
    echo Python was not found. Install it from https://www.python.org/downloads/ and run this again.
    pause & exit /b 1
)

echo [1/3] Preparing a private build environment...
if not exist ".build-venv\Scripts\python.exe" %PY% -m venv .build-venv || goto :fail
".build-venv\Scripts\python.exe" -m pip install --quiet --upgrade pip pyinstaller || goto :fail

echo [2/3] Building the program (takes about a minute)...
".build-venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onefile --windowed ^
    --name "Easy Video Downloader" --icon icon.ico --add-data "icon.ico;." ^
    easy_video_downloader.py || goto :fail

echo [3/3] Done.
echo.
echo Your program is here:  %~dp0dist\Easy Video Downloader.exe
echo You can copy that single file to any Windows 10/11 PC. Python is NOT needed there.
explorer "%~dp0dist"
pause
exit /b 0

:fail
echo.
echo The build did not finish. Please read the message above.
pause
exit /b 1
