const MICROBIT_UART_SERVICE = "e95d93af-251d-470a-a062-fa1922dfa9a8";
const MICROBIT_UART_RX = "e95d93b0-251d-470a-a062-fa1922dfa9a8";
const NORDIC_UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NORDIC_UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const MEDIAPIPE_VERSION = "0.10.35";
const MEDIAPIPE_WASM_URLS = [
  "./vendor/mediapipe/tasks-vision/wasm",
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
];
const FACE_LANDMARKER_MODEL_URLS = [
  "./vendor/mediapipe/models/face_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
];
const VISION_IMPORT_URLS = [
  "./vendor/mediapipe/tasks-vision/vision_bundle.mjs",
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`,
  `https://unpkg.com/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/+esm`
];

const metricConfig = [
  ["x", "X", 99],
  ["y", "Y", 99],
  ["z", "Distance", 99],
  ["yaw", "Yaw", 99],
  ["pitch", "Pitch", 99],
  ["mouth", "Mouth", 99],
  ["leftEye", "Right Eye", 99],
  ["rightEye", "Left Eye", 99],
  ["roll", "Roll", 9],
  ["smile", "Smile/Kiss", 9],
  ["visible", "Face Visible", 1]
];
const calibrationTargets = {
  x: 50,
  y: 50,
  z: 50,
  yaw: 50,
  pitch: 50,
  roll: 5,
  leftEye: 80,
  rightEye: 80,
  mouth: 0,
  smile: 5
};

const state = {
  faceLandmarker: null,
  FaceLandmarker: null,
  DrawingUtils: null,
  FilesetResolver: null,
  stream: null,
  drawingUtils: null,
  bluetoothDevice: null,
  rxCharacteristic: null,
  isCameraRunning: false,
  isSending: false,
  isMirrored: true,
  isFullscreenFallback: false,
  cameraFacingMode: "user",
  lastVideoTime: -1,
  lastSentAt: 0,
  calibration: null,
  rawValues: null,
  recentRawValues: [],
  values: {
    x: 50,
    y: 50,
    z: 50,
    yaw: 50,
    pitch: 50,
    mouth: 0,
    leftEye: 0,
    rightEye: 0,
    roll: 5,
    smile: 0,
    visible: 0
  }
};

