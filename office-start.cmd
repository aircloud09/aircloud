@echo off
rem Agent Office: start the office if needed and open its window.
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0launcher\agent_office.py" ensure --open
