const RTSP_URL = window.SOP_STREAM_CONFIG?.rtspUrl
  || "rtsp://root:1q2w3e4r@172.24.56.18:554/media2/stream.sdp?profile=Profile201";
const STORAGE_KEY = "plantManagerDemoLanguage";
const MOTION_THRESHOLD_STORAGE_KEY = "plantManagerMotionThreshold";
const MOTION_GATE_STORAGE_KEY = "plantManagerMotionGateEnabled";
const DEMO_INFERENCE_ENABLED = true;
const LABEL_MAPPING_URL = "/static/sop-label-mapping.json";
let SOP_LABEL_MAPPINGS = [];
let COSMOS_LONG_DESCRIPTIONS = [];
let COSMOS_PROMPTS = {};
const ACTION_STATE_SNAPSHOTS = new Map();
const RESOLVED_MAPPING_BY_ID = new Map();

async function loadLabelMappingConfig() {
  const response = await fetch(LABEL_MAPPING_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Label mapping config: ${response.status}`);
  const config = await response.json();
  const mappings = Array.isArray(config.mappings) ? config.mappings : [];
  if (mappings.length !== 8 || mappings.some((item, index) => item.step !== index + 1 || !item.short_label || !item.vlm_training_label || !item.long_description)) {
    throw new Error("Label mapping config must contain ordered steps 1-8 with short_label, vlm_training_label, and long_description");
  }
  SOP_LABEL_MAPPINGS = mappings;
  COSMOS_LONG_DESCRIPTIONS = mappings.map((item) => item.long_description);
  const mappingText = mappings.map((item) => `(${item.step}) ${item.short_label} <= ${item.vlm_training_label}`).join("\n");
  COSMOS_PROMPTS = {
    "zh-TW": `請先依據模型原始訓練 label 理解影片動作，再使用以下映射輸出 SOP step：\n${mappingText}\n第一行只能輸出最符合的「SOP 編號與完整英文 label」。第二行以繁體中文簡潔描述畫面中實際看到的動作。步驟 5–8 請依畫面中的 cover 層級判斷。若畫面不足以確認，請明確寫「無法確認」。`,
    en: `First interpret the video using the model's original training labels, then map it to an SOP step:\n${mappingText}\nThe first line must contain only the best matching SOP number and complete English label. On the second line, briefly describe the visible action. For steps 5-8, use the visible cover level. If uncertain, explicitly state "Uncertain".`,
  };
}

function normalizeSopLabel(value) {
  return String(value || "").toLowerCase().replace(/^\s*\(?\d+\)?[.):\-\s]*/, "").replace(/[^a-z0-9]+/g, "");
}

function sopIdentity(current) {
  const checker = current.checker_result || {};
  return `${checker.session_id ?? "no-session"}:${checker.tracker_id ?? current.station_id ?? "default"}`;
}

