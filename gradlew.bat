@echo off
setlocal
set "URL=https://services.gradle.org/distributions/gradle-8.9-bin.zip"
set "BASE=%USERPROFILE%\.gradle\wrapper\dists\localify-crimson\gradle-8.9-bin"
set "GRADLE_BIN=%BASE%\gradle-8.9\bin\gradle.bat"
if not exist "%GRADLE_BIN%" (
  if not exist "%BASE%" mkdir "%BASE%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing '%URL%' -OutFile '%BASE%\gradle-8.9-bin.zip'; Expand-Archive -Force '%BASE%\gradle-8.9-bin.zip' '%BASE%'; Remove-Item '%BASE%\gradle-8.9-bin.zip' -Force"
  if errorlevel 1 exit /b 1
)
call "%GRADLE_BIN%" %*
exit /b %ERRORLEVEL%
