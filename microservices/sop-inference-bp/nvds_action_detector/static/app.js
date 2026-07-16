const PROMPTS = {
  en: "Describe what action is happening in this video buffer. Respond only in English. Keep the answer concise and operational.",
  "zh-TW": "辨識這段影片正在進行的動作，將動作描述翻譯成繁體中文，並且只使用繁體中文回答。內容需簡潔、明確且適合現場操作。",
};

const TRANSLATIONS = {
  en: {
    pageTitle: "SOP Execution Monitor", heading: "SOP Execution Monitor", idle: "Idle", language: "Language",
    start: "Start Monitoring", stop: "Stop Monitoring", source: "Source", rtspSource: "RTSP source", previewUrl: "Preview URL",
    mp4File: "MP4 file", mp4Upload: "MP4 upload", name: "Name", model: "Model",
    chunkSeconds: "Detection Interval", previewNotConnected: "Preview not connected", waiting: "waiting",
    vlmInference: "Live Action Detection", loadingModel: "Loading model…", switchingModel: "Switching model…",
    switchFailed: "Switch failed", detecting: "Monitoring", stopping: "Stopping monitoring",
    previewUnavailable: "RTSP preview unavailable", previewConnected: "RTSP preview connected",
    chunk: "chunk",
  },
  "zh-TW": {
    pageTitle: "SOP 作業監控", heading: "SOP 作業監控", idle: "閒置", language: "語言",
    start: "開始監控", stop: "停止監控", source: "來源", rtspSource: "RTSP 來源", previewUrl: "預覽網址",
    mp4File: "MP4 檔案", mp4Upload: "上傳 MP4", name: "名稱", model: "模型",
    chunkSeconds: "偵測間隔", previewNotConnected: "尚未連接預覽", waiting: "等待中",
    vlmInference: "即時動作偵測", loadingModel: "模型載入中…", switchingModel: "模型切換中…",
    switchFailed: "模型切換失敗", detecting: "監控中", stopping: "正在停止監控",
    previewUnavailable: "RTSP 預覽無法使用", previewConnected: "RTSP 預覽已連接",
    chunk: "分段",
  },
};
const DEFAULT_MP4_PATH = "/home/spark/eason/x86-sop-inference-bp/tests/0428_test.mp4";
const DEFAULT_MP4_NAME = "default";

const state = {
  abortController: null,
  typingQueue: [],
  typing: false,
  running: false,
  modelSwitching: false,
  modelReady: false,
  language: localStorage.getItem("language") === "zh-TW" ? "zh-TW" : "en",
  previewTimerId: null,
  previewStartedAt: 0,
  uploadedPreviewUrl: null,
  lastAction: "",
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
  modelBadge: document.getElementById("modelBadge"),
  languageSelect: document.getElementById("languageSelect"),
  detectionStatus: document.getElementById("detectionStatus"),
  mediaFrame: document.querySelector(".media-frame"),
  mjpegPreview: document.getElementById("mjpegPreview"),
  videoPreview: document.getElementById("videoPreview"),
  previewFallback: document.getElementById("previewFallback"),
  typewriter: document.getElementById("typewriter"),
  eventLog: document.getElementById("eventLog"),
  chunkBadge: document.getElementById("chunkBadge"),
  latencyBadge: document.getElementById("latencyBadge"),
};

function t(key) {
  return TRANSLATIONS[state.language][key] || TRANSLATIONS.en[key] || key;
}

function localized(en, zh) {
  return state.language === "zh-TW" ? zh : en;
}

function applyUiLanguage() {
  document.documentElement.lang = state.language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  els.languageSelect.value = state.language;
  els.detectionStatus.setAttribute("aria-label", localized("Detection status", "偵測狀態"));
}

els.sourceMode.value = localStorage.getItem("sourceMode") || "mp4";
applyUiLanguage();
els.rtspUrl.value = localStorage.getItem("rtspUrl") || "";
els.previewUrl.value = localStorage.getItem("previewUrl") || "";
els.mp4Name.value = localStorage.getItem("mp4Name") || DEFAULT_MP4_NAME;
const savedChunkSeconds = localStorage.getItem("chunkSeconds");
els.chunkSeconds.value = !savedChunkSeconds || savedChunkSeconds === "4" ? "2" : savedChunkSeconds;

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
  els.startButton.disabled = running || state.modelSwitching || !state.modelReady;
  els.stopButton.disabled = !running;
  els.modelSelect.disabled = running || state.modelSwitching;
  els.languageSelect.disabled = running;
  els.statusText.textContent = status;
}

let _modelPollTimer = null;

function modelDisplayName(path) {
  const basename = String(path || "").replace(/\/$/, "").split("/").pop() || "";
  const version = basename.match(/(?:model[^0-9]*|_)([12])$/i)?.[1];
  return version ? `cosmos_${version}` : basename || "cosmos";
}

