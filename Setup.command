#!/bin/sh
set -eu
SEEGEO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SEEGEO_ROOT/scripts/runtime.sh"
echo '安装锁定依赖并构建 seegeo…'
npm ci
npm run build
echo '准备完成。双击 Start.command 启动。'
