@echo off
setlocal enabledelayedexpansion

set BOOTSTRAP=docker-compose.yml
set SECURE=docker-compose.secure.yml
set DATA_DIR=C:\Users\Ангелина\BSQBD\data

echo === PHASE 1: BOOTSTRAP (no auth) ===

echo [1/7] Stop everything...
docker compose -f %BOOTSTRAP% down -v >nul 2>&1
docker compose -f %SECURE% down -v >nul 2>&1

echo [2/7] Cleaning data...

if exist "%DATA_DIR%" (
    rmdir /s /q "%DATA_DIR%" >nul 2>&1
)

mkdir "%DATA_DIR%" >nul 2>&1

echo [3/7] Start bootstrap cluster...
docker compose -f %BOOTSTRAP% up -d

echo [4/7] Waiting for mongo-init...

set TIMEOUT=300

:WAIT_INIT
set STATUS=

for /f %%i in ('docker inspect --format="{{.State.Status}}" funkcni_reseni-mongo-init-1 2^>nul') do set STATUS=%%i

if "!STATUS!"=="exited" goto CHECK_INIT

set /a TIMEOUT-=1
if !TIMEOUT! LEQ 0 (
    echo Timeout waiting for mongo-init
    exit /b 1
)

timeout /t 1 >nul
goto WAIT_INIT


:CHECK_INIT
for /f %%i in ('docker inspect --format="{{.State.ExitCode}}" funkcni_reseni-mongo-init-1') do set EXITCODE=%%i

if "!EXITCODE!"=="0" (
    echo mongo-init finished successfully.
) else (
    echo mongo-init FAILED with code !EXITCODE!
    docker compose -f %BOOTSTRAP% logs --tail=200 mongo-init
    exit /b 1
)

echo [4.5/7] Checking mongo-import...

for /f %%i in ('docker inspect --format="{{.State.ExitCode}}" funkcni_reseni-mongo-import-1 2^>nul') do set IMPORT_EXIT=%%i

if not "!IMPORT_EXIT!"=="0" (
    echo mongo-import FAILED with code !IMPORT_EXIT!
    docker compose -f %BOOTSTRAP% logs --tail=200 mongo-import
    exit /b 1
)

echo mongo-import OK

echo [5/7] Stopping bootstrap cluster...
docker compose -f %BOOTSTRAP% down

echo.
echo === PHASE 2: SECURE (auth + keyfile) ===

echo [6/7] Generating dynamic MongoDB keyfile...

if not exist secrets mkdir secrets

powershell -NoProfile -Command ^
  "$key = [Convert]::ToBase64String((1..756 | ForEach-Object { Get-Random -Maximum 256 }));" ^
  "Set-Content -NoNewline -Encoding ASCII 'secrets\mongo-keyfile' $key"

echo Keyfile generated: secrets\mongo-keyfile

echo [7/7] Starting secure cluster...
docker compose -f %SECURE% up -d

echo Waiting for mongos...

set TIMEOUT=120

:WAIT_MONGOS
docker logs funkcni_reseni-mongos1-1 2>&1 | findstr "waiting for connections" >nul

if not errorlevel 1 (
    echo mongos is ready
    goto DONE
)

set /a TIMEOUT-=1
if !TIMEOUT! LEQ 0 (
    echo Timeout waiting for mongos
    docker logs funkcni_reseni-mongos1-1
    exit /b 1
)

timeout /t 2 >nul
goto WAIT_MONGOS


:DONE
echo.
echo === FINAL STATUS ===
docker compose -f %SECURE% ps

echo.
echo LUSTER READY
echo Mongo: mongodb://admin@localhost:27017/admin
echo Mongo Express: http://localhost:8082

endlocal