async function loadModelInfo() {
  try {
    const resp = await fetch("/v1/model");
    const data = await resp.json();

    if (els.modelSelect.options.length === 0) {
      data.available_models.forEach((path) => {
        const opt = document.createElement("option");
        opt.value = path;
        opt.textContent = modelDisplayName(path);
        els.modelSelect.appendChild(opt);
      });
    }
    els.modelSelect.value = data.current_model;
    els.modelBadge.textContent = modelDisplayName(data.current_model);

    if (data.status !== "ready") {
      state.modelReady = false;
      state.modelSwitching = true;
      els.modelSelect.disabled = true;
      els.startButton.disabled = true;
      els.modelStatus.textContent = t("loadingModel");
      if (!_modelPollTimer) {
        _modelPollTimer = setInterval(loadModelInfo, 3000);
      }
    } else {
      state.modelReady = true;
      state.modelSwitching = false;
      els.modelStatus.textContent = "";
      if (_modelPollTimer) {
        clearInterval(_modelPollTimer);
        _modelPollTimer = null;
      }
      els.modelSelect.disabled = state.running;
      els.startButton.disabled = state.running || !state.modelReady;
    }
  } catch (_e) {
    state.modelReady = false;
    els.startButton.disabled = true;
    if (!_modelPollTimer) {
      _modelPollTimer = setInterval(loadModelInfo, 3000);
    }
  }
}

