#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RTSP_TOOLS_DIR="${SCRIPT_DIR}/agentic/vss-sop-skills/vss-sop-build/references/deployments/sop/sop-app/helper-scripts/rtsp_tools"
RTSP_SERVER="${RTSP_TOOLS_DIR}/rtsp_server.py"
STATE_DIR="${SCRIPT_DIR}/.rtsp"
VIDEO_STATE_FILE="${STATE_DIR}/video_path"
SOURCE_PORT=8552
SOURCE_MOUNT="/sensor_0"
RELAY_PORT=8554
RELAY_MOUNT="/ds-out/sensor_0"
SOURCE_URL="rtsp://127.0.0.1:${SOURCE_PORT}${SOURCE_MOUNT}"
RELAY_URL="rtsp://127.0.0.1:${RELAY_PORT}${RELAY_MOUNT}"
VIDEO_FILE=""

usage() {
  cat <<EOF
用法：
  $0 [MP4 路徑]
  $0 --video /path/to/video.mp4

選項：
  -f, --video PATH  要循環播放的 MP4
  -h, --help        顯示說明

未指定 MP4 時，會沿用上次成功啟動所使用的影片。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--video)
      if [[ $# -lt 2 ]]; then
        echo "錯誤：$1 後面需要 MP4 路徑。" >&2
        exit 1
      fi
      VIDEO_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "錯誤：未知選項 $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "${VIDEO_FILE}" ]]; then
        echo "錯誤：只能指定一個 MP4。" >&2
        exit 1
      fi
      VIDEO_FILE="$1"
      shift
      ;;
  esac
done

if [[ ! -f "${RTSP_SERVER}" ]]; then
  echo "錯誤：找不到 RTSP server：${RTSP_SERVER}" >&2
  exit 1
fi

mapfile -t RUNNING_PIDS < <(
  pgrep -f "${RTSP_SERVER}.*(--port[= ]${SOURCE_PORT}|--mount[= ]${SOURCE_MOUNT}|--port[= ]${RELAY_PORT}|--mount[= ]${RELAY_MOUNT})" || true
)

if (( ${#RUNNING_PIDS[@]} > 0 )); then
  echo "RTSP 串流服務已經啟動。"
  echo "來源串流：${SOURCE_URL}"
  echo "疊字串流：${RELAY_URL}"

  if [[ -t 0 ]]; then
    read -r -p "要重新啟動嗎？ [y/N] " answer
  else
    echo "目前不是互動式終端，保留現有服務。"
    exit 0
  fi

  case "${answer}" in
    y|Y|yes|YES|Yes)
      echo "正在停止既有 RTSP 服務..."
      kill "${RUNNING_PIDS[@]}"
      for _ in {1..20}; do
        if ! kill -0 "${RUNNING_PIDS[@]}" 2>/dev/null; then
          break
        fi
        sleep 0.1
      done
      ;;
    *)
      echo "保留目前服務，不重新啟動。"
      exit 0
      ;;
  esac
fi

if [[ -z "${VIDEO_FILE}" && -f "${VIDEO_STATE_FILE}" ]]; then
  VIDEO_FILE="$(<"${VIDEO_STATE_FILE}")"
fi

if [[ -z "${VIDEO_FILE}" ]]; then
  echo "錯誤：尚未指定 MP4，且沒有上次使用紀錄。" >&2
  echo "請執行：$0 /path/to/video.mp4" >&2
  exit 1
fi

ORIGINAL_VIDEO_FILE="${VIDEO_FILE}"
if ! VIDEO_FILE="$(realpath -e "${VIDEO_FILE}" 2>/dev/null)" || [[ ! -f "${VIDEO_FILE}" ]]; then
  echo "錯誤：找不到影片：${ORIGINAL_VIDEO_FILE}" >&2
  exit 1
fi

if ! /usr/bin/python3 -c 'import gi; gi.require_version("GstRtspServer", "1.0"); from gi.repository import GstRtspServer' 2>/dev/null; then
  echo "錯誤：缺少 GStreamer RTSP Server Python 套件。" >&2
  echo "可先執行：${RTSP_TOOLS_DIR}/install.sh" >&2
  exit 1
fi

mkdir -p "${STATE_DIR}"
printf '%s\n' "${VIDEO_FILE}" > "${VIDEO_STATE_FILE}"

echo "正在啟動 MP4 RTSP 循環串流..."
echo "影片：${VIDEO_FILE}"

nohup /usr/bin/python3 -u "${RTSP_SERVER}" \
  --filename "${VIDEO_FILE}" \
  --port "${SOURCE_PORT}" \
  --mount "${SOURCE_MOUNT}" \
  > "${STATE_DIR}/source.log" 2>&1 &
SOURCE_PID=$!

nohup /usr/bin/python3 -u "${RTSP_SERVER}" \
  --filename "${VIDEO_FILE}" \
  --port "${RELAY_PORT}" \
  --mount "${RELAY_MOUNT}" \
  --mode overlay \
  > "${STATE_DIR}/relay.log" 2>&1 &
RELAY_PID=$!

sleep 1
if ! kill -0 "${SOURCE_PID}" 2>/dev/null || ! kill -0 "${RELAY_PID}" 2>/dev/null; then
  echo "錯誤：RTSP 服務啟動失敗，請查看：" >&2
  echo "  ${STATE_DIR}/source.log" >&2
  echo "  ${STATE_DIR}/relay.log" >&2
  exit 1
fi

echo "RTSP 服務已啟動。"
echo "來源串流：${SOURCE_URL}"
echo "疊字串流：${RELAY_URL}"
echo "Log：${STATE_DIR}/source.log、${STATE_DIR}/relay.log"
