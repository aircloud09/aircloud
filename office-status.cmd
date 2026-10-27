@echo off
rem Agent Office: show whether the servers answer.
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0launcher\agent_office.py" status
