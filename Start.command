#!/bin/sh
set -eu
SEEGEO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SEEGEO_ROOT/scripts/runtime.sh"
if [ ! -d node_modules ] || [ ! -d dist ]; then
  echo '首次使用，先安装并构建…'
  npm ci
  npm run build
fi
if [ ! -d '/Applications/Google Chrome.app' ]; then
  echo '请先安装 Google Chrome，再启动采集。'; exit 1
fi
SEEGEO_OPEN_PORT=${SEEGEO_PORT:-4317}
(sleep 2; open "http://127.0.0.1:$SEEGEO_OPEN_PORT") &
exec npm start