const els = {
  video: document.querySelector("#camera"),
  canvas: document.querySelector("#overlay"),
  frame: document.querySelector(".video-frame"),
  emptyState: document.querySelector("#emptyState"),
  cameraButton: document.querySelector("#cameraButton"),
  switchCameraButton: document.querySelector("#switchCameraButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  connectButton: document.querySelector("#connectButton"),
  calibrateButton: document.querySelector("#calibrateButton"),
  metricsGrid: document.querySelector("#metricsGrid"),
  statusPill: document.querySelector("#statusPill"),
  supportNotice: document.querySelector("#supportNotice")
};

const ctx = els.canvas.getContext("2d");
const metricEls = new Map();
const encoder = new TextEncoder();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRange(value, min, max, outMax = 99) {
  const normalized = (value - min) / (max - min);
  return Math.round(clamp(normalized, 0, 1) * outMax);
}

function toUnclippedRange(value, min, max, outMax = 99) {
  const normalized = (value - min) / (max - min);
  return normalized * outMax;
}

function metricMax(key) {
  return key === "roll" || key === "smile" ? 9 : 99;
}

function clampOutputValues(values) {
  const output = { ...values };
  for (const [key] of metricConfig) {
    if (key === "visible") {
      output.visible = values.visible ? 1 : 0;
    } else {
      output[key] = clamp(Math.round(values[key]), 0, metricMax(key));
    }
  }
  return output;
}

function pad2(value) {
  return String(clamp(Math.round(value), 0, 99)).padStart(2, "0");
}

function getPoint(points, index) {
  return points[index];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function makePayload(values) {
  return [
    pad2(values.x),
    pad2(values.y),
    pad2(values.z),
    pad2(values.yaw),
    pad2(values.pitch),
    pad2(values.mouth),
    pad2(values.leftEye),
    pad2(values.rightEye),
    String(clamp(Math.round(values.roll), 0, 9)),
    String(clamp(Math.round(values.smile), 0, 9)),
    String(values.visible ? 1 : 0)
  ].join("");
}

function setStatus(text, tone = "") {
  els.statusPill.textContent = text;
  els.statusPill.className = `status-pill ${tone}`.trim();
}

function setNotice(message) {
  els.supportNotice.hidden = !message;
  els.supportNotice.textContent = message || "";
}

function buildMetricGrid() {
  els.metricsGrid.innerHTML = "";
  for (const [key, label, max] of metricConfig) {
    const row = document.createElement("div");
    row.className = "metric";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;

    const meter = document.createElement("div");
    meter.className = "meter";
    const bar = document.createElement("span");
    meter.append(bar);

    const output = document.createElement("output");
    output.textContent = "0";

    row.append(labelEl, meter, output);
    els.metricsGrid.append(row);
    metricEls.set(key, { bar, output, max });
  }
}

function updateMetrics(values) {
  for (const [key, entry] of metricEls) {
    const value = values[key];
    entry.output.textContent = String(value);
    entry.bar.style.width = `${(value / entry.max) * 100}%`;
  }
}

function normalizeValues(raw) {
  if (!state.calibration) {
    return clampOutputValues(raw);
  }

  const normalized = { ...raw };
  for (const [key, target] of Object.entries(calibrationTargets)) {
    normalized[key] = target + raw[key] - state.calibration[key];
  }
  return clampOutputValues(normalized);
}

function rememberRawValues(raw) {
  state.rawValues = raw;
  state.recentRawValues.push(raw);
  if (state.recentRawValues.length > 12) {
    state.recentRawValues.shift();
  }
}

function averageValues(values) {
  const keys = Object.keys(calibrationTargets);
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));

  for (const value of values) {
    for (const key of keys) {
      totals[key] += value[key];
    }
  }

  return Object.fromEntries(
    keys.map((key) => [key, totals[key] / values.length])
  );
}

function getMatrixData(matrix) {
  if (!matrix) {
    return null;
  }
  const data = matrix.data || matrix.matrix || matrix.packedData;
  if (!data || data.length < 16) {
    return null;
  }
  return Array.from(data);
}

