@echo off
echo [1/3] Compiling C++ Audio Engine...
cd audio-engine-cpp
cmake --build build --config Debug
if %errorlevel% neq 0 (
    echo CRITICAL: C++ Compilation failed!
    pause
    exit /b %errorlevel%
)

echo [2/3] Syncing Sidecar to Tauri...
copy /y "build\Debug\AudioEngine.exe" "..\music-player-ui\src-tauri\bin\AudioEngine-x86_64-pc-windows-msvc.exe"

echo [3/3] Launching DmeX-Player UI...
cd ../music-player-ui
npm run tauri dev