els.modelSelect.addEventListener("change", async () => {
  const newModel = els.modelSelect.value;
  state.modelSwitching = true;
  state.modelReady = false;
  els.modelSelect.disabled = true;
  els.startButton.disabled = true;
  els.modelStatus.textContent = t("switchingModel");
  try {
    const response = await fetch("/v1/model/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_path: newModel }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    if (!_modelPollTimer) {
      _modelPollTimer = setInterval(loadModelInfo, 3000);
    }
  } catch (_e) {
    state.modelSwitching = false;
    state.modelReady = false;
    els.modelStatus.textContent = t("switchFailed");
    els.modelSelect.disabled = false;
    els.startButton.disabled = true;
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
  els.eventLog.scrollTop = 0;
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

function stopPreviewTimer(message = t("previewNotConnected")) {
  if (state.previewTimerId) {
    window.clearInterval(state.previewTimerId);
    state.previewTimerId = null;
  }
  els.previewFallback.textContent = message;
}

function startDetectionStatus() {
  state.lastAction = "";
  els.detectionStatus.classList.add("is-detecting");
}

function stopDetectionStatus() {
  els.detectionStatus.classList.remove("is-detecting");
}

function normalizeAction(text) {
  return String(text || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();
}

function presentAction(content) {
  const normalized = normalizeAction(content);
  if (!normalized) {
    return;
  }
  if (normalized === state.lastAction) {
    logEvent(localized("Same action continues; detection is active", "相同動作持續進行；系統仍在偵測"));
    return;
  }
  state.lastAction = normalized;
  queueTyping(content);
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
  startPreviewTimer(localized("RTSP elapsed", "RTSP 已經過"));

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
    stopPreviewTimer(t("previewConnected"));
    els.mjpegPreview.onerror = () => {
      els.mediaFrame.classList.remove("preview-image");
      stopPreviewTimer(t("previewUnavailable"));
      logEvent(localized("RTSP preview stream unavailable", "RTSP 預覽串流無法使用"));
    };
    els.mjpegPreview.src = previewSrc;
  } catch (error) {
    stopPreviewTimer(t("previewUnavailable"));
    logEvent(localized(`Preview unavailable: ${error.message}`, `預覽無法使用：${error.message}`));
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
      throw new Error(localized("RTSP source must start with rtsp://", "RTSP 來源必須以 rtsp:// 開頭"));
    }
    return { type: "video_url", video_url: { url: rtspUrl } };
  }

  const file = els.mp4File.files?.[0];
  if (file) {
    if (file.type && file.type !== "video/mp4") {
      throw new Error(localized("MP4 upload must be a video/mp4 file", "上傳檔案必須是 video/mp4 格式"));
    }
    const dataUrl = await readFileAsDataUrl(file);
    return { type: "video_url", video_url: { url: dataUrl } };
  }

  const mp4Path = els.mp4Path.value.trim() || DEFAULT_MP4_PATH;
  if (!mp4Path) {
    throw new Error(localized("MP4 path or upload is required", "請選擇 MP4 路徑或上傳檔案"));
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
          { type: "text", text: PROMPTS[state.language] },
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
    logEvent(localized("Stream completed", "串流已完成"));
    return true;
  }

  let payload;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    logEvent(localized(`Ignored malformed SSE payload: ${error.message}`, `已忽略格式錯誤的 SSE 資料：${error.message}`));
    return false;
  }

  const choice = payload.choices?.[0] || {};
  const content = choice.delta?.content || "";
  const metadata = choice.chunk_metadata || choice.delta?.chunk_metadata || {};
  const chunkIdx = metadata.chunk_idx ?? "-";
  const startTime = metadata.start_time;
  const endTime = metadata.end_time;
  const vlmTime = metadata.vlm_execute_time;

  els.chunkBadge.textContent = `${t("chunk")} ${chunkIdx}`;
  if (typeof vlmTime === "number") {
    els.latencyBadge.textContent = `VLM ${vlmTime.toFixed(2)}s`;
  } else if (typeof startTime === "number" && typeof endTime === "number") {
    els.latencyBadge.textContent = `${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s`;
  }

  if (content) {
    presentAction(content);
  }
  logEvent(localized(
    `Chunk ${chunkIdx}: ${content || "metadata received"}`,
    `分段 ${chunkIdx}：${content || "已收到中繼資料"}`,
  ));
  return false;
}

async function startInference() {
  const sourceMode = els.sourceMode.value;
  const rtspUrl = els.rtspUrl.value.trim();
  const previewUrl = els.previewUrl.value.trim();
  const mp4Path = els.mp4Path.value.trim() || DEFAULT_MP4_PATH;
  const mp4Name = els.mp4Name.value.trim() || DEFAULT_MP4_NAME;
  const chunkSeconds = Number(els.chunkSeconds.value || 2);
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
  els.chunkBadge.textContent = `${t("chunk")} -`;
  els.latencyBadge.textContent = localized("connecting", "連線中");
  startDetectionStatus();
  setRunning(true, sourceMode === "rtsp"
    ? localized(`Connecting to ${maskRtsp(rtspUrl)}`, `正在連接 ${maskRtsp(rtspUrl)}`)
    : localized(`Loading MP4 ${mp4Name}`, `正在載入 MP4 ${mp4Name}`));
  clearPreviewMedia();

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

    // Do not let visible playback run ahead while the inference pipeline is starting.
    if (sourceMode === "rtsp") {
      await startPreview(rtspUrl, previewUrl);
      logEvent(localized("RTSP inference and preview started", "RTSP 推論與預覽已開始"));
    } else {
      const uploadedFile = els.mp4File.files?.[0];
      if (uploadedFile) {
        showUploadedMp4Preview(uploadedFile);
        logEvent(localized(`MP4 upload selected: ${uploadedFile.name}`, `已選擇上傳的 MP4：${uploadedFile.name}`));
      } else {
        try {
          await showLocalMp4Preview(mp4Path);
        } catch (error) {
          els.mediaFrame.classList.remove("preview-video");
          stopPreviewTimer(localized("MP4 preview unavailable", "MP4 預覽無法使用"));
          logEvent(localized(`MP4 preview unavailable: ${error.message}`, `MP4 預覽無法使用：${error.message}`));
        }
        logEvent(localized(
          `MP4 source selected: ${mp4Name} (${mp4Path || DEFAULT_MP4_PATH})`,
          `已選擇 MP4 來源：${mp4Name}（${mp4Path || DEFAULT_MP4_PATH}）`,
        ));
      }
    }

    setRunning(true, t("detecting"));
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
      logEvent(localized("Inference stopped", "推論已停止"));
    } else {
      logEvent(localized(`Error: ${error.message}`, `錯誤：${error.message}`));
      els.statusText.textContent = error.message;
    }
  } finally {
    if (sourceMode === "rtsp") {
      stopPreview();
    }
    state.abortController = null;
    stopDetectionStatus();
    setRunning(false, t("idle"));
  }
}

function stopInference() {
  if (state.abortController) {
    state.abortController.abort();
  }
  stopPreview();
  stopDetectionStatus();
  setRunning(false, t("stopping"));
}

els.startButton.addEventListener("click", () => {
  void startInference();
});
els.stopButton.addEventListener("click", stopInference);
els.sourceMode.addEventListener("change", updateSourceModeUi);
els.languageSelect.addEventListener("change", () => {
  if (state.running) {
    els.languageSelect.value = state.language;
    return;
  }
  state.language = els.languageSelect.value === "zh-TW" ? "zh-TW" : "en";
  localStorage.setItem("language", state.language);
  applyUiLanguage();
  els.statusText.textContent = t("idle");
  if (state.modelSwitching) {
    els.modelStatus.textContent = t("loadingModel");
  }
});
els.videoPreview.addEventListener("error", () => {
  if (state.running && els.sourceMode.value === "mp4") {
    els.mediaFrame.classList.remove("preview-video");
    stopPreviewTimer(localized("MP4 preview unavailable", "MP4 預覽無法使用"));
    logEvent(localized("MP4 preview unavailable", "MP4 預覽無法使用"));
  }
});
updateSourceModeUi();
