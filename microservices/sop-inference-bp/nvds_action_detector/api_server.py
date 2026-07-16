# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
API Server for NVDS Action Detector
"""

import asyncio
import base64
import hashlib
import json
import os
import queue
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from contextlib import asynccontextmanager
from http import HTTPStatus
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional, Union
from urllib.parse import urlparse

import aiohttp
import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel, Field

from . import ds_logger
from .api_types import (
    CameraInputContent,
    ChatCompletionMessage,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatCompletionResponseStreamChoice,
    ChatCompletionStreamResponse,
    DeletionStatus,
    DeltaMessage,
    DSSOPMetadataResponse,
    ErrorInfo,
    ErrorResponse,
    FileList,
    FileObject,
    HealthSuccessResponse,
    LicenseInfoResponse,
    TextContent,
    VideoFileContent,
    VideoURLContent,
)
from .ds_sop_process import ChunkParams, SOPProcessManager
from .utils import TimeMeasure

logger = ds_logger.get_logger(__name__)

API_SERVER_PORT = int(os.environ.get("API_SERVER_PORT", 8300))
STORAGE_DIR = os.environ.get("MEDIA_STORAGE_DIR", "/tmp/nvds_sop_storage")
METADATA_PATH = os.path.join(STORAGE_DIR, "metadata.json")
DS_SOP_LICENSE_PATH = os.environ.get("DS_SOP_LICENSE_PATH", "/opt/mm/LICENSE")
STATIC_DIR = Path(__file__).resolve().parent / "static"
PLANT_MANAGER_DB_PATH = os.environ.get("PLANT_MANAGER_DB_PATH", os.path.join(STORAGE_DIR, "plant_manager.db"))
DEFAULT_COSMOS_CONFIDENCE = 96.7

API_DUMMY_TEST = os.environ.get("API_DUMMY_TEST", "false").lower() in ["true", "1", "yes", "y"]
DS_SOP_VERSION = os.environ.get("DS_SOP_VERSION", "1.0.0")
ENABLE_RTSP_OUTPUT = os.environ.get("ENABLE_RTSP_OUTPUT", "false").lower() in ["true", "1", "yes", "y"]
LOCAL_VIDEO_PREVIEW_ALLOWED_ROOTS = [
    item.strip()
    for item in os.environ.get("LOCAL_VIDEO_PREVIEW_ALLOWED_ROOTS", "/tmp/nvds_sop_storage").split(",")
    if item.strip()
]
LOCAL_VIDEO_DIR = os.environ.get("LOCAL_VIDEO_DIR", "").strip()
AVAILABLE_MODELS = [
    m.strip()
    for m in os.environ.get("AVAILABLE_MODELS", os.environ.get("VLLM_MODEL_PATH", "")).split(",")
    if m.strip()
]

_current_model: str = os.environ.get("VLLM_MODEL_PATH", "")
_model_switch_status: str = "ready"
_model_switch_lock = asyncio.Lock()
LOCAL_VIDEO_PREVIEW_ALLOWED_PATHS = [
    item.strip()
    for item in os.environ.get(
        "LOCAL_VIDEO_PREVIEW_ALLOWED_PATHS", "/home/spark/eason/x86-sop-inference-bp/tests/0428_test.mp4"
    ).split(",")
    if item.strip()
]
RTSP_PREVIEW_ALLOWED_HOSTS = [
    item.strip().lower()
    for item in os.environ.get("RTSP_PREVIEW_ALLOWED_HOSTS", "").split(",")
    if item.strip()
]
RTSP_PREVIEW_MAX_PROCESSES = int(os.environ.get("RTSP_PREVIEW_MAX_PROCESSES", "2"))
RTSP_PREVIEW_FPS = float(os.environ.get("RTSP_PREVIEW_FPS", "6"))
RTSP_PREVIEW_WIDTH = int(os.environ.get("RTSP_PREVIEW_WIDTH", "640"))

global_metadata: dict = None
global_metadata_lock: asyncio.Lock = None

global_sop_manager: SOPProcessManager = None
global_rtsp_preview_sessions: Dict[str, str] = {}
global_rtsp_preview_processes: Dict[str, subprocess.Popen] = {}
global_rtsp_preview_lock = threading.Lock()


class ModelSwitchRequest(BaseModel):
    model_path: str


class RTSPPreviewSessionRequest(BaseModel):
    url: str


class SopCheckerDashboardUpdate(BaseModel):
    """External SOP Checker update consumed by the plant-manager dashboard."""

    station_id: str = "station-8"
    camera_id: str = "cam-08"
    action_id: Optional[int] = None
    action_name: Optional[str] = None
    status: str = "in_progress"
    cycle_id: Optional[int] = None
    cosmos_description: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0, le=100)
    missing_detected: List[int] = Field(default_factory=list)
    misordered_detected: List[int] = Field(default_factory=list)
    cycle_completed: bool = False
    compliant: Optional[bool] = None
    duration_seconds: Optional[float] = Field(None, ge=0)
    event_message: Optional[str] = None
    session_id: Optional[int] = None
    tracker_id: Optional[int] = None
    frame: Optional[int] = Field(None, ge=0)
    action_states: Dict[str, Union[bool, int, str]] = Field(default_factory=dict)


_PLANT_MANAGER_SCHEMA = """
CREATE TABLE IF NOT EXISTS station_state (
    station_id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    action_id INTEGER,
    action_name TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    cycle_id INTEGER,
    cosmos_description TEXT,
    confidence REAL NOT NULL DEFAULT 96.7,
    checker_result TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sop_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT NOT NULL,
    cycle_id INTEGER NOT NULL,
    compliant INTEGER NOT NULL,
    duration_seconds REAL,
    completed_at TEXT NOT NULL,
    UNIQUE(station_id, cycle_id)
);
CREATE TABLE IF NOT EXISTS sop_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT NOT NULL,
    camera_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    action_id INTEGER,
    cycle_id INTEGER,
    message TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sop_events_station_time ON sop_events(station_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_cycles_station_time ON sop_cycles(station_id, completed_at DESC);
"""


def _plant_manager_connect() -> sqlite3.Connection:
    connection = sqlite3.connect(PLANT_MANAGER_DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def _init_plant_manager_db() -> None:
    with _plant_manager_connect() as connection:
        connection.executescript(_PLANT_MANAGER_SCHEMA)


def _utc_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _normalise_confidence(value: Optional[float]) -> float:
    if value is None:
        return DEFAULT_COSMOS_CONFIDENCE
    return round(value * 100 if 0 <= value <= 1 else value, 1)


def _normalise_action_light(value: Union[bool, int, str]) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "on", "active", "lit", "⬤", "●"}


def _save_plant_manager_update(update: SopCheckerDashboardUpdate) -> dict:
    timestamp = _utc_timestamp()
    confidence = _normalise_confidence(update.confidence)
    action_states = {
        f"action_{index}": _normalise_action_light(update.action_states[f"action_{index}"])
        for index in range(8)
    } if update.action_states else {}
    with _plant_manager_connect() as connection:
        existing = connection.execute(
            "SELECT cosmos_description, action_name, checker_result FROM station_state WHERE station_id = ?",
            (update.station_id,),
        ).fetchone()
        previous_checker = json.loads(existing["checker_result"] or "{}") if existing else {}
        checker_result = {
            "missing_detected": update.missing_detected,
            "misordered_detected": update.misordered_detected,
            "cycle_completed": update.cycle_completed,
            "compliant": update.compliant,
            "session_id": update.session_id if update.session_id is not None else previous_checker.get("session_id"),
            "tracker_id": update.tracker_id if update.tracker_id is not None else previous_checker.get("tracker_id"),
            "frame": update.frame if update.frame is not None else previous_checker.get("frame"),
            "action_states": action_states or previous_checker.get("action_states", {}),
        }
        cosmos_description = update.cosmos_description or (existing["cosmos_description"] if existing else None)
        action_name = update.action_name or (existing["action_name"] if existing else None)
        connection.execute(
            """
            INSERT INTO station_state (
                station_id, camera_id, action_id, action_name, status, cycle_id,
                cosmos_description, confidence, checker_result, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(station_id) DO UPDATE SET
                camera_id=excluded.camera_id, action_id=COALESCE(excluded.action_id, station_state.action_id),
                action_name=COALESCE(excluded.action_name, station_state.action_name), status=excluded.status,
                cycle_id=COALESCE(excluded.cycle_id, station_state.cycle_id),
                cosmos_description=COALESCE(excluded.cosmos_description, station_state.cosmos_description),
                confidence=excluded.confidence, checker_result=excluded.checker_result, updated_at=excluded.updated_at
            """,
            (
                update.station_id, update.camera_id, update.action_id, action_name, update.status, update.cycle_id,
                cosmos_description, confidence, json.dumps(checker_result, ensure_ascii=False), timestamp,
            ),
        )

        issues = []
        if update.missing_detected:
            issues.append(("missing_step", "critical", f"Missing SOP steps: {update.missing_detected}"))
        if update.misordered_detected:
            issues.append(("misordered_step", "warning", f"Misordered SOP steps: {update.misordered_detected}"))
        if update.event_message:
            issues.append(("sop_update", "info", update.event_message))
        for event_type, severity, message in issues:
            connection.execute(
                """INSERT INTO sop_events
                   (station_id, camera_id, event_type, severity, action_id, cycle_id, message, payload, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    update.station_id, update.camera_id, event_type, severity, update.action_id, update.cycle_id,
                    message, json.dumps(checker_result, ensure_ascii=False), timestamp,
                ),
            )

        if update.cycle_completed and update.cycle_id is not None:
            compliant = update.compliant
            if compliant is None:
                compliant = not update.missing_detected and not update.misordered_detected
            connection.execute(
                """INSERT INTO sop_cycles
                   (station_id, cycle_id, compliant, duration_seconds, completed_at) VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(station_id, cycle_id) DO UPDATE SET compliant=excluded.compliant,
                   duration_seconds=excluded.duration_seconds, completed_at=excluded.completed_at""",
                (update.station_id, update.cycle_id, int(compliant), update.duration_seconds, timestamp),
            )
    return _get_plant_manager_dashboard(update.station_id)


def _get_plant_manager_dashboard(station_id: str = "station-8") -> dict:
    with _plant_manager_connect() as connection:
        state = connection.execute("SELECT * FROM station_state WHERE station_id = ?", (station_id,)).fetchone()
        events = connection.execute(
            "SELECT * FROM sop_events WHERE station_id = ? ORDER BY created_at DESC LIMIT 20", (station_id,)
        ).fetchall()
        kpi = connection.execute(
            """SELECT COUNT(*) AS completed_cycles,
                      COALESCE(AVG(compliant) * 100, 0) AS compliance_rate,
                      COALESCE(AVG(duration_seconds), 0) AS average_cycle_seconds
               FROM sop_cycles WHERE station_id = ? AND date(completed_at, 'localtime') = date('now', 'localtime')""",
            (station_id,),
        ).fetchone()
        exception_count = connection.execute(
            """SELECT COUNT(*) FROM sop_events WHERE station_id = ? AND severity IN ('warning', 'critical')
               AND date(created_at, 'localtime') = date('now', 'localtime')""",
            (station_id,),
        ).fetchone()[0]
    current = dict(state) if state else {
        "station_id": station_id, "camera_id": "cam-08", "status": "idle",
        "confidence": DEFAULT_COSMOS_CONFIDENCE, "checker_result": "{}", "updated_at": None,
    }
    if isinstance(current.get("checker_result"), str):
        current["checker_result"] = json.loads(current["checker_result"] or "{}")
    return {
        "current": current,
        "kpi": {
            "completed_cycles": kpi["completed_cycles"],
            "compliance_rate": round(kpi["compliance_rate"], 1),
            "exceptions": exception_count,
            "average_cycle_seconds": round(kpi["average_cycle_seconds"], 1),
        },
        "events": [dict(event) for event in events],
        "confidence_source": "cosmos" if current.get("confidence_source") == "cosmos" else "fallback",
    }


def _record_cosmos_chunk(chunk: Dict[str, Any]) -> None:
    description = str(chunk.get("response", "")).strip()
    if not description or chunk.get("chunk_idx") == -1 or chunk.get("vlm_skipped"):
        return
    checker = chunk.get("checker_result") or {}
    action_match = re.search(r"\((\d+)\)", description)
    confidence = chunk.get("vlm_confidence", chunk.get("confidence"))
    update = SopCheckerDashboardUpdate(
        action_id=int(action_match.group(1)) if action_match else None,
        action_name=description,
        cosmos_description=description,
        confidence=confidence,
        status="in_progress",
        cycle_id=checker.get("cycle"),
        missing_detected=checker.get("missing_detected") or [],
        misordered_detected=checker.get("misordered_detected") or [],
        cycle_completed=bool(checker.get("cycle_completed")),
    )
    _save_plant_manager_update(update)


def _validate_rtsp_preview_url(rtsp_url: str) -> str:
    parsed = urlparse(rtsp_url)
    if parsed.scheme != "rtsp" or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Preview URL must be an rtsp:// URL")

    hostname = parsed.hostname.lower()
    if RTSP_PREVIEW_ALLOWED_HOSTS and hostname not in RTSP_PREVIEW_ALLOWED_HOSTS:
        raise HTTPException(status_code=403, detail="RTSP preview host is not allowed")
    return rtsp_url


def _reap_rtsp_preview_processes() -> None:
    stale_session_ids = [
        session_id
        for session_id, process in global_rtsp_preview_processes.items()
        if process.poll() is not None
    ]
    for session_id in stale_session_ids:
        global_rtsp_preview_processes.pop(session_id, None)


def _terminate_rtsp_preview_process(session_id: str) -> None:
    process = global_rtsp_preview_processes.pop(session_id, None)
    if not process or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()


def _start_rtsp_preview_process(session_id: str, rtsp_url: str) -> subprocess.Popen:
    with global_rtsp_preview_lock:
        _reap_rtsp_preview_processes()
        existing_process = global_rtsp_preview_processes.get(session_id)
        if existing_process and existing_process.poll() is None:
            return existing_process
        if len(global_rtsp_preview_processes) >= RTSP_PREVIEW_MAX_PROCESSES:
            raise HTTPException(status_code=429, detail="Too many active RTSP preview sessions")

        fps = max(1.0, min(RTSP_PREVIEW_FPS, 30.0))
        width = max(160, RTSP_PREVIEW_WIDTH)
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-rtsp_transport",
            "tcp",
            "-i",
            rtsp_url,
            "-an",
            "-vf",
            f"fps={fps},scale={width}:-1",
            "-q:v",
            "6",
            "-f",
            "mjpeg",
            "pipe:1",
        ]
        try:
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
        except OSError as e:
            raise HTTPException(status_code=503, detail=f"Unable to start RTSP preview process: {e}") from e
        global_rtsp_preview_processes[session_id] = process
        return process


