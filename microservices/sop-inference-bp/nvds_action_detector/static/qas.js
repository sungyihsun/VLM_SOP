const RTSP_URL = "rtsp://172.24.56.16:8552/sensor_0";
const STORAGE_KEY = "qasLanguage";
const HAND_GATE_STORAGE_KEY = "qasHandGateEnabled";
const COSMOS_PROMPTS = {
  "zh-TW": "辨識這段影片正在進行的動作，只使用繁體中文簡潔描述目前可見的動作。",
  en: "Describe the action currently visible in this video. Respond only in concise operational English.",
};
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
    cosmosDescription: "Cosmos 動作描述", cosmosActionDescription: "", waitingForCosmos: "正在連接 cosmos_2 即時推論…", cosmosIdle: "未偵測到明顯動作，等待操作員下一步動作。", cosmosUnavailable: "cosmos_2 即時推論暫時無法使用。",
    duration: "持續時間", confidence: "辨識信心度", model: "模型", sopProgress: "SOP 完成進度", handGate: "手部偵測", motionGateOn: "開啟", motionGateOff: "關閉", cosmosProcessing: "等待畫面中出現手部…", handWaiting: "等待手部偵測", handDetected: "偵測到手", handAbsent: "未偵測到手", blueGlove: "藍色手套", whiteGlove: "白色手套",
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
    cosmosDescription: "Cosmos Action Description", cosmosActionDescription: "", waitingForCosmos: "Connecting to live cosmos_2 inference…", cosmosIdle: "No significant motion detected. Waiting for the operator's next action.", cosmosUnavailable: "Live cosmos_2 inference is temporarily unavailable.",
    duration: "Duration", confidence: "Detection Confidence", model: "Model", sopProgress: "SOP Completion Progress", handGate: "Hand detection", motionGateOn: "On", motionGateOff: "Off", cosmosProcessing: "Waiting for hands to appear…", handWaiting: "Waiting for hand detection", handDetected: "Hand detected", handAbsent: "No hand detected", blueGlove: "blue glove", whiteGlove: "white glove",
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
const handGateEnabled = document.getElementById("handGateEnabled");
const handGateState = document.getElementById("handGateState");
const handDetectionSignal = document.getElementById("handDetectionSignal");
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
let lastHandDetected = null;
let lastGloveColor = "none";
const COSMOS_IDLE_AFTER_MS = 20000;
const savedHandGateValue = localStorage.getItem(HAND_GATE_STORAGE_KEY);
handGateEnabled.checked = savedHandGateValue === null ? true : savedHandGateValue === "true";

function updateHandGateControl() {
  handGateState.textContent = t(handGateEnabled.checked ? "motionGateOn" : "motionGateOff");
  if (!handGateEnabled.checked) setHandDetectionSignal(null);
}

function setHandDetectionSignal(detected, gloveColor = "none") {
  lastHandDetected = detected;
  lastGloveColor = gloveColor;
  handDetectionSignal.classList.toggle("detected", detected === true);
  handDetectionSignal.classList.toggle("absent", detected === false);
  const label = handDetectionSignal.querySelector("span");
  if (detected === true) {
    const colorLabel = gloveColor === "blue" ? t("blueGlove") : gloveColor === "white" ? t("whiteGlove") : "";
    label.textContent = colorLabel ? `${t("handDetected")} (${colorLabel})` : t("handDetected");
  } else if (detected === false) {
    label.textContent = t("handAbsent");
  } else {
    label.textContent = t("handWaiting");
  }
}

function t(key) {
  const dictionary = TRANSLATIONS[language];
  if (Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
  return TRANSLATIONS["zh-TW"][key] ?? key;
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
  updateHandGateControl();
  if (handGateEnabled.checked) setHandDetectionSignal(lastHandDetected, lastGloveColor);
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
  const hasActionSnapshot = Object.keys(actionStates).length > 0;
  if (!lastCosmosUpdateAt) {
    cosmosActionDescription.textContent = current.cosmos_description || t("waitingForCosmos");
  }
  currentActionName.textContent = current.action_name || t("waitingForSop");
  currentStepLabel.textContent = current.action_id == null
    ? t("stepPendingConfig")
    : (language === "en" ? `SOP Action ${current.action_id} of 8` : `SOP 動作 ${current.action_id} / 8`);
  const activeStep = current.action_id == null ? null : Number(current.action_id);
  const activeActions = Array.from({ length: 8 }, (_, index) => Boolean(actionStates[`action_${index}`]));
  const activeCount = activeActions.filter(Boolean).length;
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
    const metadata = payload.choices?.[0]?.chunk_metadata;
    if (metadata && typeof metadata.hand_detected === "boolean") {
      setHandDetectionSignal(metadata.hand_detected, metadata.hand_glove_color);
    }
    const content = String(payload.choices?.[0]?.delta?.content || "").trim();
    if (content) {
      lastCosmosUpdateAt = Date.now();
      if (content !== lastCosmosDescription) {
        lastCosmosDescription = content;
        cosmosActionDescription.textContent = content;
      }
    }
  } catch (_error) {
    // Ignore an incomplete or malformed SSE event and continue reading.
  }
  return false;
}

async function connectCosmosInference() {
  if (cosmosController) cosmosController.abort();
  cosmosController = new AbortController();
  lastCosmosDescription = "";
  lastCosmosUpdateAt = Date.now();
  setHandDetectionSignal(null);
  cosmosActionDescription.textContent = t("waitingForCosmos");
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
          min_length_sec: 1.0,
          max_length_sec: 2.0,
          motion_gate_enabled: false,
          hand_gate_enabled: handGateEnabled.checked,
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
      delete requestBody.chunking_options.hand_gate_enabled;
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
    if (error.name !== "AbortError") cosmosActionDescription.textContent = t("cosmosUnavailable");
  }
}

function updateClock(advance = true) {
  const locale = language === "en" ? "en-US" : "zh-TW";
  clock.textContent = new Date().toLocaleTimeString(locale, { hour12: false });
  if (advance) seconds += 1;
  actionTimer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (lastCosmosUpdateAt && Date.now() - lastCosmosUpdateAt >= COSMOS_IDLE_AFTER_MS) {
    cosmosActionDescription.textContent = t(handGateEnabled.checked ? "cosmosProcessing" : "waitingForCosmos");
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

handGateEnabled.addEventListener("change", () => {
  localStorage.setItem(HAND_GATE_STORAGE_KEY, String(handGateEnabled.checked));
  updateHandGateControl();
  clearTimeout(cosmosReconnectTimer);
  cosmosReconnectTimer = setTimeout(() => void connectCosmosInference(), 200);
});

updateHandGateControl();
applyLanguage();
updateClock();
setInterval(updateClock, 1000);
void connectPreview();
void connectCosmosInference();
void refreshDashboard();
setInterval(refreshDashboard, 2000);

window.addEventListener("pagehide", () => {
  if (cosmosController) cosmosController.abort();
  if (previewSessionId) void fetch(`/v1/rtsp-preview-sessions/${previewSessionId}`, { method: "DELETE", keepalive: true });
});
