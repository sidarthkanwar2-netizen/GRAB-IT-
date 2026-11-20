@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18.17 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist ".env" (
  echo The .env file is missing. Keep it beside server.mjs and add your Razorpay Test Mode keys.
  pause
  exit /b 1
)
echo Starting Grab it locally. Keep the server window open while you use the site.
start "Grab it server" cmd /k node server.mjs
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
