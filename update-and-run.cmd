@echo off
setlocal
cd /d "%~dp0"
call "%~dp0AEGIS-UPDATE-AND-RUN.cmd"
exit /b %ERRORLEVEL%
