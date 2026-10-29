#!/usr/bin/env python3
"""Start, watch and stop the Agent Office servers for Claude Code.

Subcommands:
    hook     Run by the Claude Code SessionStart hook. Hands ``ensure`` to a
             detached process and returns at once; never prints, always exit 0.
    ensure   Start the backend (:8000) and the frontend (:4747) when they are
             down, wait until both answer, then open one office window.
             Does nothing when both are already up. ``--open`` opens the
             window even then.
    stop     Stop both servers and close the office window.
    status   Print whether each server answers.

Standard library only: the hook runs it with the backend venv's interpreter
before anything else is known to be installed.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_OUT = ROOT / "frontend" / "out"
STATIC_SERVER = Path(__file__).resolve().parent / "static_server.py"

HOST = "127.0.0.1"
BACKEND_PORT = 8000  # the frontend talks to <page host>:8000 (frontend/src/utils/api.ts)
FRONTEND_PORT = 4747
BACKEND_HEALTH = f"http://{HOST}:{BACKEND_PORT}/health"
FRONTEND_URL = f"http://{HOST}:{FRONTEND_PORT}/"
OFFICE_URL = FRONTEND_URL

STATE_DIR = Path(os.environ.get("AGENT_OFFICE_HOME") or Path.home() / ".agent-office")
RUN_DIR = STATE_DIR / "run"
LOG_DIR = STATE_DIR / "logs"
PROFILE_DIR = STATE_DIR / "browser-profile"
LOCK_FILE = RUN_DIR / "ensure.lock"

READY_TIMEOUT = 90.0  # seconds; a cold Windows start can be slow
LOCK_STALE_AFTER = 180.0  # seconds; longer than any ensure run
LOG_MAX_BYTES = 5 * 1024 * 1024

IS_WINDOWS = os.name == "nt"
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000
CREATE_BREAKAWAY_FROM_JOB = 0x01000000

# Process names each pid file may point at; anything else is a reused pid.
EXPECTED_NAMES = {
    "backend": ("python",),
    "frontend": ("python",),
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def log(message: str) -> None:
    """Append one line to launcher.log (and stdout when there is a console)."""
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} [{os.getpid()}] {message}"
    with contextlib.suppress(Exception):
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_DIR / "launcher.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    if sys.stdout is not None and not getattr(sys, "_agent_office_quiet", False):
        with contextlib.suppress(Exception):
            print(message, flush=True)


def venv_python(gui: bool = False) -> Path:
    """The backend venv interpreter (``pythonw`` on Windows when *gui*)."""
    if IS_WINDOWS:
        return BACKEND_DIR / ".venv" / "Scripts" / ("pythonw.exe" if gui else "python.exe")
    return BACKEND_DIR / ".venv" / "bin" / "python"


def _no_proxy_open(url: str, timeout: float):
    # Loopback only: skip HTTP(S)_PROXY and the Windows system proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(url, timeout=timeout)


def backend_up(timeout: float = 1.0) -> bool:
    try:
        with _no_proxy_open(BACKEND_HEALTH, timeout) as r:
            return r.status == 200 and json.loads(r.read()).get("status") == "ok"
    except Exception:
        return False


def frontend_up(timeout: float = 1.0) -> bool:
    try:
        with _no_proxy_open(FRONTEND_URL, timeout) as r:
            return r.status == 200
    except Exception:
        return False


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if IS_WINDOWS:
        # os.kill(pid, 0) would *terminate* the process on Windows.
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return bool(ok) and code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def process_name(pid: int) -> str:
    """Lower-case executable name and command line of *pid*, or ``""``."""
    try:
        if IS_WINDOWS:
            out = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                errors="replace",
                creationflags=CREATE_NO_WINDOW,
                timeout=10,
            ).stdout
            return out.strip().split(",")[0].strip('"').lower() if '"' in out else ""
        cmdline = Path(f"/proc/{pid}/cmdline")
        if cmdline.exists():
            return cmdline.read_bytes().replace(b"\0", b" ").decode(errors="replace").lower()
        out = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True, timeout=10
        ).stdout
        return out.strip().lower()
    except Exception:
        return ""


def read_pid(name: str) -> int:
    try:
        return int((RUN_DIR / f"{name}.pid").read_text().strip())
    except Exception:
        return 0


def write_pid(name: str, pid: int) -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    (RUN_DIR / f"{name}.pid").write_text(str(pid))


def open_log(name: str):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / f"{name}.log"
    with contextlib.suppress(Exception):
        if path.exists() and path.stat().st_size > LOG_MAX_BYTES:
            path.replace(path.with_suffix(".log.1"))
    f = open(path, "a", encoding="utf-8")  # noqa: SIM115 - handed to the child
    f.write(f"\n===== {datetime.now():%Y-%m-%d %H:%M:%S} start =====\n")
    f.flush()
    return f


def spawn_detached(cmd: list[str], *, cwd: Path | None = None, env=None, log_name=None,
                   console: bool = True) -> subprocess.Popen:
    """Start *cmd* so it outlives this process and the Claude Code hook.

    stdin/stdout/stderr never inherit our handles: an inherited hook pipe
    would keep Claude Code waiting until the child exits.
    """
    out = open_log(log_name) if log_name else subprocess.DEVNULL
    kwargs: dict = {
        "cwd": str(cwd) if cwd else None,
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": out,
        "stderr": subprocess.STDOUT if log_name else subprocess.DEVNULL,
        "close_fds": True,
    }
    try:
        if IS_WINDOWS:
            # Console programs get a hidden console; GUI ones need none.
            base = CREATE_NEW_PROCESS_GROUP | (CREATE_NO_WINDOW if console else DETACHED_PROCESS)
            try:
                # Leave the hook's job object if it has one, so closing
                # Claude Code does not take the servers down with it.
                return subprocess.Popen(cmd, creationflags=base | CREATE_BREAKAWAY_FROM_JOB,
                                        **kwargs)
            except OSError:
                return subprocess.Popen(cmd, creationflags=base, **kwargs)
        return subprocess.Popen(cmd, start_new_session=True, **kwargs)
    finally:
        if log_name:
            out.close()


def server_env() -> dict[str, str]:
    """Environment for the servers: view only, no tokens spent."""
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("ANTHROPIC_", "CLAUDE_CODE_OAUTH", "SUMMARY_"))
    }
    env.update(
        {
            # The default summary/agent-name backend runs `claude -p` (account usage).
            "SUMMARY_ENABLED": "false",
            "SUMMARY_BACKEND": "disabled",
            "CLAUDE_CODE_OAUTH_TOKEN": "",
            "PYTHONUNBUFFERED": "1",
            "PYTHONIOENCODING": "utf-8",
            "NO_COLOR": "1",
            "COLUMNS": "200",
        }
    )
    return env


# ---------------------------------------------------------------------------
# Lock: one ensure at a time, however many sessions start together
# ---------------------------------------------------------------------------


def acquire_lock() -> bool:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                age = time.time() - LOCK_FILE.stat().st_mtime
            except FileNotFoundError:
                continue  # released meanwhile; try again
            try:
                holder: int | None = int(LOCK_FILE.read_text().split()[0])
            except Exception:
                # Just created and its pid not written yet: a live holder.
                holder = None
            if age < LOCK_STALE_AFTER and (holder is None or pid_alive(holder)):
                return False
            log(f"removing stale lock (pid {holder}, {age:.0f}s old)")
            with contextlib.suppress(FileNotFoundError):
                LOCK_FILE.unlink()
            continue
        with os.fdopen(fd, "w") as f:
            f.write(f"{os.getpid()} {time.time():.0f}\n")
        return True
    return False


def release_lock() -> None:
    with contextlib.suppress(Exception):
        if LOCK_FILE.read_text().split()[0] == str(os.getpid()):
            LOCK_FILE.unlink()


# ---------------------------------------------------------------------------
# Browser window
# ---------------------------------------------------------------------------


def find_browser() -> Path | None:
    """Chrome first, then Edge. ``AGENT_OFFICE_BROWSER`` overrides both."""
    override = os.environ.get("AGENT_OFFICE_BROWSER")
    if override:
        return Path(override)
    candidates: list[Path] = []
    if IS_WINDOWS:
        roots = [os.environ.get(v) for v in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")]
        app_paths: list[Path] = []
        with contextlib.suppress(Exception):
            import winreg

            for exe in ("chrome.exe", "msedge.exe"):
                for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                    with contextlib.suppress(OSError):
                        key = rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
                        with winreg.OpenKey(hive, key) as k:
                            app_paths.append(Path(winreg.QueryValue(k, None).strip('"')))
        for sub in (
            r"Google\Chrome\Application\chrome.exe",
            r"Microsoft\Edge\Application\msedge.exe",
        ):
            exe_name = sub.rsplit("\\", 1)[-1]
            candidates += [Path(r) / sub for r in roots if r]
            candidates += [p for p in app_paths if p.name.lower() == exe_name]
    elif sys.platform == "darwin":
        candidates = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ]
    else:
        for exe in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                    "microsoft-edge", "microsoft-edge-stable"):
            found = shutil.which(exe)
            if found:
                candidates.append(Path(found))
    return next((c for c in candidates if c.is_file()), None)


def office_window_pids() -> list[int]:
    """Pids of the browser processes running the office profile, i.e. its open windows.

    A second launch on the same profile hands its window to the first process
    and exits, so a pid file would point at a dead process.
    """
    try:
        if IS_WINDOWS:
            script = ("Get-CimInstance Win32_Process"
                      " | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AO_PROFILE) }"
                      " | ForEach-Object { $_.ProcessId }")
            out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                                 capture_output=True, text=True, errors="replace",
                                 creationflags=CREATE_NO_WINDOW,
                                 env={**os.environ, "AO_PROFILE": str(PROFILE_DIR)},
                                 timeout=30).stdout
        else:
            out = subprocess.run(["pgrep", "-f", str(PROFILE_DIR)], capture_output=True, text=True,
                                 timeout=10).stdout
        return [int(p) for p in out.split() if p.isdigit()]
    except Exception:
        return []


def open_window() -> None:
    if office_window_pids():
        log("office window already open")
        return
    browser = find_browser()
    if browser is None:
        log(f"no Chrome/Edge found; opening {OFFICE_URL} in the default browser")
        webbrowser.open(OFFICE_URL)
        return
    cmd = [
        str(browser),
        f"--app={OFFICE_URL}",
        # Its own profile: a separate window process the stop command can close,
        # untouched by the user's tabs and sessions.
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,820",
    ]
    proc = spawn_detached(cmd, log_name="browser", console=False)
    log(f"opened office window with {browser.name} (pid {proc.pid})")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_hook() -> int:
    """SessionStart hook: detach ``ensure`` and return immediately."""
    sys._agent_office_quiet = True  # type: ignore[attr-defined]
    try:
        # The hook input on stdin is not needed, and reading it could block.
        interpreter = venv_python(gui=True)
        if not interpreter.exists():
            interpreter = Path(sys.executable)
        spawn_detached([str(interpreter), str(Path(__file__).resolve()), "ensure", "--quiet"],
                       cwd=ROOT, console=False)
    except Exception as exc:
        log(f"hook: could not start ensure: {exc!r}")
    return 0


def start_backend() -> None:
    python = venv_python()
    if not python.exists():
        raise RuntimeError(f"{python} not found; run install.cmd first")
    cmd = [str(python), "-m", "uvicorn", "app.main:app", "--host", HOST,
           "--port", str(BACKEND_PORT), "--log-level", "info"]
    proc = spawn_detached(cmd, cwd=BACKEND_DIR, env=server_env(), log_name="backend")
    write_pid("backend", proc.pid)
    log(f"started backend (pid {proc.pid})")


def start_frontend() -> None:
    if not (FRONTEND_OUT / "index.html").exists():
        raise RuntimeError(f"{FRONTEND_OUT} has no build; run install.cmd first")
    cmd = [str(venv_python()), str(STATIC_SERVER), "--dir", str(FRONTEND_OUT),
           "--host", HOST, "--port", str(FRONTEND_PORT)]
    proc = spawn_detached(cmd, cwd=ROOT, env=server_env(), log_name="frontend")
    write_pid("frontend", proc.pid)
    log(f"started frontend (pid {proc.pid})")


def cmd_ensure(force_open: bool) -> int:
    if not acquire_lock():
        log("ensure: another launcher is already starting the office; nothing to do")
        return 0
    try:
        need_backend, need_frontend = not backend_up(), not frontend_up()
        if not need_backend and not need_frontend:
            log("ensure: office already running")
            if force_open:
                open_window()
            return 0

        # A busy server can miss the 1s health check; a second copy would only
        # fail on the taken port, so wait for the one already listening.
        for name, port, needed, start in (("backend", BACKEND_PORT, need_backend, start_backend),
                                          ("frontend", FRONTEND_PORT, need_frontend,
                                           start_frontend)):
            if not needed:
                continue
            if _port_owner(port):
                log(f"ensure: {name} port :{port} is taken; waiting for it to answer")
            else:
                start()

        deadline = time.monotonic() + READY_TIMEOUT
        while time.monotonic() < deadline:
            if backend_up() and frontend_up():
                break
            time.sleep(0.5)
        else:
            log(f"ensure: servers not ready after {READY_TIMEOUT:.0f}s; see {LOG_DIR}")
            return 1
        log("ensure: office is up")
        open_window()
        return 0
    except Exception as exc:
        log(f"ensure failed: {exc}")
        return 1
    finally:
        release_lock()


def _kill_tree(pid: int) -> None:
    if IS_WINDOWS:
        # Ask first (closes a browser window cleanly), then force.
        for args in (["/T"], ["/T", "/F"]):
            subprocess.run(["taskkill", "/PID", str(pid), *args], capture_output=True,
                           creationflags=CREATE_NO_WINDOW, timeout=15)
            for _ in range(30):
                if not pid_alive(pid):
                    return
                time.sleep(0.1)
        return
    import signal

    try:
        # Each server was started in its own session, so its group is its pid.
        os.killpg(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        if not pid_alive(pid):
            return
        time.sleep(0.1)
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pid, signal.SIGKILL)


def _port_owner(port: int) -> int:
    """Pid listening on *port* on loopback, or 0."""
    try:
        if IS_WINDOWS:
            # errors="replace": netstat prints the OEM code page (cp949 here), not
            # UTF-8, and only the ASCII columns are read.
            out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True,
                                 errors="replace", creationflags=CREATE_NO_WINDOW,
                                 timeout=15).stdout
            for line in out.splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[3] == "LISTENING" and parts[1].endswith(f":{port}"):
                    return int(parts[4])
            return 0
        lsof = shutil.which("lsof")
        if lsof:
            out = subprocess.run([lsof, "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
                                 capture_output=True, text=True, timeout=15).stdout
            return int(out.split()[0]) if out.split() else 0
    except Exception:
        pass
    return 0


def cmd_stop() -> int:
    for pid in office_window_pids():
        if pid_alive(pid):
            _kill_tree(pid)
            log(f"stopped browser (pid {pid})")
    with contextlib.suppress(FileNotFoundError):
        (RUN_DIR / "browser.pid").unlink()  # written by older versions

    for name in ("frontend", "backend"):
        pid = read_pid(name)
        if pid and pid_alive(pid):
            pname = process_name(pid)
            if any(n in pname for n in EXPECTED_NAMES[name]):
                _kill_tree(pid)
                log(f"stopped {name} (pid {pid})")
            else:
                log(f"skip {name}: pid {pid} is now '{pname}', not ours")
        with contextlib.suppress(FileNotFoundError):
            (RUN_DIR / f"{name}.pid").unlink()

    # Servers started some other way (or whose pid file was lost): stop the
    # Python process holding the port.
    for name, port, up in (("frontend", FRONTEND_PORT, frontend_up),
                           ("backend", BACKEND_PORT, backend_up)):
        if up():
            pid = _port_owner(port)
            if pid and "python" in process_name(pid):
                _kill_tree(pid)
                log(f"stopped {name} on :{port} (pid {pid})")
            elif up():
                log(f"{name} still answers on :{port} (pid {pid or '?'}); stop it by hand")

    with contextlib.suppress(FileNotFoundError):
        LOCK_FILE.unlink()
    for _ in range(20):
        if not backend_up(0.3) and not frontend_up(0.3):
            log("office stopped")
            return 0
        time.sleep(0.25)
    return 1


def cmd_status() -> int:
    b, f = backend_up(), frontend_up()
    print(f"backend  {BACKEND_HEALTH:<40} {'up' if b else 'down'}")
    print(f"frontend {FRONTEND_URL:<40} {'up' if f else 'down'}")
    print(f"logs     {LOG_DIR}")
    return 0 if b and f else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("hook")
    p_ensure = sub.add_parser("ensure")
    p_ensure.add_argument("--open", action="store_true", help="open the window even if already up")
    p_ensure.add_argument("--quiet", action="store_true", help="log to file only")
    sub.add_parser("stop")
    sub.add_parser("status")
    args = parser.parse_args()

    if args.command == "hook":
        return cmd_hook()
    if args.command == "ensure":
        if args.quiet:
            sys._agent_office_quiet = True  # type: ignore[attr-defined]
        return cmd_ensure(args.open)
    if args.command == "stop":
        return cmd_stop()
    return cmd_status()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "hook":
        # The hook must never fail or speak, whatever happens.
        with contextlib.suppress(BaseException):
            cmd_hook()
        os._exit(0)
    sys.exit(main())