function getHeadRotation(matrix) {
  const m = getMatrixData(matrix);
  if (!m) {
    return null;
  }

  const r00 = m[0];
  const r10 = m[4];
  const r20 = m[8];
  const r21 = m[9];
  const r22 = m[10];
  const radToDeg = 180 / Math.PI;

  return {
    yaw: Math.atan2(-r20, Math.hypot(r00, r10)) * radToDeg,
    pitch: Math.atan2(r21, r22) * radToDeg,
    roll: Math.atan2(r10, r00) * radToDeg
  };
}
function calculateFaceValues(face) {
  const points = face.faceLandmarks;
  const box = points.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y)
    }),
    { minX: 1, maxX: 0, minY: 1, maxY: 0 }
  );

  const leftEyeOuter = getPoint(points, 33);
  const leftEyeInner = getPoint(points, 133);
  const leftEyeTop = getPoint(points, 159);
  const leftEyeBottom = getPoint(points, 145);
  const rightEyeInner = getPoint(points, 362);
  const rightEyeOuter = getPoint(points, 263);
  const rightEyeTop = getPoint(points, 386);
  const rightEyeBottom = getPoint(points, 374);
  const mouthLeft = getPoint(points, 61);
  const mouthRight = getPoint(points, 291);
  const mouthTop = getPoint(points, 13);
  const mouthBottom = getPoint(points, 14);
  const noseTip = getPoint(points, 1);
  const chin = getPoint(points, 152);

  const faceWidth = Math.max(0.001, box.maxX - box.minX);
  const faceHeight = Math.max(0.001, box.maxY - box.minY);
  const faceCenterX = (box.minX + box.maxX) / 2;
  const faceCenterY = (box.minY + box.maxY) / 2;
  const eyeCenterX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const eyeCenterY = (leftEyeOuter.y + rightEyeOuter.y) / 2;
  const eyeDx = rightEyeOuter.x - leftEyeOuter.x;
  const eyeDy = rightEyeOuter.y - leftEyeOuter.y;
  const rollDegrees = Math.atan2(eyeDy, eyeDx) * (180 / Math.PI);
  const mouthWidth = distance(mouthLeft, mouthRight);
  const mouthOpen = distance(mouthTop, mouthBottom) / mouthWidth;
  const leftEyeOpen = distance(leftEyeTop, leftEyeBottom) / distance(leftEyeOuter, leftEyeInner);
  const rightEyeOpen = distance(rightEyeTop, rightEyeBottom) / distance(rightEyeInner, rightEyeOuter);
  const noseOffsetX = (noseTip.x - eyeCenterX) / faceWidth;
  const noseOffsetY = (noseTip.y - eyeCenterY) / faceHeight;
  const smileSignal = (mouthWidth / faceWidth - 0.32) * 35;
  const headRotation = getHeadRotation(face.matrix);

  const raw = {
    x: toRange(state.isMirrored ? 1 - faceCenterX : faceCenterX, 0.08, 0.92),
    y: toRange(faceCenterY, 0.12, 0.88),
    z: toRange(faceWidth, 0.16, 0.58),
    yaw: headRotation ? toRange(headRotation.yaw, -35, 35) : toRange(noseOffsetX, -0.13, 0.13),
    pitch: headRotation ? toRange(headRotation.pitch, -30, 30) : toRange(noseOffsetY + (chin.y - noseTip.y) * 0.12, 0.2, 0.5),
    mouth: toRange(mouthOpen, 0.015, 0.36),
    leftEye: toUnclippedRange(leftEyeOpen, 0.02, 0.34),
    rightEye: toUnclippedRange(rightEyeOpen, 0.02, 0.34),
    roll: headRotation ? toRange(headRotation.roll, -35, 35, 9) : toRange(rollDegrees, -28, 28, 9),
    smile: smileSignal,
    visible: 1
  };

  rememberRawValues(raw);
  return normalizeValues(raw);
}

function resizeCanvas() {
  const rect = els.frame.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.canvas.width = Math.round(rect.width * dpr);
  els.canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function scheduleCanvasResize() {
  resizeCanvas();
  requestAnimationFrame(resizeCanvas);
  setTimeout(resizeCanvas, 250);
}

function getVideoProjection() {
  const rect = els.frame.getBoundingClientRect();
  const videoWidth = els.video.videoWidth || rect.width;
  const videoHeight = els.video.videoHeight || rect.height;
  const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;

  return {
    offsetX: (rect.width - width) / 2,
    offsetY: (rect.height - height) / 2,
    width,
    height
  };
}

function projectLandmark(point, projection) {
  return {
    x: projection.offsetX + point.x * projection.width,
    y: projection.offsetY + point.y * projection.height
  };
}

function drawConnectorSet(points, connectors, color, lineWidth) {
  if (!connectors?.length) {
    return;
  }

  const projection = getVideoProjection();
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  for (const connector of connectors) {
    const startIndex = connector.start ?? connector[0];
    const endIndex = connector.end ?? connector[1];
    const start = points[startIndex];
    const end = points[endIndex];
    if (!start || !end) {
      continue;
    }
    const projectedStart = projectLandmark(start, projection);
    const projectedEnd = projectLandmark(end, projection);
    ctx.moveTo(projectedStart.x, projectedStart.y);
    ctx.lineTo(projectedEnd.x, projectedEnd.y);
  }

  ctx.stroke();
  ctx.restore();
}

function drawFace(result) {
  const rect = els.frame.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!result.faceLandmarks?.length || !state.FaceLandmarker) {
    return;
  }

  const landmarks = result.faceLandmarks[0];
  drawConnectorSet(landmarks, state.FaceLandmarker.FACE_LANDMARKS_TESSELATION, "rgba(255,255,255,0.32)", 1);
  drawConnectorSet(landmarks, state.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, "rgba(255,255,255,0.94)", 4);
  drawConnectorSet(landmarks, state.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, "#ffd166", 4);
  drawConnectorSet(landmarks, state.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, "#f8c03a", 4);
  drawConnectorSet(landmarks, state.FaceLandmarker.FACE_LANDMARKS_LIPS, "#f06d2f", 4);
}

