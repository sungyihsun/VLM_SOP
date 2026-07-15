const DEFAULT_PROMPT = "Describe what action is happening in this video buffer. Keep the answer concise and operational.";
const DEFAULT_MP4_PATH = "/home/spark/eason/x86-sop-inference-bp/tests/0428_test.mp4";
const DEFAULT_MP4_NAME = "default";

const state = {
  abortController: null,
  typingQueue: [],
  typing: false,
  running: false,
  modelSwitching: false,
  previewTimerId: null,
  previewStartedAt: 0,
  uploadedPreviewUrl: null,
};

const els = {
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  statusText: document.getElementById("statusText"),
  sourceMode: document.getElementById("sourceMode"),
  rtspUrl: document.getElementById("rtspUrl"),
  previewUrl: document.getElementById("previewUrl"),
  mp4Path: document.getElementById("mp4Path"),
  mp4File: document.getElementById("mp4File"),
  mp4Name: document.getElementById("mp4Name"),
  chunkSeconds: document.getElementById("chunkSeconds"),
  modelSelect: document.getElementById("modelSelect"),
  modelStatus: document.getElementById("modelStatus"),
  mediaFrame: document.querySelector(".media-frame"),
  mjpegPreview: document.getElementById("mjpegPreview"),
  videoPreview: document.getElementById("videoPreview"),
  previewFallback: document.getElementById("previewFallback"),
  typewriter: document.getElementById("typewriter"),
  eventLog: document.getElementById("eventLog"),
  chunkBadge: document.getElementById("chunkBadge"),
  latencyBadge: document.getElementById("latencyBadge"),
};

els.sourceMode.value = localStorage.getItem("sourceMode") || "mp4";
els.rtspUrl.value = localStorage.getItem("rtspUrl") || "";
els.previewUrl.value = localStorage.getItem("previewUrl") || "";
els.mp4Name.value = localStorage.getItem("mp4Name") || DEFAULT_MP4_NAME;
els.chunkSeconds.value = localStorage.getItem("chunkSeconds") || "4";

async function populateVideoList() {
  try {
    const resp = await fetch("/v1/local-videos");
    const { files } = await resp.json();
    files.forEach((path) => {
      const opt = document.createElement("option");
      opt.value = path;
      opt.textContent = path.split("/").pop();
      els.mp4Path.appendChild(opt);
    });
    const saved = localStorage.getItem("mp4Path");
    if (saved && files.includes(saved)) {
      els.mp4Path.value = saved;
    } else if (files.length > 0) {
      els.mp4Path.value = files[0];
    }
  } catch (_e) {}
}
void populateVideoList();
void loadModelInfo();

function setRunning(running, status) {
  state.running = running;
  els.startButton.disabled = running || state.modelSwitching;
  els.stopButton.disabled = !running;
  els.modelSelect.disabled = running || state.modelSwitching;
  els.statusText.textContent = status;
}

let _modelPollTimer = null;

async function loadModelInfo() {
  try {
    const resp = await fetch("/v1/model");
    const data = await resp.json();

    if (els.modelSelect.options.length === 0) {
      data.available_models.forEach((path) => {
        const opt = document.createElement("option");
        opt.value = path;
        opt.textContent = path.split("/").pop();
        els.modelSelect.appendChild(opt);
      });
    }
    els.modelSelect.value = data.current_model;

    if (data.status === "switching") {
      state.modelSwitching = true;
      els.modelSelect.disabled = true;
      els.startButton.disabled = true;
      els.modelStatus.textContent = "Loading model…";
      if (!_modelPollTimer) {
        _modelPollTimer = setInterval(loadModelInfo, 3000);
      }
    } else {
      state.modelSwitching = false;
      els.modelStatus.textContent = "";
      if (_modelPollTimer) {
        clearInterval(_modelPollTimer);
        _modelPollTimer = null;
      }
      els.modelSelect.disabled = state.running;
      els.startButton.disabled = state.running;
    }
  } catch (_e) {}
}

