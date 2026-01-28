#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ICON="$ROOT_DIR/build/icon.svg"
OUT_ICNS="$ROOT_DIR/build/icon.icns"
OUT_PNG="$ROOT_DIR/build/icon.png"
ICONSET_DIR="$ROOT_DIR/build/icon.iconset"
RASTER_1024="$ROOT_DIR/build/icon-1024.png"

if [[ ! -f "$SRC_ICON" ]]; then
  echo "Missing source icon: $SRC_ICON" >&2
  exit 1
fi

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 1024 -h 1024 "$SRC_ICON" -o "$RASTER_1024"
elif command -v qlmanage >/dev/null 2>&1; then
  tmp_dir="$(mktemp -d)"
  qlmanage -t -s 1024 -o "$tmp_dir" "$SRC_ICON" >/dev/null 2>&1
  cp "$tmp_dir/$(basename "$SRC_ICON").png" "$RASTER_1024"
  rm -rf "$tmp_dir"
else
  echo "No SVG rasterizer found (need rsvg-convert or qlmanage)." >&2
  exit 1
fi

for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" "$RASTER_1024" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  dbl=$((size * 2))
  sips -s format png -z "$dbl" "$dbl" "$RASTER_1024" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

sips -s format png -z 1024 1024 "$RASTER_1024" --out "$OUT_PNG" >/dev/null

if iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"; then
  echo "  $OUT_ICNS"
else
  echo "Warning: iconutil failed to generate ICNS on this machine. PNG icon is still available." >&2
fi

echo "Generated:"
echo "  $OUT_PNG"
