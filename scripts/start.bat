@echo off
rem FACET indító Windowsra
cd /d "%~dp0"
where javac >nul 2>nul
if errorlevel 1 (
  echo Nem talalok JDK-t. Telepitsd: https://adoptium.net
  pause
  exit /b 1
)
java Facet.java %*
pause