function resolveSopMapping(current, actionStates = {}) {
  const identity = sopIdentity(current);
  if (Object.keys(actionStates).length > 0) {
    const previousStates = ACTION_STATE_SNAPSHOTS.get(identity) || {};
    const nextStates = Object.fromEntries(
      Array.from({ length: SOP_LABEL_MAPPINGS.length }, (_, index) => [`action_${index}`, Boolean(actionStates[`action_${index}`])]),
    );
    const newlyActiveIndex = Array.from({ length: SOP_LABEL_MAPPINGS.length }, (_, index) => index)
      .find((index) => nextStates[`action_${index}`] && !previousStates[`action_${index}`]);
    ACTION_STATE_SNAPSHOTS.set(identity, nextStates);
    if (newlyActiveIndex != null) {
      const mapping = SOP_LABEL_MAPPINGS[newlyActiveIndex];
      RESOLVED_MAPPING_BY_ID.set(identity, mapping);
      return mapping;
    }
    const previousMapping = RESOLVED_MAPPING_BY_ID.get(identity);
    if (previousMapping) return previousMapping;
  }
  const normalizedActionName = normalizeSopLabel(current.action_name);
  const nameMatch = normalizedActionName
    ? SOP_LABEL_MAPPINGS.find((item) => normalizeSopLabel(item.short_label) === normalizedActionName)
    : null;
  if (nameMatch) {
    RESOLVED_MAPPING_BY_ID.set(identity, nameMatch);
    return nameMatch;
  }
  const actionId = Number(current.action_id);
  const fallback = Number.isInteger(actionId) && actionId >= 1 && actionId <= SOP_LABEL_MAPPINGS.length
    ? SOP_LABEL_MAPPINGS[actionId - 1]
    : null;
  if (fallback) RESOLVED_MAPPING_BY_ID.set(identity, fallback);
  return fallback;
}
const TRANSLATIONS = {
  "zh-TW": {
    pageTitle: "SOP 作業監控｜廠長版 Demo", factoryOperations: "工廠營運", heading: "SOP 作業監控",
    language: "語言", chineseLanguage: "中文", englishLanguage: "英文", factory: "WUS D1", siteDetail: "產線 2 · 工站 8", systemNormal: "系統正常",
    demoMode: "即時模式", demoNotice: "Cosmos 描述、KPI 與事件使用即時資料；SOP 步驟等待正式設定。",
    compliance: "今日 SOP 合規率", vsYesterday: "↑ 1.2% 較昨日", completedCycles: "完成循環", times: " 次", liveDatabase: "即時資料庫",
    cycleTarget: "目標 150 次", todayExceptions: "今日異常", pendingReview: "1 件待確認",
    averageCycle: "平均作業週期", cycleTimeTarget: "目標 04:00 內", todayMetrics: "今日營運指標",
    liveViewLabel: "即時畫面", liveView: "即時監控畫面", liveViewAlt: "即時產線監控畫面", liveBadge: "即時",
    connectingCamera: "正在連接攝影機", cameraUnavailable: "攝影機畫面暫時無法使用", cameraFailed: "攝影機連線失敗",
    rtspConnecting: "RTSP 連線中", rtspConnected: "RTSP 已連線", rtspError: "RTSP 連線異常",
    currentOperationLabel: "目前作業", currentOperation: "目前作業", inProgress: "進行中", stepFourOfEight: "步驟 4 / 8",
    currentAction: "依序鬆開冷板固定螺絲", currentActionDetail: "正式 SOP 提供後，這裡會顯示步驟判定。",
    stepPendingConfig: "SOP 步驟等待設定", waitingForSop: "等待 SOP Checker 更新",
    cosmosDescription: "Cosmos 動作描述", cosmosActionDescription: "", waitingForCosmos: "正在連接 cosmos_2 即時推論…", cosmosIdle: "未偵測到明顯動作，等待操作員下一步動作。", cosmosUnavailable: "cosmos_2 即時推論暫時無法使用。", demoInferenceDisabled: "Demo 推論暫時關閉，GPU 保留給 QAS。", trackerRemoved: "Tracker 已移除，等待新的 SOP 作業。",
    duration: "持續時間", confidence: "辨識信心度", model: "模型", sopProgress: "SOP 完成進度", motionThreshold: "Motion Threshold", motionGate: "Frame-difference", motionGateOn: "開啟", motionGateOff: "關閉", cosmosProcessing: "等待下一次 VLM 推論結果…",
    step1: "鬆開上方螺絲", step2: "鬆開下方螺絲", step3: "裝上頂層蓋板",
    step4: "裝上第二層蓋板", step5: "裝上第三層蓋板", step6: "裝上第四層蓋板", pending: "待執行", completed: "已完成",
    recentEventsLabel: "最近事件", recentEvents: "最近事件與異常", viewAll: "查看完整紀錄",
    sequenceError: "順序異常", station03: "工站 8", sequenceMessage: "步驟 3 尚未完成即進入步驟 4", confirmed: "已確認",
    excessiveWait: "等待過久", waitMessage: "步驟 2 執行時間超過標準 42 秒", toHandle: "待處理",
    cycleComplete: "循環完成", cycleMessage: "SOP 循環 #124 完成，合規率 100%", normal: "正常", waiting: "等待中", waitingForEvents: "等待 SOP Checker 事件",
  },
  en: {
    pageTitle: "SOP Execution Monitor | Plant Manager Demo", factoryOperations: "FACTORY OPERATIONS", heading: "SOP Execution Monitor",
    language: "Language", chineseLanguage: "Chinese", englishLanguage: "English", factory: "WUS D1", siteDetail: "Line 2 · Station 8", systemNormal: "System Healthy",
    demoMode: "LIVE MODE", demoNotice: "Cosmos descriptions, KPIs, and events use live data; SOP steps await the production configuration.",
    compliance: "Today's SOP Compliance", vsYesterday: "↑ 1.2% vs. yesterday", completedCycles: "Completed Cycles", times: "", liveDatabase: "Live database",
    cycleTarget: "Target: 150 cycles", todayExceptions: "Today's Exceptions", pendingReview: "1 pending review",
    averageCycle: "Average Cycle Time", cycleTimeTarget: "Target: under 04:00", todayMetrics: "Today's Operations Metrics",
    liveViewLabel: "LIVE VIEW", liveView: "Live Production View", liveViewAlt: "Live production line monitoring feed", liveBadge: "LIVE",
    connectingCamera: "Connecting to camera", cameraUnavailable: "Camera feed is temporarily unavailable", cameraFailed: "Camera connection failed",
    rtspConnecting: "Connecting to RTSP", rtspConnected: "RTSP Connected", rtspError: "RTSP Connection Error",
    currentOperationLabel: "CURRENT OPERATION", currentOperation: "Current Operation", inProgress: "In Progress", stepFourOfEight: "Step 4 of 8",
    currentAction: "Loosen the cold-plate mounting screws in sequence", currentActionDetail: "The matched step will appear here after the production SOP is provided.",
    stepPendingConfig: "SOP steps awaiting configuration", waitingForSop: "Waiting for SOP Checker update",
    cosmosDescription: "Cosmos Action Description", cosmosActionDescription: "", waitingForCosmos: "Connecting to live cosmos_2 inference…", cosmosIdle: "No significant motion detected. Waiting for the operator's next action.", cosmosUnavailable: "Live cosmos_2 inference is temporarily unavailable.", demoInferenceDisabled: "Demo inference is temporarily disabled; GPU is reserved for QAS.", trackerRemoved: "Waiting for a new SOP session.",
    duration: "Duration", confidence: "Detection Confidence", model: "Model", sopProgress: "SOP Completion Progress", motionThreshold: "Motion Threshold", motionGate: "Frame-difference", motionGateOn: "On", motionGateOff: "Off", cosmosProcessing: "Waiting for the next VLM result…",
    step1: "Loosen the screw (TOP)", step2: "Loosen the screw (BOT)", step3: "Put on the cover (Top)",
    step4: "Put on the cover (Second)", step5: "Put on the cover (Third)", step6: "Put on the cover (Fourth)", pending: "Pending", completed: "Completed",
    recentEventsLabel: "RECENT EVENTS", recentEvents: "Recent Events & Exceptions", viewAll: "View Full History",
    sequenceError: "Sequence Error", station03: "Station 8", sequenceMessage: "Step 4 started before Step 3 was completed", confirmed: "Confirmed",
    excessiveWait: "Excessive Wait", waitMessage: "Step 2 exceeded the standard time by 42 seconds", toHandle: "Action Required",
    cycleComplete: "Cycle Complete", cycleMessage: "SOP cycle #124 completed with 100% compliance", normal: "Normal", waiting: "Waiting", waitingForEvents: "Waiting for SOP Checker events",
  },
};

