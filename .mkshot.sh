#!/bin/sh
cd /home/user/MM6-Loop-IPhone-
pkill -f "vite --config vite.mk.config.js" >/dev/null 2>&1
sleep 1
nohup npx vite --config vite.mk.config.js > /tmp/vite-mk.log 2>&1 &
sleep 8
MM6_URL=http://127.0.0.1:5183/ MM6_OUT=shots/mk MM6_CLEAN=1 node tools/capture.mjs tools/scripts/_mk.mjs 2>&1 | tail -1
