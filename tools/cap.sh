#!/bin/sh
# Capture wrapper: makes sure the screenshot server is up first, and brings it
# back if a concurrent bounce took it down mid-run.
#   tools/cap.sh <script> <outdir>
cd "$(dirname "$0")/.." || exit 1
up() { [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5174/ 2>/dev/null)" = "200" ]; }
for try in 1 2 3; do
  up || ./tools/capserver.sh >/dev/null 2>&1
  if MM6_URL=http://127.0.0.1:5174/ MM6_OUT="$2" MM6_CLEAN=1 node tools/capture.mjs "$1" 2>/tmp/cap.err; then
    exit 0
  fi
  echo "capture attempt $try failed, retrying" >&2
  sleep 3
done
tail -5 /tmp/cap.err >&2
exit 1
