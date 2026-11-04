#!/usr/bin/env bash
# 从 SVG 母版生成全套 favicon / PWA 图标。
#
# 为什么要绕一圈浏览器：ImageMagick 自带的 MSVG 渲染器会丢掉 rx 圆角、
# 圆头描边（stroke-linecap）和 opacity，出来的图是坏的。所以先用 Chromium
# 内核把 SVG 渲染成 1024px 位图，再用 ImageMagick 只做缩放和拼装。
#
# 依赖：Chromium 内核浏览器（默认 Helium，可用 BROWSER=... 覆盖）、ImageMagick 7
# 用法：npm run icons

set -euo pipefail
cd "$(dirname "$0")/.."

BROWSER="${BROWSER:-/Applications/Helium.app/Contents/MacOS/Helium}"
if [ ! -x "$BROWSER" ]; then
  echo "找不到浏览器：$BROWSER" >&2
  echo "用 BROWSER=/path/to/chrome npm run icons 指定一个 Chromium 内核浏览器" >&2
  exit 1
fi
command -v magick >/dev/null || { echo "需要 ImageMagick 7（brew install imagemagick）" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# render <svg 路径> <输出 png> [transparent]
render() {
  local svg="$1" out="$2" transparent="${3:-}"
  # 不用数组：macOS 自带 bash 3.2，空数组配 set -u 会报 unbound variable
  local bg=""
  [ -n "$transparent" ] && bg="--default-background-color=00000000"
  rm -f "$out"
  # shellcheck disable=SC2086  # $bg 为空时必须展开成零个参数
  "$BROWSER" --headless=new --no-sandbox --disable-gpu \
    --user-data-dir=/tmp/helium-icon-profile \
    $bg \
    --window-size=1024,1024 --virtual-time-budget=3000 \
    --screenshot="$out" "file://$(cd "$(dirname "$svg")" && pwd)/$(basename "$svg")" \
    >/dev/null 2>&1
  [ -s "$out" ] || { echo "渲染失败：$svg" >&2; exit 1; }
}

echo "· 渲染母版"
render public/icon.svg "$TMP/round.png" transparent
render scripts/icon/icon-small.svg "$TMP/small.png" transparent
render scripts/icon/icon-square.svg "$TMP/square.png"

echo "· 派生位图"
# 16 / 32 用简化版（没有正文行），否则三行会糊成一团
for size in 16 32; do
  magick "$TMP/small.png" -filter Lanczos -resize "${size}x${size}" "public/favicon-${size}x${size}.png"
done
# 48 起细节能看清，用完整版
magick "$TMP/round.png" -filter Lanczos -resize 48x48 public/favicon-48x48.png

# 满幅版本：iOS / Android 会自己裁形状，必须铺满不能有透明角
magick "$TMP/square.png" -filter Lanczos -resize 180x180 public/apple-touch-icon.png
magick "$TMP/square.png" -filter Lanczos -resize 192x192 public/android-chrome-192x192.png
magick "$TMP/square.png" -filter Lanczos -resize 512x512 public/android-chrome-512x512.png
magick "$TMP/square.png" -filter Lanczos -resize 150x150 public/mstile-150x150.png

# maskable：内容要缩进安全区（直径 80% 的圆内），否则被系统裁掉边角
magick "$TMP/square.png" -filter Lanczos -resize 380x380 \
  -background "#C0392B" -gravity center -extent 512x512 public/maskable-512x512.png

# ICO 里塞 16/32/48 三档，老浏览器和 Windows 快捷方式会按需取用
magick public/favicon-16x16.png public/favicon-32x32.png public/favicon-48x48.png public/favicon.ico

echo "· 结果"
cd public
magick identify -format "%f  %wx%h  %[channels]\n" \
  favicon-16x16.png favicon-32x32.png favicon-48x48.png favicon.ico \
  apple-touch-icon.png android-chrome-192x192.png android-chrome-512x512.png \
  maskable-512x512.png mstile-150x150.png