async def _mjpeg_stream_generator(session_id: str, rtsp_url: str) -> AsyncGenerator[bytes, None]:
    process = _start_rtsp_preview_process(session_id, rtsp_url)
    frame_buffer = bytearray()
    try:
        while True:
            if process.stdout is None:
                break
            chunk = await asyncio.to_thread(process.stdout.read, 4096)
            if not chunk:
                break
            frame_buffer.extend(chunk)
            while True:
                start = frame_buffer.find(b"\xff\xd8")
                end = frame_buffer.find(b"\xff\xd9", start + 2)
                if start < 0 or end < 0:
                    if start > 0:
                        del frame_buffer[:start]
                    break
                frame = bytes(frame_buffer[start : end + 2])
                del frame_buffer[: end + 2]
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
                    + frame
                    + b"\r\n"
                )
    finally:
        with global_rtsp_preview_lock:
            _terminate_rtsp_preview_process(session_id)


def _preview_cache_key(local_path: str) -> str:
    stat = os.stat(local_path)
    payload = f"{os.path.realpath(local_path)}:{stat.st_mtime_ns}:{stat.st_size}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _video_codec_name(local_path: str) -> Optional[str]:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                local_path,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError) as e:
        logger.warning(f"Unable to inspect local preview codec for {local_path}: {e}")
        return None
    return completed.stdout.strip().splitlines()[0] if completed.stdout.strip() else None


