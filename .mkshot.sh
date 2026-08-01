#!/bin/sh
cd /home/user/MM6-Loop-IPhone-
for p in $(pgrep -f "config vite.mk.config.js"); do kill -9 $p 2>/dev/null; done
sleep 2
nohup node node_modules/.bin/vite --config vite.mk.config.js > /tmp/vite-mk.log 2>&1 &
sleep 8
MM6_URL=http://127.0.0.1:5183/ MM6_OUT=/tmp/claude-0/-home-user-MM6-Loop-IPhone-/f6a4af04-9b10-5ade-9238-6b27e5726723/scratchpad/shots MM6_CLEAN=1 node tools/capture.mjs tools/scripts/_mk.mjs > /tmp/cap-mk.log 2>&1
grep -c '^shot' /tmp/cap-mk.log
