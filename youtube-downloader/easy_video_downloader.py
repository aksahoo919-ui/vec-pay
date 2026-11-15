"""
Easy Video Downloader
A simple window for downloading videos / audio with yt-dlp.

How it stays up to date
-----------------------
The download engine (yt-dlp) is NOT baked into this program. It is kept as a
separate file in the user's app-data folder and is refreshed automatically:
  * first start  -> the newest yt-dlp, FFmpeg and Deno are downloaded once
  * every start  -> the newest yt-dlp release is compared with the installed one
                    and downloaded if it is newer
  * long sessions-> the check is repeated before a download if it is stale
So the program keeps working when YouTube changes, without rebuilding the exe.
"""

import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

APP_NAME = "Easy Video Downloader"
APP_VERSION = "1.0"
IS_WINDOWS = os.name == "nt"
EXE = ".exe" if IS_WINDOWS else ""

# ----------------------------------------------------------------------------
# Locations
# ----------------------------------------------------------------------------
if IS_WINDOWS:
    _base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    APP_DIR = Path(_base) / "EasyVideoDownloader"
else:
    APP_DIR = Path.home() / ".easy_video_downloader"
BIN_DIR = APP_DIR / "bin"
CONFIG_FILE = APP_DIR / "settings.json"
DEFAULT_FOLDER = str(Path.home() / "Downloads" / "Video Downloads")

YTDLP_PATH = BIN_DIR / ("yt-dlp.exe" if IS_WINDOWS else "yt-dlp")
YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + (
    "yt-dlp.exe" if IS_WINDOWS else ("yt-dlp_macos" if sys.platform == "darwin" else "yt-dlp_linux")
)
YTDLP_SUMS_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS"
FFMPEG_URL = ("https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/"
              "ffmpeg-master-latest-win64-gpl.zip")
DENO_URL = ("https://github.com/denoland/deno/releases/latest/download/"
            "deno-x86_64-pc-windows-msvc.zip")

UPDATE_RECHECK_SECONDS = 6 * 60 * 60  # re-check for engine updates after 6 hours
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0  # CREATE_NO_WINDOW: no black console popups

# ----------------------------------------------------------------------------
# Choices shown to the user
# ----------------------------------------------------------------------------
VIDEO_CHOICES = [
    ("Best available", None),
    ("4K (2160p)", 2160),
    ("2K (1440p)", 1440),
    ("Full HD (1080p)", 1080),
    ("HD (720p)", 720),
    ("Standard (480p)", 480),
    ("Small file (360p)", 360),
]
AUDIO_CHOICES = [
    ("MP3 - Best (320 kbps)", ("mp3", "320")),
    ("MP3 - Good (192 kbps)", ("mp3", "192")),
    ("MP3 - Small file (128 kbps)", ("mp3", "128")),
    ("M4A - Original quality", ("m4a", None)),
    ("FLAC - Lossless", ("flac", None)),
    ("WAV - Uncompressed (large)", ("wav", None)),
    ("OGG - 192 kbps", ("vorbis", "192")),
]

# Colours
BG = "#f5f6f8"
CARD = "#ffffff"
ACCENT = "#d93025"
ACCENT_DARK = "#b3261e"
TEXT = "#1f2328"
MUTED = "#6b7280"
OK_GREEN = "#1a7f37"


# ----------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------
def load_config():
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(cfg):
    try:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    except Exception:
        pass


def human_size(num):
    try:
        num = float(num)
    except (TypeError, ValueError):
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.0f} {unit}" if unit in ("B", "KB") else f"{num:.1f} {unit}"
        num /= 1024
    return ""


def human_time(seconds):
    try:
        seconds = int(float(seconds))
    except (TypeError, ValueError):
        return ""
    if seconds < 60:
        return f"{seconds} sec"
    if seconds < 3600:
        return f"{seconds // 60} min {seconds % 60:02d} sec"
    return f"{seconds // 3600} hr {seconds % 3600 // 60:02d} min"


