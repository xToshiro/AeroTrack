@echo off
setlocal
title AeroTrack ADS-B Radar
echo ========================================================
echo             Iniciando AeroTrack ADS-B Radar
echo ========================================================
echo.

:: Garante execucao no diretorio onde o arquivo run.bat reside
cd /d "%~dp0"

:: 1. Verifica se existe ambiente virtual local (.venv ou venv)
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PY_CMD=%~dp0.venv\Scripts\python.exe"
    goto :RUN
)
if exist "%~dp0venv\Scripts\python.exe" (
    set "PY_CMD=%~dp0venv\Scripts\python.exe"
    goto :RUN
)

:: 2. Tenta o inicializador padrao do Python para Windows (py)
where py >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_CMD=py"
    goto :RUN
)

:: 3. Tenta python disponivel no PATH do sistema
where python >nul 2>&1
if %errorlevel% equ 0 (
    python -c "import sys" >nul 2>&1
    if %errorlevel% equ 0 (
        set "PY_CMD=python"
        goto :RUN
    )
)

:: 4. Tenta instalacoes locais no perfil de usuario via variavel de ambiente %LOCALAPPDATA%
if defined LOCALAPPDATA (
    if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
        set "PY_CMD=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
        goto :RUN
    )
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python*") do (
        if exist "%%D\python.exe" (
            set "PY_CMD=%%D\python.exe"
            goto :RUN
        )
    )
)

echo [ERRO] Python 3.10+ nao foi encontrado neste sistema.
echo Por favor, certifique-se de instalar o Python ou adiciona-lo ao PATH.
echo Download disponivel em: https://www.python.org/downloads/
echo.
pause
exit /b 1

:RUN
echo Executando com interpretador: %PY_CMD%
%PY_CMD% server.py

if %errorlevel% neq 0 (
    echo.
    echo [AVISO] O servidor foi encerrado com codigo de saida %errorlevel%.
)
pause