def _browser_playable_preview_path(local_path: str) -> str:
    codec_name = _video_codec_name(local_path)
    if codec_name in {"h264", "av1", "vp9"}:
        return local_path

    preview_dir = os.path.join(STORAGE_DIR, "previews")
    os.makedirs(preview_dir, exist_ok=True)
    cache_path = os.path.join(preview_dir, f"{_preview_cache_key(local_path)}.mp4")
    if os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
        return cache_path

    logger.info(f"Transcoding local preview to browser-playable H.264: {local_path} -> {cache_path}")
    tmp_path = f"{cache_path}.tmp"
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                local_path,
                "-map",
                "0:v:0",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                tmp_path,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=180,
        )
        os.replace(tmp_path, cache_path)
    except (OSError, subprocess.SubprocessError) as e:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        logger.exception(f"Unable to transcode local preview for {local_path}: {e}")
        return local_path
    return cache_path


def _resolve_local_video_path(video_url: str, *, enforce_allowed_roots: bool = False) -> str:
    local_path = video_url[7:] if video_url.startswith("file://") else video_url
    allowed_extensions = (".mp4", ".mov", ".mkv", ".avi")
    if not local_path.startswith("/"):
        raise HTTPException(status_code=400, detail="Local video path must be absolute")
    if not local_path.lower().endswith(allowed_extensions):
        raise HTTPException(status_code=400, detail="Local video path must point to a supported video file")
    if enforce_allowed_roots:
        real_path = os.path.realpath(local_path)
        allowed_by_path = any(real_path == os.path.realpath(path) for path in LOCAL_VIDEO_PREVIEW_ALLOWED_PATHS)
        allowed_by_root = any(
            real_path == os.path.realpath(root) or real_path.startswith(os.path.realpath(root).rstrip("/") + "/")
            for root in LOCAL_VIDEO_PREVIEW_ALLOWED_ROOTS
        )
        if not allowed_by_path and not allowed_by_root:
            raise HTTPException(status_code=403, detail="Local video preview path is not allowed")
    if not os.path.isfile(local_path):
        raise HTTPException(status_code=404, detail=f"Local video file not found: {local_path}")
    return local_path


MODEL_REGISTRY = {
    "ddm_cv_model": {
        "id": "ddm_finetune",
        "modalities": ["video"],
        "description": "DDM model for action segmentation",
    },
    "vlm_model": {
        "id": "cosmos_reason1_finetune",
        "modalities": ["image", "text"],
        "description": "Cosmos Reason1 finetune model",
    },
}

# ---------------------------
# Metrics Generation
# ---------------------------

REQUEST_COUNT = Counter("api_requests_total", "Total API requests", ["path", "method"])

REQUEST_LATENCY = Histogram("api_request_latency_seconds", "API request latency", ["path", "method"])

CHAT_COMPLETIONS_COUNT = Counter("chat_completions_total", "Number of chat completion requests")
CHAT_COMPLETIONS_LATENCY = Histogram(
    "chat_completions_latency_seconds",
    "Latency of /v1/chat/completions in seconds",
    buckets=[0.5, 1, 5, 10],  # customize as needed
)

GPU_UTILIZATION = Gauge("gpu_utilization_percent", "GPU utilization percent", ["gpu"])
GPU_MEMORY = Gauge("gpu_memory_used_megabytes", "GPU memory used in MB", ["gpu"])


# ---------------------------
# API Server app Lifespan
# ---------------------------


