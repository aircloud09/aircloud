#!/usr/bin/env python3
"""Install (or remove) Agent Office for Claude Code CLI and the desktop app.

Run through ``install.cmd`` on Windows (``uv run --no-project --python 3.13
launcher/install.py``). Steps:

1. Check uv, Node 20+ and a package manager; print how to install what is missing.
2. ``uv sync`` the backend (Python 3.13+).
3. Install the frontend packages and build the static export (frontend/out).
4. ``uv tool install`` the event hook (claude-office-hook).
5. Write ~/.claude/claude-office-config.env and backend/.env (no token use).
6. Merge the hooks into ~/.claude/settings.json with absolute paths, keeping
   every hook already there.

``--uninstall`` stops the office and removes only what step 4 and 6 added.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hook_settings  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
HOOKS = ROOT / "hooks"
LAUNCHER = ROOT / "launcher" / "agent_office.py"
IS_WINDOWS = os.name == "nt"
CONFIG_ENV = Path.home() / ".claude" / "claude-office-config.env"

BUILD_ENV = {"NEXT_PUBLIC_API_URL": "http://127.0.0.1:8000"}

INSTALL_HELP = {
    "uv": (
        "  winget install --id=astral-sh.uv -e\n"
        '  (or) powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
    ),
    "node": "  winget install OpenJS.NodeJS.LTS   (Node 20 or newer)",
}


def step(msg: str) -> None:
    print(f"\n== {msg}", flush=True)


def run(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print("  $ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, env={**os.environ, **env} if env else None)


def fwd(path: Path) -> str:
    """Absolute path with forward slashes, quoted if it has spaces.

    Claude Code runs hook commands through a shell (Git Bash on Windows);
    ``C:/Users/me/...`` works there and in cmd, backslashes do not.
    """
    s = path.absolute().as_posix()  # not resolve(): keep venv symlinks
    return f'"{s}"' if " " in s else s


def find_uv() -> str | None:
    return os.environ.get("UV") or shutil.which("uv")


def check_prereqs() -> dict[str, str]:
    step("Checking prerequisites")
    found: dict[str, str] = {}
    missing: list[str] = []

    uv = find_uv()
    if uv:
        found["uv"] = uv
        print(f"  uv      OK  {uv}")
    else:
        missing.append("uv")

    v = sys.version_info
    print(f"  python  {'OK' if v >= (3, 13) else 'OLD'}  {v.major}.{v.minor}.{v.micro} "
          "(backend uses its own 3.13+ venv via uv)")

    node = shutil.which("node")
    if node:
        out = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
        m = re.match(r"v(\d+)", out)
        if m and int(m.group(1)) >= 20:
            found["node"] = node
            print(f"  node    OK  {out}")
        else:
            print(f"  node    TOO OLD  {out}")
            missing.append("node")
    else:
        missing.append("node")

    pkg = shutil.which("bun") or shutil.which("npm")
    if pkg:
        found["pkg"] = pkg
        print(f"  pkg     OK  {pkg}")
    elif "node" not in missing:
        missing.append("node")

    if missing:
        print("\nMissing:")
        for name in dict.fromkeys(missing):
            print(f"- {name}\n{INSTALL_HELP[name]}")
        print("\nInstall them, open a new terminal, and run install.cmd again.")
        sys.exit(1)
    return found


def update_env_file(path: Path, values: dict[str, str], keep_existing: set[str]) -> None:
    """Set *values* in a KEY=VALUE file, keeping all other lines.

    Keys in *keep_existing* are only written when the file does not set them.
    """
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    present = {ln.split("=", 1)[0].strip() for ln in lines if "=" in ln and not ln.startswith("#")}
    out: list[str] = []
    for ln in lines:
        key = ln.split("=", 1)[0].strip() if "=" in ln and not ln.startswith("#") else None
        if key in values and key not in keep_existing:
            out.append(f"{key}={values[key]}")
        else:
            out.append(ln)
    for key, value in values.items():
        if key not in present:
            out.append(f"{key}={value}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def hook_exe(uv: str) -> Path:
    bindir = subprocess.run([uv, "tool", "dir", "--bin"], capture_output=True, text=True,
                            check=True).stdout.strip()
    return Path(bindir) / ("claude-office-hook.exe" if IS_WINDOWS else "claude-office-hook")


def launcher_python() -> Path:
    # pythonw: no console window flashes when the hook runs.
    if IS_WINDOWS:
        return BACKEND / ".venv" / "Scripts" / "pythonw.exe"
    return BACKEND / ".venv" / "bin" / "python"


def install(skip_build: bool) -> None:
    tools = check_prereqs()
    uv = tools["uv"]

    step("Backend: uv sync (Python 3.13+)")
    run([uv, "sync", "--python", "3.13"], cwd=BACKEND)

    if skip_build and (FRONTEND / "out" / "index.html").exists():
        step("Frontend: build skipped (--skip-build)")
    else:
        pkg = tools["pkg"]
        step("Frontend: install packages and build the static export")
        run([pkg, "install"], cwd=FRONTEND)
        # The export is served on :4747 apart from the backend, so bake the
        # backend origin in (the build otherwise calls its own origin).
        run([pkg, "run", "build"], cwd=FRONTEND, env=BUILD_ENV)

    step("Event hook: uv tool install claude-office-hooks")
    run([uv, "tool", "install", "--force", "--python", "3.13", str(HOOKS)])
    exe = hook_exe(uv)
    if not exe.exists():
        sys.exit(f"ERROR: {exe} was not created")

    step("Config: view only, zero extra tokens")
    user = os.environ.get("USERNAME") or os.environ.get("USER") or Path.home().name
    prefixes = (f"C--Users-{user}-Repos-,C--Users-{user}-" if IS_WINDOWS
                else f"-Users-{user}-Repos-,-Users-{user}-,-home-{user}-")
    update_env_file(
        CONFIG_ENV,
        {
            # 127.0.0.1, not localhost: Windows tries ::1 first and a refused
            # IPv6 connect costs up to the hook's whole 0.5 s timeout.
            "CLAUDE_OFFICE_API_URL": "http://127.0.0.1:8000/api/v1/events",
            "CLAUDE_OFFICE_STRIP_PREFIXES": f'"{prefixes}"',
            "CLAUDE_OFFICE_DEBUG": "0",
        },
        keep_existing={"CLAUDE_OFFICE_STRIP_PREFIXES", "CLAUDE_OFFICE_DEBUG"},
    )
    print(f"  wrote {CONFIG_ENV}")
    update_env_file(
        BACKEND / ".env",
        {"SUMMARY_ENABLED": "false", "SUMMARY_BACKEND": "disabled", "CLAUDE_CODE_OAUTH_TOKEN": ""},
        keep_existing=set(),
    )
    print(f"  wrote {BACKEND / '.env'} (summaries / agent names: no model calls)")

    step("Claude Code hooks: merge into settings.json")
    # "|| exit 0": even a missing interpreter must not fail the session
    # (valid in both Git Bash and cmd).
    launcher_cmd = f"{fwd(launcher_python())} {fwd(LAUNCHER)} hook || exit 0"
    hook_settings.install(exe.absolute().as_posix(), launcher_cmd)

    print("\nDone. Restart Claude Code (CLI and desktop app) so it reloads the hooks.")
    print("The next session opens the office window if the server is not running.")


def uninstall() -> None:
    step("Stopping the office")
    py = BACKEND / ".venv" / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
    if py.exists():
        subprocess.run([str(py), str(LAUNCHER), "stop"])
    step("Removing our hooks from settings.json (others are kept)")
    hook_settings.uninstall()
    uv = find_uv()
    if uv:
        subprocess.run([uv, "tool", "uninstall", "claude-office-hooks"])
    print("\nDone. ~/.agent-office (logs, window profile) and the config file are left in place.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Install Agent Office for Claude Code.")
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument("--check", action="store_true", help="only check prerequisites")
    parser.add_argument("--skip-build", action="store_true",
                        help="reuse an existing frontend/out build")
    args = parser.parse_args()
    if args.check:
        check_prereqs()
    elif args.uninstall:
        uninstall()
    else:
        install(args.skip_build)


if __name__ == "__main__":
    main()
