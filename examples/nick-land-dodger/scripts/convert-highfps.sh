#!/usr/bin/env bash
set -euo pipefail

# Speed up a slow-mo recording (cdp.mjs recordVideo, CDP screencast frames at 25 FPS) to produce high-FPS output.
# Usage: convert-highfps.sh <input.webm> <output.mp4> [slow_mo_factor]

INPUT="${1:?Usage: convert-highfps.sh <input> <output> [factor]}"
OUTPUT="${2:?Usage: convert-highfps.sh <input> <output> [factor]}"
FACTOR="${3:-0.5}"

if [ ! -f "$INPUT" ]; then
  echo "Error: input file not found: $INPUT" >&2
  exit 1
fi

OUTPUT_FPS=$(echo "25 / $FACTOR" | bc)

echo "Converting: $INPUT -> $OUTPUT"
echo "  Factor: ${FACTOR} | Output FPS: ${OUTPUT_FPS}"

ffmpeg -y -i "$INPUT" \
  -vf "setpts=${FACTOR}*PTS" \
  -r "$OUTPUT_FPS" \
  -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
  -movflags +faststart -an \
  "$OUTPUT"

echo ""
echo "Verifying output..."
DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUTPUT")
ACTUAL_FPS=$(ffprobe -v quiet -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$OUTPUT")

echo "  Duration: ${DURATION}s"
echo "  Frame rate: ${ACTUAL_FPS}"
echo "  File size: $(du -h "$OUTPUT" | cut -f1)"
echo "Done."
