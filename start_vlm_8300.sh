#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/microservices/sop-inference-bp"
ENV_FILE="${PROJECT_DIR}/deploy/.env"
COMPOSE_FILE="${PROJECT_DIR}/deploy/compose.yaml"
SERVICE="nvds-action-sop"
BASE_URL="http://127.0.0.1:8300"

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "錯誤：找不到 ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "錯誤：找不到 ${COMPOSE_FILE}" >&2
  exit 1
fi

container_id="$(compose ps --status running -q "${SERVICE}")"

if [[ -n "${container_id}" ]]; then
  echo "8300 VLM/DeepStream SOP 服務已經啟動。"

  if [[ -t 0 ]]; then
    read -r -p "要重新啟動嗎？ [y/N] " answer
  else
    echo "目前不是互動式終端，略過重新啟動。"
    answer="n"
  fi

  case "${answer}" in
    y|Y|yes|YES|Yes)
      echo "正在重新啟動整個 VLM/DeepStream SOP 容器..."
      compose restart "${SERVICE}"
      ;;
    *)
      echo "保留目前服務，不重新啟動。"
      exit 0
      ;;
  esac
else
  echo "正在背景啟動 Kafka 與完整 VLM/DeepStream SOP 服務..."
  compose up -d
fi

echo "啟動指令已送出；VLM、DDM 與 API 會一起初始化，可能需要幾分鐘。"
echo "狀態：${BASE_URL}/v1/ready"
echo "API 文件：${BASE_URL}/docs"
echo "廠長版 UI：${BASE_URL}/static/plant-manager-demo.html"