def _ensure_writable_dir(path: str, purpose: str, env_var: str) -> None:
    """Create ``path`` and verify it is writable by the current container user.

    The most common first-run failure is a uid/gid mismatch: a host bind mount
    that Docker auto-created as ``root:root`` while the container runs as a
    non-root user (default uid 1001). Raise with an actionable message so the
    user can immediately see why startup failed and how to fix it.
    """
    try:
        os.makedirs(path, exist_ok=True)
    except PermissionError:
        # Fall through to the os.access check below for a single unified message.
        pass

    if not os.access(path, os.W_OK):
        uid, gid = os.getuid(), os.getgid()
        raise RuntimeError(
            f"No write permission for {purpose} directory: {path}\n"
            f"  The container runs as uid={uid} gid={gid}, but this path is not "
            f"writable by that user.\n"
            f"  This usually happens when a host bind mount was auto-created as "
            f"root:root while the container runs as a non-root user.\n"
            f"  Fix it by either:\n"
            f"    1) running the container as your host user — set "
            f"USER_ID=$(id -u) and GROUP_ID=$(id -g) in deploy/.env, or\n"
            f"    2) granting the container user write access to the host path "
            f"backing {env_var} (e.g. `sudo chown -R {uid}:{gid} <host dir>`)."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for the FastAPI app
    """
    global global_metadata, global_metadata_lock, global_sop_manager

    # Initialize storage and metadata on startup
    _ensure_writable_dir(STORAGE_DIR, "media storage", "MEDIA_STORAGE_DIR")
    _init_plant_manager_db()

    # Emit the camera-emulation notice once at startup (the pipeline-level log
    # fires per camera stream). Default PYLON_CAMEMU=1 means a customer with a
    # real Basler camera silently runs emulation unless they opt out.
    if os.environ.get("PYLON_CAMEMU") == "1":
        logger.warning(
            "PYLON_CAMEMU=1: Basler camera EMULATION mode is enabled — live Basler "
            "cameras will NOT be used. Set PYLON_CAMEMU=0 in deploy/.env to use real "
            "camera hardware."
        )

    global_metadata = load_metadata()
    global_metadata_lock = asyncio.Lock()
    logger.info("Application started")

    yield

    logger.info("Closing SOP process manager...")
    if global_sop_manager is not None:
        global_sop_manager.close()
    global_sop_manager = None
    logger.info("SOP process manager closed")
    logger.info("Deleting storage directory...")
    # os.rmdir(STORAGE_DIR)
    logger.info("Storage directory deleted")


openapi_tags = [
    {
        "name": "Chat Completions",
        "description": "Operations to generate chat completions for a video stream",
    },
    {
        "name": "File and Stream Management",
        "description": "Files are used to upload and manage media files.",
    },
    {"name": "Health Check", "description": "Operations to check system health."},
    {"name": "Metrics", "description": "Operations to get metrics."},
    {
        "name": "Models",
        "description": "List and describe the various models available in the API.",
    },
    {"name": "Metadata", "description": "Operations to get service metadata."},
    {"name": "Plant Manager", "description": "Live SOP dashboard state, KPI, and event storage."},
]

app = FastAPI(
    title="DeepStream SOP API",
    description="APIs for NVDS SOP CV and VLM cycle detection",
    contact={"name": "NVIDIA", "url": "https://nvidia.com"},
    version=DS_SOP_VERSION,
    lifespan=lifespan,
    openapi_tags=openapi_tags,
)

@app.get("/static/QAS", include_in_schema=False)
async def qas_ui():
    return FileResponse(STATIC_DIR / "QAS", media_type="text/html")


if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", include_in_schema=False)
async def root_ui():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/ui", include_in_schema=False)
async def ui():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/v1/plant-manager/dashboard", tags=["Plant Manager"])
async def get_plant_manager_dashboard(station_id: str = "station-8"):
    """Return persisted live state, today's KPI, and recent SOP events."""
    return await asyncio.to_thread(_get_plant_manager_dashboard, station_id)


@app.post("/v1/plant-manager/sop-checker", tags=["Plant Manager"])
async def update_plant_manager_sop_checker(update: SopCheckerDashboardUpdate):
    """Receive an SOP Checker update and persist it for the plant-manager UI."""
    if update.action_states:
        expected = {f"action_{index}" for index in range(8)}
        received = set(update.action_states)
        if received != expected:
            raise HTTPException(
                status_code=422,
                detail=f"action_states must contain exactly action_0 through action_7; received {sorted(received)}",
            )
        if update.tracker_id is None:
            raise HTTPException(status_code=422, detail="tracker_id is required with action_states")
    return await asyncio.to_thread(_save_plant_manager_update, update)


# ---------------------------
# Middleware to count all requests
# ---------------------------


@app.middleware("http")
async def add_metrics(request: Request, call_next: Callable):
    REQUEST_COUNT.labels(path=request.url.path, method=request.method).inc()

    with REQUEST_LATENCY.labels(path=request.url.path, method=request.method).time():
        response = await call_next(request)

    return response


def load_metadata() -> dict:
    if not os.path.exists(METADATA_PATH):
        return {}
    try:
        with open(METADATA_PATH, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error("Error loading metadata: %s", e)
        return {}


def save_metadata(metadata: dict):
    try:
        with open(METADATA_PATH, "w") as f:
            json.dump(metadata, f)
    except Exception as e:
        logger.error("Error saving metadata: %s", e)


def _create_error_response(
    message: str, err_type: str = "BadRequestError", status_code: HTTPStatus = HTTPStatus.BAD_REQUEST
) -> ErrorResponse:
    return ErrorResponse(error=ErrorInfo(message=message, type=err_type, code=status_code.value))


async def download_video_from_url(video_url: str, storage_dir: str) -> str:
    """
    Download video from URL, use a local file path, or decode from base64 data URI.

    Args:
        video_url: HTTP(S), RTSP, local file path, or data URI (data:video/mp4;base64,...)
        storage_dir: Directory to save the video file

    Returns:
        Path to the downloaded/saved video file

    Raises:
        HTTPException: If download fails or invalid format
    """
    # Generate unique filename
    file_id = f"video-{uuid.uuid4().hex}.mp4"
    file_path = os.path.join(storage_dir, file_id)

    try:
        # Check if it's a data URI (base64 encoded)
        if video_url.startswith("data:"):
            logger.info("Processing base64 data URI")

            # Parse data URI format: data:video/mp4;base64,{base64data}
            match = re.match(r"data:video/[^;]+;base64,(.+)", video_url)
            if not match:
                raise HTTPException(
                    status_code=400, detail="Invalid data URI format. Expected: data:video/mp4;base64,{base64data}"
                )

            base64_data = match.group(1)

            # Decode base64 data
            try:
                video_data = base64.b64decode(base64_data)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to decode base64 data: {str(e)}")

            # Write to file (use thread pool to avoid blocking)
            def write_file():
                with open(file_path, "wb") as f:
                    f.write(video_data)

            await asyncio.to_thread(write_file)
            logger.info(f"Saved base64 video to {file_path} ({len(video_data)} bytes)")

        # Check if it's HTTP(S) URL
        elif video_url.startswith(("http://", "https://")):
            logger.info("Downloading video from HTTP(S) URL")

            # Download using aiohttp for async HTTP
            async with aiohttp.ClientSession() as session:
                async with session.get(video_url, timeout=aiohttp.ClientTimeout(total=300)) as response:
                    if response.status != 200:
                        raise HTTPException(
                            status_code=400, detail=f"Failed to download video. HTTP status: {response.status}"
                        )

                    # Stream download to file
                    total_size = 0

                    with open(file_path, "wb") as f:
                        async for chunk in response.content.iter_chunked(1024 * 1024):  # 1MB chunks
                            await asyncio.to_thread(f.write, chunk)
                            total_size += len(chunk)

                    logger.info(f"Downloaded video to {file_path} ({total_size} bytes)")
        elif video_url.startswith(("rtsp://")):
            logger.info(f"received rtsp url {video_url[:40]}...")
            return video_url
        elif video_url.startswith("file://") or video_url.startswith("/"):
            local_path = _resolve_local_video_path(video_url)
            logger.info(f"Using local video file {local_path}")
            return local_path
        else:
            raise HTTPException(
                status_code=400,
                detail="Invalid video URL format. Must start with 'http://', 'https://', 'rtsp://', '/', 'file://', or 'data:'",
            )

        return file_path

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Clean up partial file if it exists
        if os.path.exists(file_path):
            try:
                await asyncio.to_thread(os.remove, file_path)
            except Exception:
                pass

        logger.error(f"Error downloading video from URL: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to download video: {str(e)}")


def _json_error_response(original: ErrorResponse, *, status_code: Optional[int] = None) -> JSONResponse:
    content = original.model_dump()

    if status_code is None:
        status_code = original.code

    return JSONResponse(content=content, status_code=status_code)


async def ds_sop_generate_chunks_dummy(
    request: ChatCompletionRequest, raw_request: Request
) -> AsyncGenerator[str, None]:
    """
    Dummy implementation of ds_sop_generate_chunks for unittest
    """
    req_id = str(uuid.uuid4().hex)
    checker_result = {
        "request_id": req_id,
        "error_message": "",
        "checker_id": "sopchecker-32810b9f-0f5e-4f5d-af58-de5be56c0159",
        "cycle": 0,
        "missing_detected": [],
        "misordered_detected": [],
        "final_missing_detected": [],
        "final_misordered_detected": [],
        "cycle_completed": False,
        "summary_cycles_detected": [],
        "summary_cycle_analysis": [],
    }
    for i in range(1, 9):
        chunk = {
            "chunk_idx": i,
            "response": f"Hello, world! {i}",
            "req_id": req_id,
            "start_time": i * 10,
            "end_time": (i + 1) * 10,
            "frame_number": 10,
            "vlm_execute_time": 0.1,
            "checker_execute_time": 0.1,
            "cv_execute_time": 0.1,
            "checker_result": checker_result,
        }
        yield chunk
    # return final chunk
    checker_result["cycle_completed"] = True
    checker_result["summary_cycles_detected"] = ["Cycle 0: [2, 3, 4, 4, 5, 5, 6, 7, 8]"]
    checker_result["summary_cycle_analysis"] = ["Cycle 0: [2, 3, 4, 5, 6, 7, 8] -> no issues"]
    chunk = {
        "chunk_idx": -1,
        "response": "Hello, world! final chunk",
        "req_id": req_id,
        "start_time": 0,
        "end_time": 0,
        "frame_number": 0,
        "vlm_execute_time": 0.1,
        "checker_result": checker_result,
    }
    yield chunk
    yield None


async def ds_sop_generate_chunks(request: ChatCompletionRequest, raw_request: Request) -> AsyncGenerator[str, None]:
    """
    Create a chat completion
    """
    text_content = ""
    video_file_path = ""
    is_tmp_file = False
    is_live_stream = False
    camera_serial_number = None
    camera_config = None
    camera_extra_args = {
        "camera_format": None,
        "camera_width": None,
        "camera_height": None,
        "camera_fps_num": None,
        "camera_fps_den": None,
    }
    try:
        logger.info(f"Received request with model: {request.model}")
        logger.info(f"Number of messages: {len(request.messages)}")

        if len(request.messages) != 1:
            raise HTTPException(status_code=400, detail="Only one message with role 'user' is supported.")

        user_message = request.messages[0]
        if user_message.role != "user":
            raise HTTPException(status_code=400, detail=f"Only support role 'user', but got {user_message.role}")

        msg_content = request.messages[0].content
        if not isinstance(msg_content, list):
            raise HTTPException(
                status_code=400,
                detail=f"Content must be a list with type 'text' and 'image_file', but got {msg_content}",
            )

        for content in msg_content:
            if isinstance(content, TextContent):
                if text_content:
                    logger.error(f"Found one text content {text_content} but got another text contents: {content.text}")
                    raise HTTPException(
                        status_code=400, detail="Only one text content is supported, but got multiple text contents."
                    )
                text_content = content.text

            elif isinstance(content, VideoFileContent):
                if video_file_path:
                    raise HTTPException(
                        status_code=400,
                        detail="Only one video file is supported, but got multiple video files in a request.",
                    )

                video_file_path = content.file_id
                video_file_path = os.path.join(STORAGE_DIR, video_file_path)
                if not os.path.exists(video_file_path):
                    raise HTTPException(status_code=404, detail=f"Video file {video_file_path} not found")
            elif isinstance(content, VideoURLContent):
                if video_file_path:
                    raise HTTPException(
                        status_code=400,
                        detail="Only one video file is supported, but got multiple video files in a request.",
                    )
                video_url = content.video_url.url.strip()
                logger.info(f"Downloading video url {video_url[:40]}...")
                video_file_path = await download_video_from_url(video_url, STORAGE_DIR)
                if video_url.startswith("rtsp://"):
                    is_live_stream = True
                    is_tmp_file = False
                    camera_extra_args = {}
                    if ENABLE_RTSP_OUTPUT:
                        camera_extra_args = {
                            "rtsp_port": int(os.environ.get("RTSP_PORT", 8554)),
                            "rtsp_path": f"/ds-out/{video_url.split('/')[-1].split('.')[0]}",
                        }
                else:
                    is_tmp_file = True
                    is_live_stream = False
            elif isinstance(content, CameraInputContent):
                camera_serial_number = content.input_camera.camera_id
                if content.input_camera.camera_vendor != "Basler":
                    raise HTTPException(
                        status_code=400,
                        detail=f"Only support camera vendor 'Basler', but got {content.input_camera.camera_vendor}",
                    )
                camera_config = content.input_camera.config
                logger.info(
                    f"Received camera input with camera_id: {camera_serial_number}, camera_config: {camera_config}"
                )
                # TODO: Implement camera input processing
                video_file_path = "camera://" + camera_serial_number
                is_live_stream = True
                camera_extra_args = {
                    "camera_format": content.input_camera.camera_format,
                    "camera_width": content.input_camera.camera_width,
                    "camera_height": content.input_camera.camera_height,
                    "camera_fps_num": content.input_camera.camera_fps_num,
                    "camera_fps_den": content.input_camera.camera_fps_den,
                }
                if ENABLE_RTSP_OUTPUT:
                    camera_extra_args["rtsp_port"] = int(os.environ.get("RTSP_PORT", 8554))
                    camera_extra_args["rtsp_path"] = f"/ds-out/{camera_serial_number}"
            else:
                raise HTTPException(status_code=400, detail=f"content type {content.type} is not supported")

        if not video_file_path:
            raise HTTPException(
                status_code=400,
                detail="video file path must be provided.",
            )
        if is_live_stream and not request.stream:
            raise HTTPException(
                status_code=400,
                detail="Live stream requests must enable streaming response, but got non-streaming request",
            )

        chunking_options = request.chunking_options
        if chunking_options and chunking_options.algorithm == "ddm-net":
            chunk_params = ChunkParams(
                algorithm="ddm-net",
                min_length_sec=chunking_options.min_length_sec,
                max_length_sec=chunking_options.max_length_sec,
                threshold=chunking_options.threshold,
                motion_gate_min_active_ratio=chunking_options.motion_gate_min_active_ratio,
                motion_gate_enabled=chunking_options.motion_gate_enabled,
                hand_gate_enabled=chunking_options.hand_gate_enabled,
            )
        elif chunking_options and chunking_options.algorithm == "uniform":
            chunk_params = ChunkParams(
                algorithm="uniform",
                chunk_length_sec=chunking_options.chunk_length_sec,
            )
        else:
            chunk_params = ChunkParams(min_length_sec=1, max_length_sec=10, threshold=0.8)

        global global_sop_manager
        loop = asyncio.get_running_loop()
        processor = None
        graceful_stop = False
        try:
            processor = global_sop_manager.create_video_processor(
                file_path=video_file_path,
                chunk_params=chunk_params,
                camera_serial_number=camera_serial_number,
                camera_config=camera_config,
                prompt=text_content,
                temperature=request.temperature,
                max_completion_tokens=request.max_completion_tokens,
                seed=request.seed,
                top_p=request.top_p,
                **camera_extra_args,
            )
            await processor.start()

            while True:
                # Wait for next chunk with periodic disconnection checks
                # Using timeout on queue.get() to allow checking client connection status
                chunk = None
                client_disconnected = False
                while True:
                    # check if client disconnected, request must close gracefully by itself
                    chunk = None
                    try:
                        disconnect_check = await asyncio.wait_for(raw_request.receive(), timeout=0.01)
                        if disconnect_check["type"] == "http.disconnect":
                            logger.info(f"Client: {processor._id} disconnected (detected via receive)")
                            client_disconnected = True
                            break
                    except asyncio.TimeoutError:
                        # No disconnect message - client still connected
                        pass

                    # Try to get chunk with timeout to avoid blocking indefinitely
                    try:
                        chunk = await loop.run_in_executor(
                            None, lambda: processor.final_queue.get(block=True, timeout=0.3)
                        )
                    except queue.Empty:
                        # No chunk yet, loop will check for disconnection again
                        continue
                    # New chunk is ready, break the loop
                    break
                if client_disconnected:
                    break
                need_to_break = chunk is None or chunk.get("is_last_item", False)
                # logger.info(f"Yielding chunk: {chunk.get('req_id', None)}, need_to_break: {need_to_break}")

                try:
                    yield chunk
                except Exception as e:
                    # When client disconnects, yield can raise:
                    # - ConnectionResetError: client closed connection
                    # - BrokenPipeError: write to closed socket
                    # - asyncio.CancelledError: task was cancelled
                    # - RuntimeError: generator already executing / closed
                    logger.info(f"Error during yield (likely client disconnected): {type(e).__name__}: {e}")
                    raise HTTPException(status_code=400, detail="Client disconnected during write")

                if need_to_break:
                    graceful_stop = True
                    break
        except HTTPException as e:
            raise e
        except Exception as e:
            logger.exception(f"Error processing request: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            # stop the processor in background
            if processor:
                logger.info(f"Stopping processor: {processor._id} in background, graceful_stop: {graceful_stop}")
                future = global_sop_manager.trigger_stop_processors(processor, force=not graceful_stop)

                def log_errors(fut):
                    try:
                        fut.result()  # Will raise if there was an exception
                    except Exception as e:
                        logger.exception(f"Error stopping processor in background: {e}")

                future.add_done_callback(log_errors)
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error processing request: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if is_tmp_file:
            try:
                await asyncio.to_thread(os.remove, video_file_path)
            except Exception:
                pass


async def _run_stream_chunks_response(
    chunks_generator: AsyncGenerator[Dict, None], request: ChatCompletionRequest, raw_request: Request
) -> Union[ErrorResponse, AsyncGenerator[str, None]]:
    """
    Run stream response for chunks
    """

    # Keep the response active while VLM inference is computing. SSE comments
    # are ignored by clients but prevent browser and proxy idle timeouts.
    heartbeat_interval = float(os.environ.get("SSE_HEARTBEAT_INTERVAL_SEC", "10"))
    next_chunk_task = None
    try:
        chat_id = None
        chunks_iterator = chunks_generator.__aiter__()

        while True:
            if next_chunk_task is None:
                next_chunk_task = asyncio.create_task(anext(chunks_iterator))

            done, _ = await asyncio.wait({next_chunk_task}, timeout=heartbeat_interval)
            if not done:
                yield "event: ping\ndata: {}\n\n"
                continue

            try:
                chunk = next_chunk_task.result()
            except StopAsyncIteration:
                break
            finally:
                next_chunk_task = None

            if chunk is None:
                break
            assert isinstance(chunk, dict)
            await asyncio.to_thread(_record_cosmos_chunk, chunk)
            delta_message = DeltaMessage(content=chunk.get("response", "").strip())
            choice = ChatCompletionResponseStreamChoice(
                index=0, delta=delta_message, finish_reason=None, chunk_metadata=chunk
            )
            if chat_id is None:
                req_id = chunk.get("req_id", str(uuid.uuid4().hex))
                chat_id = f"chatcmpl-{req_id}"
            chat_completion_stream_response = ChatCompletionStreamResponse(
                id=chat_id,
                object="chat.completion.chunk",
                created=int(time.time()),
                model=request.model,
                choices=[choice],
            )
            yield f"data: {chat_completion_stream_response.model_dump_json()}\n\n"
        yield "data: [DONE]\n\n"
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.exception(f"Error processing request: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if next_chunk_task is not None and not next_chunk_task.done():
            next_chunk_task.cancel()
            await asyncio.gather(next_chunk_task, return_exceptions=True)


async def _run_chat_completion_response(
    chunks_generator: AsyncGenerator[Dict, None], request: ChatCompletionRequest, raw_request: Request
) -> Union[ErrorResponse, ChatCompletionResponse]:
    """
    Run chat completion response
    """
    try:
        chat_id = None
        responses = []
        metadata = []
        async for chunk in chunks_generator:
            if chunk is None:
                logger.info(f"{chat_id} received last chunk, breaking")
                break
            if chat_id is None:
                chat_id = chunk.get("req_id", str(uuid.uuid4().hex))
                chat_id = f"chatcmpl-{chat_id}"
            logger.info(f"{chat_id} Received new chunk, response: {chunk.get('response', '').strip()[:30]}...")
            responses.append(chunk.get("response", "").strip())
            metadata.append(chunk)
        chat_id = chat_id or f"chatcmpl-{uuid.uuid4().hex}"  # ensure response id when no chunks
        logger.info(f"{chat_id} received {len(responses)} chunks, responses: {responses[:30]}...")
        choice = ChatCompletionResponseChoice(
            index=0,
            message=ChatCompletionMessage(role="assistant", content="\n".join(responses)),
            finish_reason="stop",
            chunk_metadata_list=metadata,
        )
        logger.info(
            f"chat_id: {chat_id}, Chat completion response_length: {len(responses)}, response: {choice.message.content[:30]}..."
        )
        return ChatCompletionResponse(
            id=chat_id, created=int(time.time()), model=request.model, choices=[choice], usage={}
        )

    except Exception as e:
        logger.exception(f"Error processing request: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def validate_json_request(raw_request: Request):
    content_type = raw_request.headers.get("content-type", "").lower()
    media_type = content_type.split(";", maxsplit=1)[0]
    if media_type != "application/json":
        raise HTTPException(status_code=415, detail="Unsupported Media Type: Only 'application/json' is allowed")


@app.post(
    "/v1/chat/completions",
    summary="OpenAI-compatible chat endpoint",
    response_model=Union[ChatCompletionResponse, ChatCompletionStreamResponse],
    responses={
        400: {
            "description": "Received an invalid request possibly containing unsupported or out-of-range parameter values.",
            "model": ErrorResponse,
        },
        404: {
            "description": "The requested model does not exist.",
            "model": ErrorResponse,
        },
        500: {"description": "", "model": ErrorResponse},
        415: {"description": "Unsupported Media Type", "model": ErrorResponse},
    },
    dependencies=[Depends(validate_json_request)],
    tags=["Chat Completions"],
)
async def create_chat_completion(request: ChatCompletionRequest, raw_request: Request):
    logger.info(f"Received chat completion request at timestamp: {time.time()}, stream_option: {request.stream}")
    tm = TimeMeasure()

    try:
        if API_DUMMY_TEST:
            chunks_generator = ds_sop_generate_chunks_dummy(request, raw_request)
        else:
            chunks_generator = ds_sop_generate_chunks(request, raw_request)
        if isinstance(chunks_generator, ErrorResponse):
            return _json_error_response(chunks_generator, status_code=chunks_generator.code)
        if request.stream:
            stream_generator = _run_stream_chunks_response(chunks_generator, request, raw_request)
            return StreamingResponse(
                content=stream_generator,
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "X-Accel-Buffering": "no",
                    "Connection": "keep-alive",
                },
            )
        else:
            response = await _run_chat_completion_response(chunks_generator, request, raw_request)
            assert isinstance(response, ChatCompletionResponse)
            return response
    finally:
        tm.log_elapsed_time("Chat completions processing latency")
        latency = tm.elapsed_time
        CHAT_COMPLETIONS_LATENCY.observe(latency)
        CHAT_COMPLETIONS_COUNT.inc()


@app.post(
    "/v1/files",
    response_model=FileObject,
    tags=["File and Stream Management"],
)
async def upload_file(file: UploadFile = File(...), purpose: str = Form(...)):
    """
    Uploads a file and returns the file object.
    """
    file_size = file.size
    file_id = f"file-{uuid.uuid4().hex}"
    created_at = int(time.time())
    file_path = os.path.join(STORAGE_DIR, file_id)
    with open(file_path, "wb") as out:
        while content := await file.read(1024 * 1024):
            out.write(content)

    file_object = FileObject(
        id=file_id,
        bytes=file_size,
        created_at=created_at,
        filename=file.filename,
        purpose=purpose,
    )

    async with global_metadata_lock:
        global_metadata[file_id] = file_object.model_dump()
        save_metadata(global_metadata)

    return file_object


@app.get("/v1/files/{file_id}/content", tags=["File and Stream Management"])
async def get_file_content(file_id: str):
    """
    Downloads the content of a specific file.
    """
    # Quickly get metadata with lock
    async with global_metadata_lock:
        file_object = global_metadata.get(file_id)

    if file_object is None:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    file_path = os.path.join(STORAGE_DIR, file_id)

    # Check if file exists on disk
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File {file_id} not found on disk")

    # FileResponse handles efficient streaming automatically
    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=file_object["filename"],
        headers={"Content-Length": str(file_object["bytes"])},
    )


@app.post("/v1/rtsp-preview-sessions", tags=["File and Stream Management"])
async def create_rtsp_preview_session(request: RTSPPreviewSessionRequest):
    rtsp_url = _validate_rtsp_preview_url(request.url)
    session_id = uuid.uuid4().hex
    global_rtsp_preview_sessions[session_id] = rtsp_url
    return {"id": session_id, "preview_url": f"/v1/rtsp-preview-sessions/{session_id}/mjpeg"}


@app.get("/v1/rtsp-preview-sessions/{session_id}/mjpeg", tags=["File and Stream Management"])
async def rtsp_preview_mjpeg(session_id: str):
    rtsp_url = global_rtsp_preview_sessions.get(session_id)
    if not rtsp_url:
        raise HTTPException(status_code=404, detail="RTSP preview session not found")
    return StreamingResponse(
        _mjpeg_stream_generator(session_id, rtsp_url),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )


@app.delete("/v1/rtsp-preview-sessions/{session_id}", tags=["File and Stream Management"])
async def delete_rtsp_preview_session(session_id: str):
    global_rtsp_preview_sessions.pop(session_id, None)
    with global_rtsp_preview_lock:
        _terminate_rtsp_preview_process(session_id)
    return {"id": session_id, "deleted": True}


@app.get("/v1/model", tags=["Models"])
async def get_model():
    """Return current model path and switch status."""
    model_ready = global_sop_manager is not None and global_sop_manager.is_model_ready()
    status = _model_switch_status if _model_switch_status == "switching" else ("ready" if model_ready else "loading")
    return {
        "current_model": _current_model,
        "status": status,
        "available_models": AVAILABLE_MODELS,
    }


async def _do_model_switch(new_model_path: str):
    global _current_model, _model_switch_status
    try:
        await asyncio.to_thread(global_sop_manager._initialize_model.switch_vlm_model, new_model_path)
        _current_model = new_model_path
        logger.info(f"Model switched to {new_model_path}")
    except Exception as e:
        logger.exception(f"Model switch failed: {e}")
    finally:
        _model_switch_status = "ready"


@app.post("/v1/model/switch", tags=["Models"])
async def switch_model(body: ModelSwitchRequest):
    """Switch the active VLM model. Returns immediately; poll GET /v1/model for status."""
    global _model_switch_status
    if AVAILABLE_MODELS and body.model_path not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Model not in AVAILABLE_MODELS list.")
    if _model_switch_status == "switching":
        raise HTTPException(status_code=409, detail="Model switch already in progress.")
    if body.model_path == _current_model and _model_switch_status == "ready":
        return {"current_model": _current_model, "status": "ready"}
    _model_switch_status = "switching"
    asyncio.create_task(_do_model_switch(body.model_path))
    return {"current_model": _current_model, "status": "switching"}


@app.get("/v1/local-videos", tags=["File and Stream Management"])
async def list_local_videos():
    """
    List MP4 files available in the configured LOCAL_VIDEO_DIR.
    """
    if not LOCAL_VIDEO_DIR or not os.path.isdir(LOCAL_VIDEO_DIR):
        return {"files": []}
    files = sorted(
        os.path.join(LOCAL_VIDEO_DIR, f)
        for f in os.listdir(LOCAL_VIDEO_DIR)
        if f.lower().endswith(".mp4")
    )
    return {"files": files}


@app.get("/v1/local-video-preview", tags=["File and Stream Management"])
async def local_video_preview(path: str):
    """
    Browser-playable preview for a local video path used by inference.
    """
    local_path = _resolve_local_video_path(path, enforce_allowed_roots=True)
    preview_path = _browser_playable_preview_path(local_path)
    media_type = "video/mp4" if preview_path.lower().endswith(".mp4") else "application/octet-stream"
    return FileResponse(path=preview_path, media_type=media_type, filename=os.path.basename(local_path))


@app.delete("/v1/files/{file_id}", response_model=DeletionStatus, tags=["File and Stream Management"])
async def delete_file(file_id: str):
    """
    Deletes a file and its metadata.
    """
    # Check if file exists in metadata
    async with global_metadata_lock:
        if file_id not in global_metadata:
            raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    file_path = os.path.join(STORAGE_DIR, file_id)

    # Delete physical file first (non-blocking)
    try:
        await asyncio.to_thread(os.remove, file_path)
    except FileNotFoundError:
        # File already deleted or never existed - log but continue to clean metadata
        logger.warning(f"File {file_id} not found on disk, cleaning up metadata")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")

    # Remove from metadata after successful file deletion
    async with global_metadata_lock:
        if file_id in global_metadata:  # Double-check in case of race condition
            del global_metadata[file_id]
            save_metadata(global_metadata)

    return DeletionStatus(id=file_id, deleted=True)


@app.get("/v1/files", response_model=FileList, tags=["File and Stream Management"])
async def list_files():
    """List all files in the metadata storage"""
    async with global_metadata_lock:
        return FileList(data=[FileObject.model_validate(file_doc) for file_doc in global_metadata.values()])


@app.get("/v1/models", tags=["Models"])
async def list_models() -> Response:
    """List available models endpoint"""
    model_id = os.environ.get("DS_SOP_MODEL_NAME", "ds_sop_model")
    return {
        "object": "list",
        "data": [{"id": model_id, "object": "model", "created": 0, "owned_by": "nvds-sop-action-detector"}],
    }


@app.get(
    "/v1/metadata",
    summary="Provide DS SOP Metadata",
    description=("Show DS SOP Metadata").replace("\n", " ").strip(),
    response_model=DSSOPMetadataResponse,
    tags=["Metadata"],
)
async def show_metadata() -> Response:
    ver = DS_SOP_VERSION
    license_info = _get_license_info()
    model_info = MODEL_REGISTRY
    metadata = DSSOPMetadataResponse(version=ver, modelInfo=model_info, licenseInfo=license_info)
    return JSONResponse(content=metadata.model_dump())


@app.get(
    "/v1/live",
    summary="Service liveness check",
    description=("Indicates if the service is alive").strip(),
    response_model=Union[HealthSuccessResponse],
    tags=["Health Check"],
)
async def health_live() -> Response:
    return JSONResponse(content=HealthSuccessResponse(message="Service is live.").model_dump())


@app.get(
    "/v1/startup",
    summary="Microservice startup status",
    description=("Indicates if the service is alive").strip(),
    response_model=Union[HealthSuccessResponse],
    tags=["Health Check"],
)
async def health_startup() -> Response:
    return JSONResponse(content=HealthSuccessResponse(message="Service started successfully.").model_dump())


@app.get(
    "/v1/ready",
    response_model=HealthSuccessResponse,
    summary="Service ready check",
    description=("Indicates if the service is ready to receive inference requests").replace("\n", " ").strip(),
    responses={
        503: {
            "description": "Service is not ready to receive requests.",
            "model": ErrorResponse,
        },
    },
    tags=["Health Check"],
)
async def health_ready() -> Response:
    """Health check.
    Ensures all backend services are ready to serve inference requests.
    """
    try:
        if API_DUMMY_TEST:
            return JSONResponse(content=HealthSuccessResponse(message="Dummy test mode,Service is ready.").model_dump())
        global global_sop_manager
        if global_sop_manager is None or not global_sop_manager.is_model_ready():
            return _json_error_response(
                _create_error_response(
                    message="Service is not ready to receive requests.",
                    err_type="ServiceUnavailableError",
                    status_code=HTTPStatus.SERVICE_UNAVAILABLE,
                )
            )
    except Exception as e:
        return _json_error_response(
            _create_error_response(
                message=f"Service is not ready to receive requests, raised error: {str(e)}",
                err_type="ServiceUnavailableError",
                status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            )
        )
    return JSONResponse(content=HealthSuccessResponse(message="Service is ready.").model_dump())


def _get_license_info():
    # Currently, License URL is not implemented
    with open(DS_SOP_LICENSE_PATH, "r") as f:
        content = f.read()
    license_info = LicenseInfoResponse(
        name=os.path.basename(DS_SOP_LICENSE_PATH),
        path=DS_SOP_LICENSE_PATH,
        size=os.path.getsize(DS_SOP_LICENSE_PATH),
        url="",
        type="file",
        content=content,
    )
    return license_info


def _update_gpu_metrics():
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"]
        ).decode()

        for idx, line in enumerate(out.strip().split("\n")):
            util, mem = line.split(", ")
            GPU_UTILIZATION.labels(gpu=str(idx)).set(float(util))
            GPU_MEMORY.labels(gpu=str(idx)).set(float(mem))
    except Exception as e:
        logger.exception(f"Error updating GPU metrics: {e}")
        pass  # no GPU or nvidia-smi not installed


@app.get(
    "/v1/metrics",
    summary="Get Prometheus metrics",
    description="Get Prometheus metrics",
    responses={
        200: {"description": "Successful Response."},
        500: {"description": "Internal Server Error.", "model": ErrorResponse},
    },
    tags=["Metrics"],
)
async def metrics() -> Response:
    """Prometheus metrics endpoint"""
    try:
        _update_gpu_metrics()  # Update GPU metrics
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
    except Exception as e:
        logger.exception(f"Error getting Prometheus metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def main():
    global global_sop_manager
    if not API_DUMMY_TEST:
        global_sop_manager = SOPProcessManager()
        logger.info("Initializing SOP process manager...")
        global_sop_manager.wait_for_model_ready()
        logger.info("SOP process manager models initialized")
    else:
        logger.info("Running in DUMMY TEST mode - skipping SOP manager initialization")

    # Configure uvicorn to use proper log level from environment
    import logging

    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level_mapping = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    uvicorn_log_level = log_level_mapping.get(log_level, logging.INFO)

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=API_SERVER_PORT,
        log_level=logging.getLevelName(uvicorn_log_level).lower(),  # uvicorn expects lowercase string
        access_log=True,
    )


if __name__ == "__main__":
    main()