els.modelSelect.addEventListener("change", async () => {
  const newModel = els.modelSelect.value;
  state.modelSwitching = true;
  els.modelSelect.disabled = true;
  els.startButton.disabled = true;
  els.modelStatus.textContent = "Switching model…";
  try {
    await fetch("/v1/model/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_path: newModel }),
    });
    if (!_modelPollTimer) {
      _modelPollTimer = setInterval(loadModelInfo, 3000);
    }
  } catch (_e) {
    state.modelSwitching = false;
    els.modelStatus.textContent = "Switch failed";
    els.modelSelect.disabled = false;
    els.startButton.disabled = false;
  }
});

function maskRtsp(url) {
  return url.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:****@");
}

function updateSourceModeUi() {
  const useMp4 = els.sourceMode.value === "mp4";
  document.querySelectorAll("[data-source='rtsp']").forEach((node) => {
    node.hidden = useMp4;
  });
  document.querySelectorAll("[data-source='mp4']").forEach((node) => {
    node.hidden = !useMp4;
  });
}

function logEvent(message) {
  const row = document.createElement("div");
  const now = new Date().toLocaleTimeString();
  row.textContent = `${now}  ${message}`;
  els.eventLog.prepend(row);
  while (els.eventLog.children.length > 80) {
    els.eventLog.lastElementChild.remove();
  }
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function startPreviewTimer(label) {
  stopPreviewTimer();
  state.previewStartedAt = Date.now();
  const update = () => {
    els.previewFallback.textContent = `${label}  ${formatElapsed(Date.now() - state.previewStartedAt)}`;
  };
  update();
  state.previewTimerId = window.setInterval(update, 1000);
}

function stopPreviewTimer(message = "Preview not connected") {
  if (state.previewTimerId) {
    window.clearInterval(state.previewTimerId);
    state.previewTimerId = null;
  }
  els.previewFallback.textContent = message;
}

function queueTyping(text) {
  if (!text) {
    return;
  }
  state.typingQueue.push(text.trim());
  if (!state.typing) {
    void typeNext();
  }
}

async function typeNext() {
  state.typing = true;
  while (state.typingQueue.length > 0) {
    const text = state.typingQueue.shift();
    const entry = document.createElement("div");
    entry.className = "inference-entry is-typing";
    els.typewriter.prepend(entry);
    while (els.typewriter.children.length > 80) {
      els.typewriter.lastElementChild.remove();
    }
    els.typewriter.scrollTop = 0;

    for (const char of text) {
      if (!state.running && state.typingQueue.length === 0) {
        break;
      }
      entry.textContent += char;
      els.typewriter.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 24));
    }
    entry.classList.remove("is-typing");
  }
  state.typing = false;
}

