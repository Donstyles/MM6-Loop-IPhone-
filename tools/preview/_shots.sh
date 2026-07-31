#!/bin/sh
# Warm vite twice: the first load after an edit triggers an HMR full-reload
# that races the screenshot tool's __ready wait and yields a black frame.
cd /home/user/MM6-Loop-IPhone-
node tools/preview/_probe.mjs "http://127.0.0.1:5173/tools/preview/world.html?region=new_sorpigal" >/dev/null 2>&1
node tools/preview/_probe.mjs "http://127.0.0.1:5173/tools/preview/world.html?mode=dungeon" >/dev/null 2>&1
for spec in "$@"; do
  url="${spec%%::*}"; out="${spec##*::}"
  node tools/shot.mjs "http://127.0.0.1:5173/tools/preview/world.html?$url" "shots/world/$out.png" 1000 760 2000 2>&1 | head -1
done
