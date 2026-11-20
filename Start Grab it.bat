@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 18 or newer was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Copy .env.example to .env and fill in your Supabase and Razorpay Test Mode settings.
  pause
  exit /b 1
)
echo Starting Grab it locally. Keep the server window open while you use the site.
start "Grab it server" cmd /k node server.mjs
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
