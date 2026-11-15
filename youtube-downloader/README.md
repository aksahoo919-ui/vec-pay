# Easy Video Downloader

A simple Windows program for downloading videos or audio (MP3 etc.) from a link.
Paste the link, pick Video or Audio, press **Download**.

## Files

| File | What it is |
| --- | --- |
| `easy_video_downloader.py` | The program (Python + Tkinter, no extra packages needed) |
| `build_exe.bat` | Double-click on Windows to produce the `.exe` |
| `icon.ico`, `icon.png` | Program icon |

## Making the .exe

1. On a Windows PC, install Python from python.org (tick *Add python.exe to PATH*).
2. Double-click `build_exe.bat`.
3. Take `dist\Easy Video Downloader.exe` and give it to anyone. They do **not** need Python.

## How automatic updates work

The download engine (yt-dlp) is not baked into the `.exe`. It lives in
`%LOCALAPPDATA%\EasyVideoDownloader\bin` and the program keeps it current:

- **First start:** downloads the newest yt-dlp, FFmpeg and Deno (one time, roughly 260 MB, needs internet).
- **Every start:** compares the installed yt-dlp with the newest release and, if there is a newer one,
  downloads it, checks it against the published checksum, and swaps it in.
- **Left open for a long time:** re-checks before a download if the last check is over 6 hours old.
- **Manually:** the *Check for updates* link at the bottom of the window.

If there is no internet at start-up, the program simply uses the engine it already has.

## Notes for whoever hands this out

- The first time the `.exe` runs, Windows SmartScreen may say "Windows protected your PC" because the
  file is not code-signed. Click **More info → Run anyway**.
- Downloads go to `Downloads\Video Downloads` unless the user picks another folder (it is remembered).
- To reset everything, delete the folder `%LOCALAPPDATA%\EasyVideoDownloader`.
- Only download content you have the right to download.
