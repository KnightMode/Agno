#!/bin/bash
# Patch Electron.app bundle name for dev mode so macOS menu bar shows "Agno"
PLIST="node_modules/electron/dist/Electron.app/Contents/Info.plist"
if [ -f "$PLIST" ]; then
  plutil -replace CFBundleName -string "Agno" "$PLIST"
  plutil -replace CFBundleDisplayName -string "Agno" "$PLIST"
  plutil -replace CFBundleSpokenName -string "Agno" "$PLIST"
fi
