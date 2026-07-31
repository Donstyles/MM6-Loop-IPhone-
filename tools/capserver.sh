#!/bin/sh
# Restart the screenshot server so it picks up the current source.
# The capture server runs with hot reload off, so it must be bounced by hand
# whenever we want a capture to reflect new code.
cd "$(dirname "$0")/.." || exit 1
pkill -f "vite.capture.config" 2>/dev/null
sleep 1
npx vite --config vite.capture.config.js > /tmp/vite-cap.log 2>&1 &
for i in $(seq 1 30); do
  sleep 1
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5174/ 2>/dev/null | grep -q 200; then
    echo "capture server up (${i}s)"
    exit 0
  fi
done
echo "capture server failed to start"
tail -5 /tmp/vite-cap.log
exit 1