async function startPreview(rtspUrl, previewUrl) {
  clearPreviewMedia();
  startPreviewTimer("RTSP elapsed");

  const normalizedPreviewUrl = previewUrl.replace(/\/$/, "");
  const serviceOrigin = window.location.origin.replace(/\/$/, "");
  if (previewUrl && normalizedPreviewUrl !== serviceOrigin) {
    els.videoPreview.src = previewUrl;
    els.mediaFrame.classList.add("preview-video");
    void els.videoPreview.play().catch(() => {});
    return;
  }

  try {
    const response = await fetch("/v1/rtsp-preview-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: rtspUrl }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const session = await response.json();
    const previewSrc = session.preview_url + "?t=" + Date.now();
    els.mediaFrame.classList.add("preview-image");
    stopPreviewTimer("RTSP preview connected");
    els.mjpegPreview.onerror = () => {
      els.mediaFrame.classList.remove("preview-image");
      stopPreviewTimer("RTSP preview unavailable");
      logEvent("rtsp preview stream unavailable");
    };
    els.mjpegPreview.src = previewSrc;
  } catch (error) {
    logEvent(`preview unavailable: ${error.message}`);
  }
}

function stopPreview() {
  stopPreviewTimer();
  clearPreviewMedia();
}

function clearPreviewMedia() {
  els.mediaFrame.classList.remove("preview-image", "preview-video");
  els.mjpegPreview.onload = null;
  els.mjpegPreview.onerror = null;
  els.mjpegPreview.removeAttribute("src");
  els.videoPreview.pause();
  els.videoPreview.removeAttribute("src");
  els.videoPreview.load();
  if (state.uploadedPreviewUrl) {
    URL.revokeObjectURL(state.uploadedPreviewUrl);
    state.uploadedPreviewUrl = null;
  }
}

function showUploadedMp4Preview(file) {
  clearPreviewMedia();
  state.uploadedPreviewUrl = URL.createObjectURL(file);
  els.videoPreview.src = state.uploadedPreviewUrl;
  els.mediaFrame.classList.add("preview-video");
  void els.videoPreview.play().catch(() => {});
}

async function probeLocalMp4Preview(previewSrc) {
  const controller = new AbortController();
  try {
    const response = await fetch(previewSrc, {
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(detail);
        detail = parsed.detail || detail;
      } catch (_error) {
        // Keep the raw response body when it is not JSON.
      }
      throw new Error(response.status + " " + response.statusText + (detail ? ": " + detail : ""));
    }
  } finally {
    controller.abort();
  }
}

async function showLocalMp4Preview(path) {
  clearPreviewMedia();
  const previewSrc = `/v1/local-video-preview?path=${encodeURIComponent(path)}`;
  await probeLocalMp4Preview(previewSrc);
  els.videoPreview.src = previewSrc;
  els.mediaFrame.classList.add("preview-video");
  void els.videoPreview.play().catch(() => {});
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Unable to read MP4 file"));
    reader.readAsDataURL(file);
  });
}

async function getVideoContent(sourceMode) {
  if (sourceMode === "rtsp") {
    const rtspUrl = els.rtspUrl.value.trim();
    if (!rtspUrl.startsWith("rtsp://")) {
      throw new Error("RTSP source must start with rtsp://");
    }
    return { type: "video_url", video_url: { url: rtspUrl } };
  }

  const file = els.mp4File.files?.[0];
  if (file) {
    if (file.type && file.type !== "video/mp4") {
      throw new Error("MP4 upload must be a video/mp4 file");
    }
    const dataUrl = await readFileAsDataUrl(file);
    return { type: "video_url", video_url: { url: dataUrl } };
  }

  const mp4Path = els.mp4Path.value.trim() || DEFAULT_MP4_PATH;
  if (!mp4Path) {
    throw new Error("MP4 path or upload is required");
  }
  return { type: "video_url", video_url: { url: mp4Path } };
}

function buildPayload(videoContent, chunkSeconds) {
  return {
    model: "ds_sop_model",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: DEFAULT_PROMPT },
          videoContent,
        ],
      },
    ],
    stream: true,
    chunking_options: {
      algorithm: "ddm-net",
      threshold: 0.8,
      min_length_sec: 1.0,
      max_length_sec: chunkSeconds,
    },
  };
}

function processSseBlock(block) {
  if (block.split("\n").some((line) => line.trim() === "event: ping")) {
    return false;
  }
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return false;
  }

  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    logEvent("stream completed");
    return true;
  }

  let payload;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    logEvent(`ignored malformed SSE payload: ${error.message}`);
    return false;
  }

  const choice = payload.choices?.[0] || {};
  const content = choice.delta?.content || "";
  const metadata = choice.chunk_metadata || choice.delta?.chunk_metadata || {};
  const chunkIdx = metadata.chunk_idx ?? "-";
  const startTime = metadata.start_time;
  const endTime = metadata.end_time;
  const vlmTime = metadata.vlm_execute_time;

  els.chunkBadge.textContent = `chunk ${chunkIdx}`;
  if (typeof vlmTime === "number") {
    els.latencyBadge.textContent = `VLM ${vlmTime.toFixed(2)}s`;
  } else if (typeof startTime === "number" && typeof endTime === "number") {
    els.latencyBadge.textContent = `${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s`;
  }

  if (content) {
    queueTyping(content);
  }
  logEvent(`chunk ${chunkIdx}: ${content || "metadata received"}`);
  return false;
}

