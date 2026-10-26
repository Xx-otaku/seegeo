#!/bin/sh
# Shared runtime discovery. No dependency on Codex or a global package manager.
set -eu
: "${SEEGEO_ROOT:?SEEGEO_ROOT must point to the project directory}"
if [ -x "$SEEGEO_ROOT/.runtime/node/bin/node" ]; then
  export PATH="$SEEGEO_ROOT/.runtime/node/bin:$PATH"
elif command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ]; then
  :
else
  if [ "$(uname -s)" != Darwin ]; then
    echo '请安装 Node.js 24 后重新运行。'; exit 1
  fi
  SEEGEO_ARCH=$(uname -m)
  case "$SEEGEO_ARCH" in arm64) ;; x86_64) SEEGEO_ARCH=x64 ;; *) echo '不支持此架构'; exit 1 ;; esac
  SEEGEO_TMP=$(mktemp -d)
  trap 'rm -rf "$SEEGEO_TMP"' EXIT HUP INT TERM
  echo '首次准备：下载官方 Node.js 24 到项目 .runtime 目录（不修改系统安装）…'
  curl -fsSL --retry 2 --connect-timeout 20 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -o "$SEEGEO_TMP/SHASUMS256.txt"
  SEEGEO_FILE=$(awk -v arch="$SEEGEO_ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-darwin-" arch "\\.tar\\.gz$") {print $2; exit}' "$SEEGEO_TMP/SHASUMS256.txt")
  [ -n "$SEEGEO_FILE" ] || { echo '无法找到官方 Node.js 24 下载文件'; exit 1; }
  curl -fL --retry 2 --connect-timeout 20 "https://nodejs.org/dist/latest-v24.x/$SEEGEO_FILE" -o "$SEEGEO_TMP/$SEEGEO_FILE"
  (cd "$SEEGEO_TMP" && awk -v file="$SEEGEO_FILE" '$2==file' SHASUMS256.txt | shasum -a 256 -c -)
  mkdir -p "$SEEGEO_ROOT/.runtime/node"
  tar -xzf "$SEEGEO_TMP/$SEEGEO_FILE" -C "$SEEGEO_ROOT/.runtime/node" --strip-components=1
  export PATH="$SEEGEO_ROOT/.runtime/node/bin:$PATH"
  rm -rf "$SEEGEO_TMP"
  trap - EXIT HUP INT TERM
fi
cd "$SEEGEO_ROOT"