async function maybeSendValues(values) {
  const payload = makePayload(values);
  const now = performance.now();
  if (!state.isSending || !state.rxCharacteristic || now - state.lastSentAt < 100) {
    return;
  }

  try {
    const data = encoder.encode(`${payload}\n`);
    if (state.rxCharacteristic.writeValueWithoutResponse) {
      await state.rxCharacteristic.writeValueWithoutResponse(data);
    } else if (state.rxCharacteristic.writeValueWithResponse) {
      await state.rxCharacteristic.writeValueWithResponse(data);
    } else {
      await state.rxCharacteristic.writeValue(data);
    }
    state.lastSentAt = now;
  } catch (error) {
    state.isSending = false;
    setStatus("Send error", "is-warn");
    setNotice(`Bluetooth write failed: ${error.message}`);
  }
}

async function predictLoop() {
  if (!state.isCameraRunning) {
    return;
  }

  if (els.video.currentTime !== state.lastVideoTime && state.faceLandmarker) {
    state.lastVideoTime = els.video.currentTime;
    const result = state.faceLandmarker.detectForVideo(els.video, performance.now());
    drawFace(result);

    if (result.faceLandmarks?.length) {
      state.values = calculateFaceValues({
        faceLandmarks: result.faceLandmarks[0],
        matrix: result.facialTransformationMatrixes?.[0]
      });
      setStatus(state.rxCharacteristic ? "Sending" : "Tracking", state.rxCharacteristic ? "is-good" : "");
      els.calibrateButton.disabled = false;
    } else {
      state.values = { ...state.values, visible: 0 };
      state.rawValues = null;
      state.recentRawValues = [];
      setStatus("No face", "is-warn");
    }

    updateMetrics(state.values);
    await maybeSendValues(state.values);
  }

  requestAnimationFrame(predictLoop);
}

async function loadFaceLandmarker() {
  if (state.faceLandmarker) {
    return;
  }

  setStatus("Loading", "is-warn");
  if (!state.FilesetResolver) {
    const vision = await loadVisionTasks();
    state.DrawingUtils = vision.DrawingUtils;
    state.FaceLandmarker = vision.FaceLandmarker;
    state.FilesetResolver = vision.FilesetResolver;
  }

  state.faceLandmarker = await loadLandmarkerModel();
  state.drawingUtils = new state.DrawingUtils(ctx);
}

async function loadVisionTasks() {
  const failures = [];

  for (const url of VISION_IMPORT_URLS) {
    try {
      const module = await import(url);
      const vision = module.default || module;
      if (vision.FaceLandmarker && vision.FilesetResolver && vision.DrawingUtils) {
        return vision;
      }
      failures.push(`${url}: missing exports`);
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }

  throw new Error(`MediaPipe import failed. Tried ${failures.join(" | ")}`);
}

async function loadLandmarkerModel() {
  const failures = [];

  for (const wasmUrl of MEDIAPIPE_WASM_URLS) {
    try {
      const resolver = await state.FilesetResolver.forVisionTasks(wasmUrl);
      return await createFaceLandmarker(resolver);
    } catch (error) {
      failures.push(`${wasmUrl}: ${error.message}`);
    }
  }

  throw new Error(`MediaPipe WASM/model load failed. Tried ${failures.join(" | ")}`);
}

async function createFaceLandmarker(resolver) {
  const failures = [];

  for (const modelAssetPath of FACE_LANDMARKER_MODEL_URLS) {
    const options = {
      baseOptions: {
        modelAssetPath,
        delegate: "GPU"
      },
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1
    };

    try {
      return await state.FaceLandmarker.createFromOptions(resolver, options);
    } catch (gpuError) {
      failures.push(`${modelAssetPath} GPU: ${gpuError.message}`);
      options.baseOptions.delegate = "CPU";
      try {
        return await state.FaceLandmarker.createFromOptions(resolver, options);
      } catch (cpuError) {
        failures.push(`${modelAssetPath} CPU: ${cpuError.message}`);
      }
    }
  }

  throw new Error(`Face landmarker model failed. Tried ${failures.join(" | ")}`);
}

async function startCamera() {
  resizeCanvas();

  state.stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: state.cameraFacingMode },
      width: { ideal: 1280 },
      height: { ideal: 960 }
    },
    audio: false
  });

  els.video.srcObject = state.stream;
  await els.video.play();
  resizeCanvas();
  state.isCameraRunning = true;
  els.emptyState.hidden = true;
  els.cameraButton.classList.remove("is-camera-off");
  els.cameraButton.title = "Active";
  els.cameraButton.setAttribute("aria-label", "Active");
  els.cameraButton.dataset.fullscreenLabel = "Active";
  els.switchCameraButton.disabled = false;
  setStatus("Loading", "is-warn");

  try {
    await loadFaceLandmarker();
    setStatus("Tracking");
    predictLoop();
  } catch (error) {
    setStatus("Camera only", "is-warn");
    setNotice(`Camera started, but the face mesh model could not load: ${error.message}`);
  }
}