const clock = document.getElementById("clock");
const preview = document.getElementById("livePreview");
const frame = document.querySelector(".video-frame");
const previewStateText = document.getElementById("previewStateText");
const streamStatus = document.getElementById("streamStatus");
const actionTimer = document.getElementById("actionTimer");
const languageSelect = document.getElementById("languageSelect");
const cosmosActionDescription = document.getElementById("cosmosActionDescription");
const COSMOS_CHARACTERS_PER_SECOND = 100;
let cosmosTypewriterTarget = "";
let cosmosTypewriterTimer = null;
const currentActionName = document.getElementById("currentActionName");
const currentStepLabel = document.getElementById("currentStepLabel");
const confidenceValue = document.getElementById("confidenceValue");
const complianceValue = document.getElementById("complianceValue");
const completedCyclesValue = document.getElementById("completedCyclesValue");
const exceptionsValue = document.getElementById("exceptionsValue");
const averageCycleValue = document.getElementById("averageCycleValue");
const stepNumber = document.getElementById("stepNumber");
const progressValue = document.getElementById("progressValue");
const progressBar = document.getElementById("progressBar");
const motionGateEnabled = document.getElementById("motionGateEnabled");
const motionGateState = document.getElementById("motionGateState");
const motionThreshold = document.getElementById("motionThreshold");
const motionThresholdValue = document.getElementById("motionThresholdValue");
let language = localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh-TW";
let previewMessageKey = "connectingCamera";
let streamStatusKey = "rtspConnecting";
let seconds = 18;
let previewSessionId = null;
let latestDashboard = null;
let cosmosController = null;
let lastCosmosDescription = "";
let lastCosmosUpdateAt = 0;
let cosmosReconnectTimer = null;
let lastSopProgressSignature = null;
let mappedSopDescriptionActive = false;
const COSMOS_IDLE_AFTER_MS = 20000;
const savedMotionGateValue = localStorage.getItem(MOTION_GATE_STORAGE_KEY);
motionGateEnabled.checked = savedMotionGateValue === null ? true : savedMotionGateValue === "true";
const savedMotionThresholdValue = localStorage.getItem(MOTION_THRESHOLD_STORAGE_KEY);
const savedMotionThreshold = Number(savedMotionThresholdValue);
motionThreshold.value = savedMotionThresholdValue !== null && Number.isFinite(savedMotionThreshold)
  ? String(Math.min(50, Math.max(5, savedMotionThreshold)))
  : "10";

