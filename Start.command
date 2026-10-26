#!/bin/sh
set -eu
SEEGEO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SEEGEO_ROOT/scripts/runtime.sh"
if [ ! -d node_modules ]; then
  echo '首次使用，先安装依赖…'
  npm ci
fi
# Rebuild the panel from the checked-out version after upgrades or Git rollback.
npm run build
if [ ! -d '/Applications/Google Chrome.app' ]; then
  echo '请先安装 Google Chrome，再启动采集。'; exit 1
fi
SEEGEO_OPEN_PORT=${SEEGEO_PORT:-4317}
(sleep 2; open "http://127.0.0.1:$SEEGEO_OPEN_PORT") &
exec npm start
