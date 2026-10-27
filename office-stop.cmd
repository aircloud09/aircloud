@echo off
rem Agent Office: stop both servers and close the office window.
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0launcher\agent_office.py" stop