function updateMotionControls() {
  const enabled = motionGateEnabled.checked;
  motionThreshold.disabled = !enabled;
  motionThresholdValue.textContent = enabled ? motionThreshold.value + "%" : "--";
  motionGateState.textContent = t(enabled ? "motionGateOn" : "motionGateOff");
}

function t(key) {
  const dictionary = TRANSLATIONS[language];
  if (Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
  return TRANSLATIONS["zh-TW"][key] ?? key;
}

function typeCosmosText(text, reset = true) {
  const nextText = String(text || "");
  if (reset && nextText === cosmosTypewriterTarget) return;
  if (reset) {
    cosmosTypewriterTarget = nextText;
    cosmosActionDescription.textContent = "";
  } else {
    cosmosTypewriterTarget = nextText;
  }
  if (cosmosTypewriterTimer) return;
  const tick = () => {
    const shown = cosmosActionDescription.textContent;
    if (!cosmosTypewriterTarget.startsWith(shown)) cosmosActionDescription.textContent = "";
    const current = cosmosActionDescription.textContent;
    if (current.length < cosmosTypewriterTarget.length) {
      cosmosActionDescription.textContent = cosmosTypewriterTarget.slice(0, current.length + 1);
      cosmosTypewriterTimer = window.setTimeout(tick, 1000 / COSMOS_CHARACTERS_PER_SECOND);
    } else {
      cosmosTypewriterTimer = null;
    }
  };
  tick();
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll("[data-i18n-alt]").forEach((element) => { element.alt = t(element.dataset.i18nAlt); });
  document.querySelector(".kpi-grid").setAttribute("aria-label", t("todayMetrics"));
  languageSelect.value = language;
  languageSelect.setAttribute("aria-label", t("language"));
  previewStateText.textContent = t(previewMessageKey);
  streamStatus.textContent = t(streamStatusKey);
  updateMotionControls();
  updateClock(false);
  if (latestDashboard) renderDashboard(latestDashboard);
}

function formatDuration(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function renderDashboard(dashboard) {
  latestDashboard = dashboard;
  const current = dashboard.current || {};
  const kpi = dashboard.kpi || {};
  const actionStates = current.checker_result?.action_states || {};
  const identity = sopIdentity(current);
  const trackerRemoved = current.status === "tracker_removed";
  const hasActionSnapshot = Object.keys(actionStates).length > 0;
  if (!lastCosmosUpdateAt) {
    cosmosActionDescription.textContent = current.cosmos_description || t("waitingForCosmos");
  }
  currentActionName.textContent = trackerRemoved ? t("waitingForSop") : (current.action_name || t("waitingForSop"));
  if (trackerRemoved) {
    ACTION_STATE_SNAPSHOTS.delete(identity);
    RESOLVED_MAPPING_BY_ID.delete(identity);
  }
  const resolvedMapping = trackerRemoved ? null : resolveSopMapping(current, actionStates);
  const activeStep = resolvedMapping?.step ?? null;
  currentStepLabel.textContent = activeStep == null
    ? t("stepPendingConfig")
    : (language === "en" ? `SOP Action ${activeStep} of 8` : `SOP 動作 ${activeStep} / 8`);
  const activeActions = Array.from({ length: 8 }, (_, index) => Boolean(actionStates[`action_${index}`]));
  const activeCount = activeActions.filter(Boolean).length;
  const progressSignature = `${identity}:${trackerRemoved ? "removed" : activeStep ?? "none"}:${activeActions.map((active) => active ? "1" : "0").join("")}`;
  if (progressSignature !== lastSopProgressSignature) {
    lastSopProgressSignature = progressSignature;
    if (trackerRemoved) {
      const removedMessage = t("trackerRemoved");
      mappedSopDescriptionActive = true;
      lastCosmosDescription = removedMessage;
      lastCosmosUpdateAt = Date.now();
      typeCosmosText(removedMessage);
    } else if (resolvedMapping) {
      const mappedDescription = resolvedMapping.long_description;
      mappedSopDescriptionActive = true;
      lastCosmosDescription = mappedDescription;
      lastCosmosUpdateAt = Date.now();
      typeCosmosText(mappedDescription);
    } else {
      mappedSopDescriptionActive = false;
    }
  }
  stepNumber.textContent = activeStep == null ? "--" : String(activeStep).padStart(2, "0");
  const progress = hasActionSnapshot
    ? (activeCount / 8) * 100
    : Math.min(100, Math.max(0, ((activeStep ?? -1) + 1) / 8 * 100));
  progressValue.textContent = `${Math.round(progress)}%`;
  progressBar.style.width = `${progress}%`;
  document.querySelectorAll(".step-list li[data-step-id]").forEach((item) => {
    const id = Number(item.dataset.stepId);
    const marker = item.querySelector("b");
    const status = item.querySelector("time");
    const isOn = hasActionSnapshot ? activeActions[id] : activeStep != null && id <= activeStep;
    item.classList.toggle("done", isOn);
    item.classList.toggle("active", isOn);
    marker.textContent = isOn ? "●" : "○";
    status.textContent = isOn ? t("completed") : t("pending");
  });
  confidenceValue.textContent = `${Number(current.confidence ?? 96.7).toFixed(1)}%`;
  complianceValue.textContent = "100.0";
  completedCyclesValue.textContent = String(kpi.completed_cycles || 0);
  exceptionsValue.textContent = "0";
  averageCycleValue.textContent = formatDuration(kpi.average_cycle_seconds);
  if (current.updated_at) seconds = Math.max(0, Math.floor((Date.now() - new Date(current.updated_at).getTime()) / 1000));
}

async function refreshDashboard() {
  try {
    const response = await fetch(
      "/v1/plant-manager/dashboard?station_id=plant_line_stage_camera",
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(`${response.status}`);
    renderDashboard(await response.json());
  } catch (_error) {
    // Keep the most recent values visible during a temporary API interruption.
  }
}

function processCosmosSseBlock(block) {
  if (block.split("\n").some((line) => line.trim() === "event: ping")) return false;
  const data = block.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return false;
  if (data === "[DONE]") return true;
  try {
    const payload = JSON.parse(data);
    const content = String(payload.choices?.[0]?.delta?.content || "");
    if (content.trim() && !mappedSopDescriptionActive) {
      lastCosmosUpdateAt = Date.now();
      lastCosmosDescription = content.startsWith(lastCosmosDescription)
        ? content
        : lastCosmosDescription + content;
      typeCosmosText(lastCosmosDescription, false);
    }
  } catch (_error) {
    // Ignore an incomplete or malformed SSE event and continue reading.
  }
  return false;
}

async function connectCosmosInference() {
  if (!DEMO_INFERENCE_ENABLED) {
    if (cosmosController) cosmosController.abort();
    typeCosmosText(t("demoInferenceDisabled"));
    return;
  }
  if (cosmosController) cosmosController.abort();
  cosmosController = new AbortController();
  lastCosmosDescription = "";
  lastCosmosUpdateAt = Date.now();
  typeCosmosText(t("waitingForCosmos"));
  try {
    const requestBody = {
        model: "ds_sop_model",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: COSMOS_PROMPTS[language] },
            { type: "video_url", video_url: { url: RTSP_URL } },
          ],
        }],
        stream: true,
        chunking_options: {
          algorithm: "ddm-net",
          threshold: 0.8,
          min_length_sec: 3.0,
          max_length_sec: 5.0,
          motion_gate_enabled: motionGateEnabled.checked,
          motion_gate_min_active_ratio: Number(motionThreshold.value) / 100,
        },
      };
    const requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: cosmosController.signal,
      body: JSON.stringify(requestBody),
    };
    let response = await fetch("/v1/chat/completions", requestOptions);
    if (response.status === 422) {
      delete requestBody.chunking_options.motion_gate_enabled;
      delete requestBody.chunking_options.motion_gate_min_active_ratio;
      response = await fetch("/v1/chat/completions", { ...requestOptions, body: JSON.stringify(requestBody) });
    }
    if (!response.ok || !response.body) throw new Error(String(response.status));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (processCosmosSseBlock(block)) return;
      }
      if (done) break;
    }
  } catch (error) {
    if (error.name !== "AbortError") typeCosmosText(t("cosmosUnavailable"));
  }
}