async function startInference() {
  const sourceMode = els.sourceMode.value;
  const rtspUrl = els.rtspUrl.value.trim();
  const previewUrl = els.previewUrl.value.trim();
  const mp4Path = els.mp4Path.value.trim() || DEFAULT_MP4_PATH;
  const mp4Name = els.mp4Name.value.trim() || DEFAULT_MP4_NAME;
  const chunkSeconds = Number(els.chunkSeconds.value || 4);
  let videoContent;

  try {
    videoContent = await getVideoContent(sourceMode);
  } catch (error) {
    setRunning(false, error.message);
    return;
  }

  localStorage.setItem("sourceMode", sourceMode);
  localStorage.setItem("rtspUrl", rtspUrl);
  localStorage.setItem("previewUrl", previewUrl);
  els.mp4Path.value = mp4Path;
  localStorage.setItem("mp4Path", mp4Path);
  localStorage.setItem("mp4Name", mp4Name);
  localStorage.setItem("chunkSeconds", String(chunkSeconds));

  state.abortController = new AbortController();
  state.typingQueue.length = 0;
  els.typewriter.textContent = "";
  els.eventLog.textContent = "";
  els.chunkBadge.textContent = "chunk -";
  els.latencyBadge.textContent = "connecting";
  if (sourceMode === "rtsp") {
    setRunning(true, `Connecting to ${maskRtsp(rtspUrl)}`);
    await startPreview(rtspUrl, previewUrl);
    logEvent("rtsp inference request started");
  } else {
    const uploadedFile = els.mp4File.files?.[0];
    setRunning(true, `Loading MP4 ${mp4Name}`);
    if (uploadedFile) {
      showUploadedMp4Preview(uploadedFile);
      logEvent(`mp4 upload selected: ${uploadedFile.name}`);
    } else {
      try {
        await showLocalMp4Preview(mp4Path);
      } catch (error) {
        els.mediaFrame.classList.remove("preview-video");
        stopPreviewTimer("MP4 preview unavailable");
        logEvent(`mp4 preview unavailable: ${error.message}`);
      }
      logEvent(`mp4 source selected: ${mp4Name} (${mp4Path || DEFAULT_MP4_PATH})`);
    }
  }

  try {
    const response = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(buildPayload(videoContent, chunkSeconds)),
      signal: state.abortController.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${detail}`);
    }

    setRunning(true, "Inference running");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    while (!done) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        done = processSseBlock(block) || done;
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      logEvent("inference stopped");
    } else {
      logEvent(`error: ${error.message}`);
      els.statusText.textContent = error.message;
    }
  } finally {
    if (sourceMode === "rtsp") {
      stopPreview();
    }
    state.abortController = null;
    setRunning(false, "Idle");
  }
}

function stopInference() {
  if (state.abortController) {
    state.abortController.abort();
  }
  stopPreview();
  setRunning(false, "Stopping");
}

els.startButton.addEventListener("click", () => {
  void startInference();
});
els.stopButton.addEventListener("click", stopInference);
els.sourceMode.addEventListener("change", updateSourceModeUi);
els.videoPreview.addEventListener("error", () => {
  if (state.running && els.sourceMode.value === "mp4") {
    els.mediaFrame.classList.remove("preview-video");
    stopPreviewTimer("MP4 preview unavailable");
    logEvent("mp4 preview unavailable");
  }
});
updateSourceModeUi();