function stopCamera() {
  state.isCameraRunning = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  els.video.srcObject = null;
  els.emptyState.hidden = false;
  els.cameraButton.classList.add("is-camera-off");
  els.cameraButton.title = "Start camera";
  els.cameraButton.setAttribute("aria-label", "Start camera");
  els.cameraButton.dataset.fullscreenLabel = "Start";
  els.calibrateButton.disabled = true;
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  setStatus(state.rxCharacteristic ? "Ready" : "Idle");
}

async function toggleCamera() {
  try {
    if (state.isCameraRunning) {
      stopCamera();
    } else {
      await startCamera();
    }
  } catch (error) {
    setStatus("Camera error", "is-warn");
    setNotice(`Camera could not start: ${error.message}`);
  }
}

async function switchCamera() {
  state.cameraFacingMode = state.cameraFacingMode === "user" ? "environment" : "user";
  state.isMirrored = state.cameraFacingMode === "user";
  updateMirror();

  if (!state.isCameraRunning) {
    return;
  }

  stopCamera();
  try {
    await startCamera();
  } catch (error) {
    state.cameraFacingMode = state.cameraFacingMode === "user" ? "environment" : "user";
    state.isMirrored = state.cameraFacingMode === "user";
    updateMirror();
    setStatus("Camera error", "is-warn");
    setNotice(`Camera could not switch: ${error.message}`);
  }
}

async function findWritableCharacteristic(server) {
  const candidates = [
    [MICROBIT_UART_SERVICE, MICROBIT_UART_RX],
    [NORDIC_UART_SERVICE, NORDIC_UART_RX]
  ];

  for (const [serviceUuid, characteristicUuid] of candidates) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      return service.getCharacteristic(characteristicUuid);
    } catch {
      continue;
    }
  }

  throw new Error("UART service not found on this device.");
}

async function connectMicrobit() {
  if (!navigator.bluetooth) {
    setNotice("Bluetooth is not available in this browser. Chrome or Edge on laptop/Android can connect directly. On iPhone, use camera tracking here and connect through a laptop relay or an iOS Web Bluetooth browser such as Bluefy/WebBLE if it exposes navigator.bluetooth.");
    setStatus("No Bluetooth", "is-warn");
    return;
  }

  try {
    setStatus("Pairing", "is-warn");
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "BBC micro:bit" },
        { namePrefix: "micro:bit" },
        { services: [MICROBIT_UART_SERVICE] },
        { services: [NORDIC_UART_SERVICE] }
      ],
      optionalServices: [MICROBIT_UART_SERVICE, NORDIC_UART_SERVICE]
    });

    device.addEventListener("gattserverdisconnected", () => {
      state.rxCharacteristic = null;
      state.bluetoothDevice = null;
      state.isSending = false;
      els.connectButton.innerHTML = '<span class="icon-bluetooth" aria-hidden="true"></span>Connect';
      setStatus("Disconnected", "is-warn");
    });

    const server = await device.gatt.connect();
    state.bluetoothDevice = device;
    state.rxCharacteristic = await findWritableCharacteristic(server);
    state.isSending = true;
    els.connectButton.innerHTML = '<span class="icon-bluetooth" aria-hidden="true"></span>Disconnect';
    setStatus("Sending", "is-good");
    setNotice("");
  } catch (error) {
    setStatus("Pair failed", "is-warn");
    setNotice(`Bluetooth connection failed: ${error.message}`);
  }
}