function updateClock(advance = true) {
  const locale = language === "en" ? "en-US" : "zh-TW";
  clock.textContent = new Date().toLocaleTimeString(locale, { hour12: false });
  if (advance) seconds += 1;
  actionTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (!mappedSopDescriptionActive && lastCosmosUpdateAt && Date.now() - lastCosmosUpdateAt >= COSMOS_IDLE_AFTER_MS) {
    typeCosmosText(t(motionGateEnabled.checked ? "cosmosIdle" : "cosmosProcessing"));
  }
}

function setPreviewState(messageKey, statusKey) {
  previewMessageKey = messageKey;
  streamStatusKey = statusKey;
  previewStateText.textContent = t(messageKey);
  streamStatus.textContent = t(statusKey);
}

async function connectPreview() {
  try {
    const response = await fetch("/v1/rtsp-preview-sessions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: RTSP_URL }),
    });
    if (!response.ok) throw new Error(await response.text());
    const session = await response.json();
    previewSessionId = session.id;
    preview.onload = () => { frame.classList.add("ready"); setPreviewState("connectingCamera", "rtspConnected"); };
    preview.onerror = () => { frame.classList.remove("ready"); setPreviewState("cameraUnavailable", "rtspError"); };
    preview.src = `${session.preview_url}?t=${Date.now()}`;
  } catch (_error) {
    setPreviewState("cameraFailed", "rtspError");
  }
}