def to_float(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def tool_env():
    """Environment for child processes: our tools folder goes first on PATH."""
    env = os.environ.copy()
    env["PATH"] = str(BIN_DIR) + os.pathsep + env.get("PATH", "")
    return env


def run_quiet(args, timeout=120):
    """Run a helper command and return (exit_code, combined_output)."""
    try:
        done = subprocess.run(
            args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            timeout=timeout, creationflags=NO_WINDOW, env=tool_env(),
        )
        return done.returncode, done.stdout.decode("utf-8", errors="replace").strip()
    except Exception as exc:  # missing file, timeout, ...
        return -1, str(exc)


def download_file(url, dest, on_progress=None):
    """Download url to dest (via a temporary file so a half download never counts)."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response, open(tmp, "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if on_progress:
                on_progress(done, total)
    if total and done != total:
        tmp.unlink(missing_ok=True)
        raise IOError("The download was interrupted.")
    os.replace(tmp, dest)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def latest_engine_version():
    """Newest yt-dlp release. GitHub's 'latest download' link redirects to a URL that
    contains the version, so no API (and no rate limit) is involved."""
    request = urllib.request.Request(YTDLP_SUMS_URL, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=30) as response:
            location = response.geturl()
    except urllib.error.HTTPError as redirect:
        location = redirect.headers.get("Location", "")
    match = re.search(r"/releases/download/(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/", location)
    if not match:
        raise ValueError("could not read the newest version")
    return match.group(1)


def verify_engine_file(path):
    """Check a downloaded yt-dlp against the checksums published with the release."""
    request = urllib.request.Request(YTDLP_SUMS_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        sums = response.read().decode("utf-8", errors="replace")
    wanted = YTDLP_URL.rsplit("/", 1)[-1]
    expected = next((ln.split()[0] for ln in sums.splitlines()
                     if ln.split()[1:] and ln.split()[1].lstrip("*") == wanted), None)
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if not expected or digest.hexdigest().lower() != expected.lower():
        raise IOError("the downloaded engine failed its integrity check")


def extract_from_zip(zip_path, wanted_names, target_dir):
    """Pull the named files (matched by file name only) out of a zip."""
    found = set()
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.namelist():
            name = member.rsplit("/", 1)[-1]
            if name in wanted_names:
                with archive.open(member) as src, open(Path(target_dir) / name, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                found.add(name)
    return found


def friendly_error(raw):
    """Turn a technical yt-dlp error into something a normal person can act on."""
    low = raw.lower()
    rules = [
        (("getaddrinfo", "name resolution", "network is unreachable", "timed out",
          "connection refused", "unable to connect", "no route to host"),
         "Could not reach the internet. Please check your connection and try again."),
        (("private video",), "This video is private, so it cannot be downloaded."),
        (("sign in to confirm your age", "age-restricted", "age restricted"),
         "This video is age-restricted and needs a signed-in account, so it cannot be downloaded."),
        (("members-only", "members only", "join this channel"),
         "This video is for channel members only."),
        (("video unavailable", "has been removed", "no longer available", "account associated"),
         "This video is unavailable (removed or blocked)."),
        (("not available in your country", "geo"),
         "This video is not available in your country."),
        (("http error 404", "http error 410"),
         "That link did not work (page not found). Please copy the link again."),
        (("unsupported url", "is not a valid url"),
         "That link does not look like a video link. Please copy the link again."),
        (("no space left", "not enough space"),
         "The disk is full. Free up some space or choose another folder."),
        (("permission denied", "access is denied"),
         "Windows did not allow saving to that folder. Please choose another folder."),
        (("ffmpeg", "ffprobe"),
         "The video converter (FFmpeg) had a problem. Close the program, open it again and retry."),
        (("sign in to confirm you", "429", "too many requests"),
         "YouTube is temporarily limiting downloads from your connection. Please try again later."),
    ]
    for needles, message in rules:
        if any(n in low for n in needles):
            return message
    cleaned = re.sub(r"^ERROR:\s*(\[[^\]]*\]\s*)?([\w-]+:\s*)?", "", raw).strip()
    return cleaned[:220] or "Something went wrong with this download."


# ----------------------------------------------------------------------------
# The window
# ----------------------------------------------------------------------------
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.configure(bg=BG)
        self.minsize(620, 560)

        self.cfg = load_config()
        self.events = queue.Queue()      # messages from worker threads -> window
        self.process = None              # the running yt-dlp process
        self.cancelled = False
        self.busy = False                # a download batch is running
        self.ready = False               # tools are installed
        self.last_update_check = 0.0
        self.engine_version = ""

        self._set_icon()
        self._build_styles()
        self._build_ui()
        self._apply_saved_choices()
        self._center(660, 640)

        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(80, self._pump_events)
        self._start_setup()

    # ---------------------------------------------------------------- look
    def _set_icon(self):
        base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
        try:
            if IS_WINDOWS and (base / "icon.ico").exists():
                self.iconbitmap(default=str(base / "icon.ico"))
            elif (base / "icon.png").exists():
                self._icon_img = tk.PhotoImage(file=str(base / "icon.png"))
                self.iconphoto(True, self._icon_img)
        except Exception:
            pass

    def _build_styles(self):
        self.font = ("Segoe UI", 10) if IS_WINDOWS else ("DejaVu Sans", 10)
        self.font_bold = (self.font[0], 10, "bold")
        self.font_step = (self.font[0], 11, "bold")
        self.font_title = (self.font[0], 17, "bold")
        self.font_small = (self.font[0], 9)
        self.font_big = (self.font[0], 13, "bold")

        style = ttk.Style(self)
        if not IS_WINDOWS:
            style.theme_use("clam")
        style.configure(".", font=self.font)
        style.configure("Card.TFrame", background=CARD)
        style.configure("Card.TLabel", background=CARD, foreground=TEXT)
        style.configure("Card.TRadiobutton", background=CARD, foreground=TEXT)
        style.configure("Bar.Horizontal.TProgressbar", thickness=16)

    def _center(self, width, height):
        self.update_idletasks()
        width = max(width, self.winfo_reqwidth())
        height = max(height, self.winfo_reqheight())
        x = (self.winfo_screenwidth() - width) // 2
        y = max(20, (self.winfo_screenheight() - height) // 2 - 20)
        self.geometry(f"{width}x{height}+{x}+{y}")

    def _card(self, parent, step, title):
        outer = tk.Frame(parent, bg=CARD, highlightbackground="#e3e5e8", highlightthickness=1)
        outer.pack(fill="x", pady=(0, 10))
        head = tk.Frame(outer, bg=CARD)
        head.pack(fill="x", padx=14, pady=(10, 4))
        tk.Label(head, text=str(step), bg=ACCENT, fg="white", font=self.font_bold,
                 width=2).pack(side="left")
        tk.Label(head, text=title, bg=CARD, fg=TEXT, font=self.font_step).pack(side="left", padx=8)
        body = tk.Frame(outer, bg=CARD)
        body.pack(fill="x", padx=14, pady=(0, 12))
        return body

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        root = tk.Frame(self, bg=BG)
        root.pack(fill="both", expand=True, padx=18, pady=14)

        tk.Label(root, text=APP_NAME, bg=BG, fg=TEXT, font=self.font_title).pack(anchor="w")
        tk.Label(root, text="Copy a video link, paste it below and press Download.",
                 bg=BG, fg=MUTED, font=self.font).pack(anchor="w", pady=(0, 10))

        # --- Step 1: link(s)
        body = self._card(root, 1, "Paste the video link")
        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        self.links = tk.Text(row, height=3, wrap="none", font=self.font, relief="solid", bd=1,
                             highlightthickness=0, undo=True)
        self.links.pack(side="left", fill="x", expand=True)
        buttons = tk.Frame(row, bg=CARD)
        buttons.pack(side="left", padx=(8, 0), anchor="n")
        self.paste_btn = ttk.Button(buttons, text="Paste link", command=self._paste, width=11)
        self.paste_btn.pack()
        self.clear_btn = ttk.Button(buttons, text="Clear", command=self._clear_links, width=11)
        self.clear_btn.pack(pady=(4, 0))
        tk.Label(body, text="Tip: for several videos, put one link on each line.",
                 bg=CARD, fg=MUTED, font=self.font_small).pack(anchor="w", pady=(4, 0))
        self._add_right_click_menu(self.links)

        # --- Step 2: what
        body = self._card(root, 2, "Choose what you want")
        self.mode = tk.StringVar(value="video")
        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        ttk.Radiobutton(row, text="Video", value="video", variable=self.mode,
                        style="Card.TRadiobutton", command=self._mode_changed).pack(side="left")
        ttk.Radiobutton(row, text="Audio only (music)", value="audio", variable=self.mode,
                        style="Card.TRadiobutton", command=self._mode_changed).pack(side="left", padx=18)
        ttk.Label(row, text="Quality:", style="Card.TLabel").pack(side="left", padx=(12, 6))
        self.quality = ttk.Combobox(row, state="readonly", width=28)
        self.quality.pack(side="left")
        self.quality.bind("<<ComboboxSelected>>", lambda e: self._remember_quality())

        # --- Step 3: where
        body = self._card(root, 3, "Choose where to save")
        row = tk.Frame(body, bg=CARD)
        row.pack(fill="x")
        self.folder = tk.StringVar(value=self.cfg.get("folder") or DEFAULT_FOLDER)
        ttk.Entry(row, textvariable=self.folder, state="readonly").pack(side="left", fill="x", expand=True)
        self.browse_btn = ttk.Button(row, text="Change...", command=self._browse, width=11)
        self.browse_btn.pack(side="left", padx=(8, 0))

        # --- Download button
        self.download_btn = tk.Button(
            root, text="Download", command=self._download_clicked, font=self.font_big,
            bg=ACCENT, fg="white", activebackground=ACCENT_DARK, activeforeground="white",
            disabledforeground="#f3c9c6", relief="flat", bd=0, cursor="hand2", pady=9,
        )
        self.download_btn.pack(fill="x", pady=(2, 10))

        # --- Progress area
        self.status = tk.StringVar(value="Getting ready...")
        self.status_label = tk.Label(root, textvariable=self.status, bg=BG, fg=TEXT,
                                     font=self.font_bold, anchor="w", justify="left", wraplength=600)
        self.status_label.pack(fill="x")
        self.bar = ttk.Progressbar(root, style="Bar.Horizontal.TProgressbar", maximum=100)
        self.bar.pack(fill="x", pady=(5, 3))
        self.detail = tk.StringVar(value="")
        tk.Label(root, textvariable=self.detail, bg=BG, fg=MUTED, font=self.font_small,
                 anchor="w").pack(fill="x")

        row = tk.Frame(root, bg=BG)
        row.pack(fill="x", pady=(8, 0))
        self.open_btn = ttk.Button(row, text="Open download folder", command=self._open_folder)
        self.open_btn.pack(side="left")
        self.log_btn = ttk.Button(row, text="Show details", command=self._toggle_log)
        self.log_btn.pack(side="left", padx=8)

        # --- Details log (hidden until asked for)
        self.log_frame = tk.Frame(root, bg=BG)
        self.log = tk.Text(self.log_frame, height=7, font=("Consolas" if IS_WINDOWS else "DejaVu Sans Mono", 9),
                           state="disabled", wrap="word", relief="solid", bd=1, bg="#fbfbfc")
        scroll = ttk.Scrollbar(self.log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.log.pack(side="left", fill="both", expand=True)
        self.log_visible = False

        # --- Footer: engine version / update
        footer = tk.Frame(self, bg="#eceef1")
        footer.pack(fill="x", side="bottom")
        self.engine = tk.StringVar(value="Download engine: checking...")
        tk.Label(footer, textvariable=self.engine, bg="#eceef1", fg=MUTED,
                 font=self.font_small).pack(side="left", padx=18, pady=5)
        self.update_link = tk.Label(footer, text="Check for updates", bg="#eceef1", fg="#0b57d0",
                                    font=(self.font[0], 9, "underline"), cursor="hand2")
        self.update_link.pack(side="right", padx=18)
        self.update_link.bind("<Button-1>", lambda e: self._manual_update())

    def _add_right_click_menu(self, widget):
        menu = tk.Menu(widget, tearoff=0)
        menu.add_command(label="Paste", command=self._paste)
        menu.add_command(label="Clear", command=self._clear_links)
        widget.bind("<Button-3>", lambda e: menu.tk_popup(e.x_root, e.y_root))

    def _apply_saved_choices(self):
        if self.cfg.get("mode") in ("video", "audio"):
            self.mode.set(self.cfg["mode"])
        self._mode_changed(initial=True)
        self._set_controls(False)

    # ------------------------------------------------------------ UI events
    def _choices(self):
        return VIDEO_CHOICES if self.mode.get() == "video" else AUDIO_CHOICES

    def _mode_changed(self, initial=False):
        labels = [label for label, _ in self._choices()]
        self.quality.configure(values=labels)
        saved = self.cfg.get("quality_" + self.mode.get())
        self.quality.set(saved if saved in labels else labels[0])
        if not initial:
            self.cfg["mode"] = self.mode.get()
            save_config(self.cfg)

    def _remember_quality(self):
        self.cfg["quality_" + self.mode.get()] = self.quality.get()
        save_config(self.cfg)
        self.quality.selection_clear()

    def _paste(self):
        try:
            text = self.clipboard_get().strip()
        except tk.TclError:
            text = ""
        if not text:
            self._say("Nothing to paste yet. Copy a video link first, then press Paste link.")
            return
        current = self.links.get("1.0", "end").strip()
        self.links.delete("1.0", "end")
        self.links.insert("1.0", (current + "\n" + text) if current else text)
        self.links.see("end")

    def _clear_links(self):
        self.links.delete("1.0", "end")

    def _browse(self):
        start = self.folder.get() if os.path.isdir(self.folder.get()) else str(Path.home())
        chosen = filedialog.askdirectory(title="Choose where to save downloads", initialdir=start)
        if chosen:
            self.folder.set(os.path.normpath(chosen))
            self.cfg["folder"] = self.folder.get()
            save_config(self.cfg)

    def _open_folder(self):
        folder = self.folder.get()
        try:
            os.makedirs(folder, exist_ok=True)
            if IS_WINDOWS:
                os.startfile(folder)  # noqa: only exists on Windows
            else:
                subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", folder])
        except Exception as exc:
            messagebox.showerror(APP_NAME, f"Could not open the folder:\n{exc}")

    def _toggle_log(self):
        self.log_visible = not self.log_visible
        if self.log_visible:
            self.log_frame.pack(fill="both", expand=True, pady=(8, 0))
            self.log_btn.configure(text="Hide details")
            if self.winfo_height() < 760:
                self.geometry(f"{self.winfo_width()}x760")
        else:
            self.log_frame.pack_forget()
            self.log_btn.configure(text="Show details")

    def _on_close(self):
        if self.busy and not messagebox.askyesno(
                APP_NAME, "A download is still running.\nStop it and close the program?"):
            return
        self.cancelled = True
        self._kill_process()
        self.destroy()

    # --------------------------------------------------------- UI utilities
    def _say(self, text, colour=TEXT):
        self.status.set(text)
        self.status_label.configure(fg=colour)

    def _write_log(self, line):
        self.log.configure(state="normal")
        self.log.insert("end", line.rstrip() + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_controls(self, enabled):
        """Enable/disable the inputs. The Download button is handled separately."""
        state = "normal" if enabled else "disabled"
        for widget in (self.paste_btn, self.clear_btn, self.browse_btn):
            widget.configure(state=state)
        self.links.configure(state=state, bg="white" if enabled else "#f0f0f0")
        self.quality.configure(state="readonly" if enabled else "disabled")
        if enabled or not self.busy:
            self.download_btn.configure(text="Download", bg=ACCENT, activebackground=ACCENT_DARK,
                                        state=state)

    def _post(self, kind, *data):
        """Called from worker threads: hand a message to the window thread."""
        self.events.put((kind, data))

    def _pump_events(self):
        try:
            while True:
                kind, data = self.events.get_nowait()
                getattr(self, "_on_" + kind)(*data)
        except queue.Empty:
            pass
        self.after(80, self._pump_events)

    # Handlers for messages coming from worker threads -------------------
    def _on_status(self, text, colour=TEXT):
        self._say(text, colour)

    def _on_detail(self, text):
        self.detail.set(text)

    def _on_progress(self, percent):
        if percent is None:
            if str(self.bar.cget("mode")) != "indeterminate":
                self.bar.configure(mode="indeterminate")
                self.bar.start(12)
        else:
            if str(self.bar.cget("mode")) != "determinate":
                self.bar.stop()
                self.bar.configure(mode="determinate")
            self.bar["value"] = percent

    def _on_log(self, line):
        self._write_log(line)

    def _on_engine(self, text):
        self.engine.set(text)

    def _on_setup_done(self, ok, message):
        self._on_progress(0)
        self.detail.set("")
        if ok:
            self.ready = True
            self._set_controls(True)
            self._say("Ready. Paste a link and press Download.")
            if not self.links.get("1.0", "end").strip():
                self._prefill_from_clipboard()
        else:
            self._say(message, ACCENT)
            self.download_btn.configure(text="Try again", state="normal", command=self._retry_setup)

    def _on_batch_done(self, succeeded, failed, cancelled):
        self.busy = False
        self.process = None
        self._on_progress(0 if (failed or cancelled) and not succeeded else 100)
        self.detail.set("")
        self._set_controls(True)
        total = succeeded + len(failed)
        if cancelled:
            self._say("Download stopped.", MUTED)
            self._on_progress(0)
        elif not failed:
            what = "Your download is" if total == 1 else f"All {total} downloads are"
            self._say(f"Done! {what} saved in the folder below.", OK_GREEN)
            self._clear_links()
        elif succeeded:
            self._say(f"{succeeded} of {total} downloaded. {len(failed)} could not be downloaded - "
                      f"press Show details to see why.", ACCENT)
        else:
            self._say("Could not download: " + failed[0][1], ACCENT)
        self.detail.set("Saved to: " + self.folder.get() if succeeded else "")

    def _on_ask_update_result(self, text):
        messagebox.showinfo(APP_NAME, text)

    def _prefill_from_clipboard(self):
        try:
            text = self.clipboard_get().strip()
        except tk.TclError:
            return
        if re.fullmatch(r"https?://\S+", text) and re.search(r"youtu\.?be", text):
            self.links.insert("1.0", text)
            self._say("Found a link you copied. Press Download to start.")

    # ----------------------------------------------------------------------
    # Setup + automatic updates (runs in a background thread)
    # ----------------------------------------------------------------------
    def _start_setup(self):
        self._on_progress(None)
        threading.Thread(target=self._setup_worker, daemon=True).start()

    def _retry_setup(self):
        self.download_btn.configure(command=self._download_clicked, state="disabled", text="Download")
        self._say("Getting ready...")
        self._start_setup()

    def _download_tool(self, label, url, dest):
        def progress(done, total):
            if total:
                self._post("progress", done * 100 / total)
                self._post("detail", f"{label}: {human_size(done)} of {human_size(total)}")
        self._post("log", f"Downloading {label} from {url}")
        download_file(url, dest, progress)

    def _setup_worker(self):
        try:
            BIN_DIR.mkdir(parents=True, exist_ok=True)
            first_time = not YTDLP_PATH.exists()
            if first_time:
                self._post("status", "First-time setup: downloading the tools needed (one time only)...")

            # 1) yt-dlp: install, or let it update itself
            if not YTDLP_PATH.exists():
                self._install_engine()
                self.last_update_check = time.time()
            else:
                self._post("status", "Checking for updates...")
                self._update_engine()

            code, version = run_quiet([str(YTDLP_PATH), "--version"])
            if code != 0:
                # Broken/blocked file: fetch a fresh copy once.
                self._post("log", f"Engine did not start ({version}); downloading it again.")
                self._install_engine()
                code, version = run_quiet([str(YTDLP_PATH), "--version"])
                if code != 0:
                    raise RuntimeError("The download engine could not start. Your antivirus may be "
                                       "blocking it.")
            self._set_engine_version(version)

            # 2) FFmpeg: joins video+audio and converts to MP3
            if not self._have_tool("ffmpeg"):
                if not IS_WINDOWS:
                    raise RuntimeError("FFmpeg is not installed. Please install FFmpeg and start again.")
                self._post("status", "First-time setup: downloading the video converter (large, one time only)...")
                zip_path = BIN_DIR / "ffmpeg.zip"
                self._download_tool("Video converter", FFMPEG_URL, zip_path)
                self._post("progress", None)
                self._post("detail", "Unpacking...")
                found = extract_from_zip(zip_path, {"ffmpeg.exe", "ffprobe.exe"}, BIN_DIR)
                zip_path.unlink(missing_ok=True)
                if "ffmpeg.exe" not in found:
                    raise RuntimeError("The video converter could not be unpacked.")

            # 3) Deno: helper yt-dlp needs for YouTube. Nice to have, never fatal.
            if IS_WINDOWS and not self._have_tool("deno"):
                try:
                    self._post("status", "First-time setup: downloading the YouTube helper (one time only)...")
                    zip_path = BIN_DIR / "deno.zip"
                    self._download_tool("YouTube helper", DENO_URL, zip_path)
                    extract_from_zip(zip_path, {"deno.exe"}, BIN_DIR)
                    zip_path.unlink(missing_ok=True)
                except Exception as exc:
                    self._post("log", f"Could not install the YouTube helper (will retry next start): {exc}")

            self._post("setup_done", True, "")
        except Exception as exc:
            self._post("log", f"Setup problem: {exc}")
            if YTDLP_PATH.exists() and self._have_tool("ffmpeg") and run_quiet([str(YTDLP_PATH), "--version"])[0] == 0:
                self._post("setup_done", True, "")   # offline but usable with what we have
            else:
                self._post("setup_done", False,
                           "Setup could not finish. Please check your internet connection and press "
                           f"Try again.\n({exc})")

    def _install_engine(self):
        fresh = YTDLP_PATH.with_name(YTDLP_PATH.name + ".new")
        self._download_tool("Download engine", YTDLP_URL, fresh)
        try:
            verify_engine_file(fresh)
        except Exception:
            fresh.unlink(missing_ok=True)
            raise
        if not IS_WINDOWS:
            os.chmod(fresh, 0o755)
        os.replace(fresh, YTDLP_PATH)

    @staticmethod
    def _have_tool(name):
        return (BIN_DIR / (name + EXE)).exists() or shutil.which(name) is not None

    def _set_engine_version(self, version):
        self.engine_version = version.splitlines()[-1].strip() if version else "unknown"
        self._post("engine", f"Download engine: version {self.engine_version}")

    def _update_engine(self):
        """Bring yt-dlp up to date. Returns a short human message."""
        before = run_quiet([str(YTDLP_PATH), "--version"])[1]
        self.last_update_check = time.time()
        try:
            latest = latest_engine_version()
            self._post("log", f"[update] installed: {before}, newest: {latest}")
            if latest == before:
                return f"You already have the newest download engine (version {before})."
            fresh = YTDLP_PATH.with_name(YTDLP_PATH.name + ".new")
            self._download_tool("Download engine update", YTDLP_URL, fresh)
            verify_engine_file(fresh)
            if not IS_WINDOWS:
                os.chmod(fresh, 0o755)
            code, fresh_version = run_quiet([str(fresh), "--version"])
            if code != 0:  # never replace a working engine with a broken download
                fresh.unlink(missing_ok=True)
                raise RuntimeError("the new engine did not start: " + fresh_version)
            os.replace(fresh, YTDLP_PATH)
        except Exception as exc:
            # Fall back to yt-dlp's own updater.
            self._post("log", f"[update] direct update failed ({exc}); asking the engine to update itself")
            _, output = run_quiet([str(YTDLP_PATH), "-U"], timeout=300)
            for line in output.splitlines():
                self._post("log", "[update] " + line)
        after = run_quiet([str(YTDLP_PATH), "--version"])[1]
        if after and after != before:
            self._set_engine_version(after)
            return f"Updated the download engine to version {after}."
        return "Could not check for updates right now. Please check your internet connection."

    def _manual_update(self):
        if self.busy or not self.ready:
            return

        def work():
            self._post("status", "Checking for updates...")
            self._post("progress", None)
            message = self._update_engine()
            self._post("progress", 0)
            self._post("status", "Ready. Paste a link and press Download.")
            self._post("ask_update_result", message)
        threading.Thread(target=work, daemon=True).start()

    # ----------------------------------------------------------------------
    # Downloading
    # ----------------------------------------------------------------------
    def _download_clicked(self):
        if self.busy:
            self._cancel()
            return
        if not self.ready:
            return
        urls = [u.strip() for u in self.links.get("1.0", "end").split() if u.strip()]
        urls = list(dict.fromkeys(urls))  # drop duplicates, keep order
        if not urls:
            self._say("Please paste a video link first (step 1).", ACCENT)
            return
        bad = [u for u in urls if not re.match(r"https?://", u)]
        if bad:
            self._say("This does not look like a link: " + bad[0][:60] +
                      "\nA link starts with https://", ACCENT)
            return
        folder = self.folder.get()
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError:
            self._say("That folder cannot be used. Please choose another folder (step 3).", ACCENT)
            return
        self.cfg.update(folder=folder, mode=self.mode.get())
        save_config(self.cfg)

        choice = dict(self._choices()).get(self.quality.get())
        self.busy = True
        self.cancelled = False
        self._set_controls(False)
        self.download_btn.configure(text="Stop", bg="#4b5563", activebackground="#374151", state="normal")
        self._on_progress(None)
        self._say("Starting...")
        threading.Thread(target=self._batch_worker, args=(urls, self.mode.get(), choice, folder),
                         daemon=True).start()

    def _cancel(self):
        self.cancelled = True
        self._say("Stopping...", MUTED)
        self._kill_process()

    def _kill_process(self):
        proc = self.process
        if proc and proc.poll() is None:
            try:
                if IS_WINDOWS:  # also stops FFmpeg and other helpers it started
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=NO_WINDOW)
                else:
                    proc.terminate()
            except Exception:
                pass

    def _build_command(self, url, mode, choice, folder):
        cmd = [
            str(YTDLP_PATH), "--newline", "--no-colors", "--encoding", "utf-8", "--ignore-config",
            "--no-playlist", "--windows-filenames", "--no-mtime",
            "--concurrent-fragments", "4", "--retries", "5", "--fragment-retries", "3",
            "--socket-timeout", "30",
            "--progress-template",
            "download:@@P|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|"
            "%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.title)s",
            "-P", folder, "-o", "%(title)s.%(ext)s",
        ]
        if (BIN_DIR / ("ffmpeg" + EXE)).exists():
            cmd += ["--ffmpeg-location", str(BIN_DIR)]
        if mode == "audio":
            codec, bitrate = choice or ("mp3", "192")
            cmd += ["-f", "bestaudio[ext=m4a]/bestaudio/best" if codec == "m4a" else "bestaudio/best",
                    "-x", "--audio-format", codec]
            if bitrate:
                cmd += ["--audio-quality", bitrate + "K"]
        else:
            # Highest resolution first (optionally capped), then the most widely playable codecs.
            res = f"res:{choice}" if choice else "res"
            cmd += ["-f", "bestvideo*+bestaudio/best", "-S", f"{res},vcodec:h264,acodec:aac",
                    "--merge-output-format", "mp4"]
        return cmd + ["--", url]

    def _batch_worker(self, urls, mode, choice, folder):
        # Long-running window? Make sure the engine is still current before downloading.
        if time.time() - self.last_update_check > UPDATE_RECHECK_SECONDS:
            self._post("status", "Checking for updates...")
            self._update_engine()

        succeeded, failed = 0, []
        for index, url in enumerate(urls, 1):
            if self.cancelled:
                break
            prefix = f"({index} of {len(urls)}) " if len(urls) > 1 else ""
            ok, error = self._download_one(url, mode, choice, folder, prefix)
            if self.cancelled:
                break
            if ok:
                succeeded += 1
            else:
                failed.append((url, error))
                self._post("log", f"FAILED: {url}\n   -> {error}")
        self._post("batch_done", succeeded, failed, self.cancelled)

    def _download_one(self, url, mode, choice, folder, prefix):
        self._post("status", prefix + "Looking up the video...")
        self._post("progress", None)
        self._post("detail", "")
        self._post("log", f"--- {url}")
        try:
            self.process = subprocess.Popen(
                self._build_command(url, mode, choice, folder),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                creationflags=NO_WINDOW, env=tool_env(),
            )
        except OSError as exc:
            return False, f"The download engine could not start ({exc})."

        last_error = ""
        part = 0               # which stream we are on (video = 1, audio = 2)
        last_fraction = 0.0
        for raw in self.process.stdout:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if line.startswith("@@P|"):
                fields = line.split("|", 6)
                if len(fields) < 7:
                    continue
                done, total, estimate, speed, eta = (to_float(x) for x in fields[1:6])
                title = fields[6]
                total = total or estimate
                fraction = (done / total) if (done is not None and total) else None
                if part == 0 or (fraction is not None and fraction < last_fraction - 0.5):
                    part += 1
                if fraction is not None:
                    last_fraction = fraction
                if mode == "video":
                    doing = "Downloading video" if part <= 1 else "Downloading sound"
                else:
                    doing = "Downloading audio"
                self._post("status", f"{prefix}{doing}: {title[:70]}")
                self._post("progress", None if fraction is None else min(100, fraction * 100))
                bits = []
                if fraction is not None:
                    bits.append(f"{fraction * 100:.0f}%")
                if total:
                    bits.append(f"{human_size(done)} of {human_size(total)}")
                elif done:
                    bits.append(human_size(done))
                if speed:
                    bits.append(human_size(speed) + "/s")
                if eta is not None and fraction is not None and fraction < 1:
                    bits.append(human_time(eta) + " left")
                self._post("detail", "   |   ".join(bits))
                continue

            self._post("log", line)
            if line.startswith("ERROR:"):
                last_error = line
            elif line.startswith(("[Merger]", "[VideoRemuxer]", "[VideoConvertor]", "[FixupM")):
                self._post("status", prefix + "Almost done: putting video and sound together...")
                self._post("progress", None)
                self._post("detail", "")
            elif line.startswith("[ExtractAudio]"):
                self._post("status", prefix + "Almost done: converting the audio...")
                self._post("progress", None)
                self._post("detail", "")
            elif "has already been downloaded" in line:
                self._post("status", prefix + "This one was already downloaded.")

        code = self.process.wait()
        if code == 0:
            return True, ""
        return False, friendly_error(last_error) if last_error else "Something went wrong with this download."


def main():
    if IS_WINDOWS:
        try:  # crisp text on high-resolution screens
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    App().mainloop()


if __name__ == "__main__":
    main()
