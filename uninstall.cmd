@echo off
rem Agent Office: stop the servers and remove only the hooks it added.
setlocal
uv run --no-project --python 3.13 "%~dp0launcher\install.py" --uninstall