languageSelect.addEventListener("change", () => {
  language = languageSelect.value === "en" ? "en" : "zh-TW";
  localStorage.setItem(STORAGE_KEY, language);
  applyLanguage();
  void connectCosmosInference();
});

motionGateEnabled.addEventListener("change", () => {
  localStorage.setItem(MOTION_GATE_STORAGE_KEY, String(motionGateEnabled.checked));
  updateMotionControls();
  clearTimeout(cosmosReconnectTimer);
  cosmosReconnectTimer = setTimeout(() => void connectCosmosInference(), 200);
});

motionThreshold.addEventListener("input", () => {
  updateMotionControls();
  localStorage.setItem(MOTION_THRESHOLD_STORAGE_KEY, motionThreshold.value);
  clearTimeout(cosmosReconnectTimer);
  cosmosReconnectTimer = setTimeout(() => void connectCosmosInference(), 500);
});

async function initializeDemo() {
  updateMotionControls();
  applyLanguage();
  updateClock();
  setInterval(updateClock, 1000);
  void connectPreview();
  try {
    await loadLabelMappingConfig();
    void connectCosmosInference();
    void refreshDashboard();
    setInterval(refreshDashboard, 2000);
  } catch (error) {
    cosmosActionDescription.textContent = `Label mapping config error: ${error.message}`;
  }
}

void initializeDemo();

window.addEventListener("pagehide", () => {
  if (cosmosController) cosmosController.abort();
  if (previewSessionId) void fetch(`/v1/rtsp-preview-sessions/${previewSessionId}`, { method: "DELETE", keepalive: true });
});
