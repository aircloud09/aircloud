@echo off
rem Agent Office: install deps, build, and register Claude Code hooks.
setlocal
where uv >nul 2>nul
if errorlevel 1 (
  echo uv is not installed. Install it, open a new terminal, and run this again:
  echo   winget install --id=astral-sh.uv -e
  exit /b 1
)
uv run --no-project --python 3.13 "%~dp0launcher\install.py" %*
