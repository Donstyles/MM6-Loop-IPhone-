#!/bin/sh
cd /home/user/MM6-Loop-IPhone-
for p in $(ps -eo pid,args | awk '/[v]ite --config vite.mk.config.js/ && /node/ {print $1}'); do kill -9 $p 2>/dev/null; done
sleep 2
nohup node node_modules/.bin/vite --config vite.mk.config.js > /tmp/vite-mk.log 2>&1 &
sleep 7
MM6_URL=http://127.0.0.1:5183/ MM6_OUT=/tmp/mk9 MM6_CLEAN=1 node tools/capture.mjs tools/scripts/_mk.mjs > /tmp/cap-mk.log 2>&1
node tools/zoom.mjs /tmp/mk9/m-spell.png 396 8 76 320 4 /tmp/mk9/tabs.png
node tools/zoom.mjs /tmp/mk9/m-guild.png 150 60 200 130 4 /tmp/mk9/tomes.png
