@echo off
title AeroTrack ADS-B Radar - TAM3734
echo ========================================================
echo       Iniciando AeroTrack ADS-B Radar // TAM3734
echo ========================================================
echo.

set PYTHON_PATH="C:\Users\jairo\AppData\Local\Python\pythoncore-3.14-64\python.exe"

if exist %PYTHON_PATH% (
    %PYTHON_PATH% server.py
) else (
    python server.py
)

pause