function disconnectMicrobit() {
  state.isSending = false;
  state.rxCharacteristic = null;
  if (state.bluetoothDevice?.gatt?.connected) {
    state.bluetoothDevice.gatt.disconnect();
  }
  state.bluetoothDevice = null;
  els.connectButton.innerHTML = '<span class="icon-bluetooth" aria-hidden="true"></span>Connect';
  setStatus(state.isCameraRunning ? "Tracking" : "Idle");
}

function calibrate() {
  const samples = state.recentRawValues.filter(Boolean);
  if (!state.values.visible || !samples.length) {
    setNotice("Keep your face visible before calibrating.");
    return;
  }

  state.calibration = averageValues(samples);
  state.values = normalizeValues(state.rawValues);
  updateMetrics(state.values);
  setNotice("Neutral face saved. Eyes start at 80, smile/kiss starts at 5, mouth starts at 0, and position/rotation are centered.");
}

function updateMirror() {
  els.frame.classList.toggle("is-mirrored", state.isMirrored);
}

async function toggleFullscreen() {
  const isFullscreen = Boolean(document.fullscreenElement) || state.isFullscreenFallback;
  try {
    if (isFullscreen) {
      state.isFullscreenFallback = false;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      updateFullscreenButton();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    state.isFullscreenFallback = !state.isFullscreenFallback;
    updateFullscreenButton();
  }
}

function updateFullscreenButton() {
  const isFullscreen = Boolean(document.fullscreenElement) || state.isFullscreenFallback;
  document.body.classList.toggle("is-fullscreen-mode", isFullscreen);
  els.fullscreenButton.classList.toggle("is-active", isFullscreen);
  els.fullscreenButton.title = isFullscreen ? "Close full-screen" : "Full-screen";
  els.fullscreenButton.setAttribute("aria-label", isFullscreen ? "Close full-screen" : "Full-screen");
  els.fullscreenButton.dataset.fullscreenLabel = isFullscreen ? "Close full-screen" : "Full-screen";
  scheduleCanvasResize();
}

function initSupportNotice() {
  const messages = [];
  if (location.protocol === "file:") {
    messages.push("This app needs to be opened from localhost or HTTPS. Use Start Face Tracking App.bat instead of double-clicking index.html.");
  }
  if (!window.isSecureContext) {
    messages.push("Camera and Bluetooth need a secure browser context such as localhost or HTTPS.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    messages.push("Camera access is not available in this browser.");
  }
  if (!navigator.bluetooth) {
    messages.push("Direct Micro:Bit Bluetooth is unavailable here. Tracking can still run, but Bluetooth needs Chrome/Edge on desktop/Android, a compatible iOS Web Bluetooth browser, or a small relay device.");
  }
  setNotice(messages.join(" "));
}

function bindEvents() {
  els.cameraButton.addEventListener("click", toggleCamera);
  els.switchCameraButton.addEventListener("click", switchCamera);
  els.connectButton.addEventListener("click", () => {
    if (state.rxCharacteristic) {
      disconnectMicrobit();
    } else {
      connectMicrobit();
    }
  });
  els.calibrateButton.addEventListener("click", calibrate);
  els.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    state.isFullscreenFallback = false;
    updateFullscreenButton();
  });
  window.addEventListener("resize", scheduleCanvasResize);
  window.addEventListener("orientationchange", scheduleCanvasResize);
  window.visualViewport?.addEventListener("resize", scheduleCanvasResize);
}

async function autoStartCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }

  try {
    await startCamera();
  } catch (error) {
    setStatus("Camera paused", "is-warn");
    setNotice(`Camera did not start automatically: ${error.message}`);
  }
}

buildMetricGrid();
updateMetrics(state.values);
updateMirror();
initSupportNotice();
bindEvents();
autoStartCamera();
