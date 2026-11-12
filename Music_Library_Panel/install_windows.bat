@echo off
title Cai dat Music Library cho DaVinci Resolve
:: Tu dong xin quyen Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Dang xin quyen Administrator, hay bam Yes khi Windows hoi...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "SRC=%~dp0Music_Library_Plugin"
set "RES=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support"
set "DEST=%RES%\Workflow Integration Plugins\Music_Library_Plugin"
set "NODE=%RES%\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node"
if not exist "%RES%" goto noresolve
if not exist "%NODE%" goto nonode
mkdir "%DEST%" 2>nul
xcopy "%SRC%\*" "%DEST%\" /E /I /Y >nul
if exist "%DEST%\__pycache__" rmdir /s /q "%DEST%\__pycache__"
copy /Y "%NODE%" "%DEST%\WorkflowIntegration.node" >nul
echo.
echo CAI DAT XONG.
echo Buoc tiep: TAT HAN DaVinci Resolve roi mo lai.
echo Mo panel: menu Workspace ^> Workflow Integrations ^> Music Library
pause
exit /b 0
:noresolve
echo Khong tim thay DaVinci Resolve tren may nay. Hay cai DaVinci Resolve Studio truoc.
pause
exit /b 1
:nonode
echo Khong tim thay file WorkflowIntegration.node cua Blackmagic.
echo Hay lam theo muc "Cach cai thu cong" trong file README_CAI_DAT.txt.
pause
exit /b 1
