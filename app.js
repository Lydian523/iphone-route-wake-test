'use strict';

const els = {
  gpxInput: document.getElementById('gpxInput'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  wakeBtn: document.getElementById('wakeBtn'),
  blackBtn: document.getElementById('blackBtn'),
  testSoundBtn: document.getElementById('testSoundBtn'),
  soundMode: document.getElementById('soundMode'),
  gpsQuality: document.getElementById('gpsQuality'),
  gpsExplain: document.getElementById('gpsExplain'),
  fixAge: document.getElementById('fixAge'),
  speed: document.getElementById('speed'),
  accuracy: document.getElementById('accuracy'),
  distance: document.getElementById('distance'),
  status: document.getElementById('status'),
  wakeStatus: document.getElementById('wakeStatus'),
  pointCount: document.getElementById('pointCount'),
  fixCount: document.getElementById('fixCount'),
  log: document.getElementById('log'),
  canvas: document.getElementById('routeCanvas'),
  warnM: document.getElementById('warnM'),
  offM: document.getElementById('offM'),
  badM: document.getElementById('badM'),
  blackScreen: document.getElementById('blackScreen'),
  blackGps: document.getElementById('blackGps'),
  blackStatus: document.getElementById('blackStatus'),
  blackDistance: document.getElementById('blackDistance'),
  holdRing: document.getElementById('holdRing'),
  copyLogBtn: document.getElementById('copyLogBtn'),
  clearLogBtn: document.getElementById('clearLogBtn'),
};

let route = [];
let currentPos = null;
let watchId = null;
let wakeLock = null;
let fixCount = 0;
let lastAlertLevel = 'normal';
let lastAlertAt = 0;
let audioCtx = null;
let holdTimer = null;
let holdStart = 0;
let holdAnim = null;
let lastFixTime = 0;
let ageTimer = null;

const ctx = els.canvas.getContext('2d');

function log(msg) {
  const t = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  els.log.textContent = `[${t}] ${msg}\n` + els.log.textContent;
}

function setStatus(text, cls = '') {
  els.status.textContent = text;
  els.status.className = cls;
  els.blackStatus.textContent = text;
}


function classifyGpsQuality(acc, ageMs) {
  if (!Number.isFinite(acc)) {
    return { level: 'unknown', label: '未知', cls: 'status-muted', reliable: false, allowLoudAlert: false, text: 'GPS 尚未回報精度，偏離判斷暫不可靠。' };
  }
  if (ageMs > 30000) {
    return { level: 'stale', label: '過舊', cls: 'status-danger', reliable: false, allowLoudAlert: false, text: `定位已經 ${Math.round(ageMs / 1000)} 秒沒有更新，暫停偏離警報。` };
  }
  if (acc <= 15) {
    return { level: 'good', label: '良好', cls: 'status-ok', reliable: true, allowLoudAlert: true, text: `GPS 良好，精度約 ±${Math.round(acc)} 公尺，可正常判斷偏離。` };
  }
  if (acc <= 35) {
    return { level: 'ok', label: '普通', cls: 'status-warn', reliable: true, allowLoudAlert: false, text: `GPS 普通，精度約 ±${Math.round(acc)} 公尺；偏離提醒僅供參考。` };
  }
  if (acc <= 80) {
    return { level: 'poor', label: '差', cls: 'status-danger', reliable: false, allowLoudAlert: false, text: `GPS 偏差大，精度約 ±${Math.round(acc)} 公尺；可能誤報，暫停大聲偏離警報。` };
  }
  return { level: 'bad', label: '很差', cls: 'status-danger', reliable: false, allowLoudAlert: false, text: `GPS 很差，精度約 ±${Math.round(acc)} 公尺；停止偏離判斷，先到開闊處再測。` };
}

function updateGpsPanel(acc, ageMs, speedMps) {
  const q = classifyGpsQuality(acc, ageMs);
  els.gpsQuality.textContent = q.label;
  els.gpsQuality.className = q.cls;
  els.fixAge.textContent = lastFixTime ? `${Math.round(ageMs / 1000)} 秒前` : '—';
  els.speed.textContent = Number.isFinite(speedMps) ? `${(speedMps * 3.6).toFixed(1)} km/h` : '—';
  els.gpsExplain.textContent = q.text;
  els.blackGps.textContent = `GPS：${q.label}${Number.isFinite(acc) ? ` ±${Math.round(acc)}m` : ''}`;
  return q;
}

function startAgeTimer() {
  if (ageTimer) clearInterval(ageTimer);
  ageTimer = setInterval(() => {
    if (!lastFixTime) return;
    const ageMs = Date.now() - lastFixTime;
    const accText = els.accuracy.textContent.replace(/[^0-9.]/g, '');
    const acc = accText ? Number(accText) : NaN;
    updateGpsPanel(acc, ageMs, NaN);
    if (ageMs > 30000) setStatus('定位過舊', 'status-danger');
  }, 5000);
}

function metersText(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${Math.round(n)} m`;
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('GPX 解析失敗');

  const pts = [];
  const selectors = ['trkpt', 'rtept'];
  for (const sel of selectors) {
    doc.querySelectorAll(sel).forEach(node => {
      const lat = Number(node.getAttribute('lat'));
      const lon = Number(node.getAttribute('lon'));
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
    });
    if (pts.length > 1) break;
  }

  if (pts.length < 2) {
    throw new Error('GPX 內找不到足夠的 trkpt 或 rtept 路線點');
  }
  return simplifyEveryN(pts, Math.ceil(pts.length / 3000));
}


function parseKmlCoordinatesText(text) {
  const pts = [];
  text.trim().split(/\s+/).forEach(token => {
    const parts = token.split(',').map(Number);
    const lon = parts[0];
    const lat = parts[1];
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
  });
  return pts;
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('KML 解析失敗');

  let pts = [];

  // 優先讀取 LineString；這才是路線線段。Point 通常只是景點，不適合拿來當偏離路線。
  const lineStrings = Array.from(doc.getElementsByTagName('LineString'));
  for (const line of lineStrings) {
    const coordsNode = line.getElementsByTagName('coordinates')[0];
    if (!coordsNode) continue;
    const linePts = parseKmlCoordinatesText(coordsNode.textContent || '');
    if (linePts.length >= 2) {
      if (pts.length && linePts.length) {
        const last = pts[pts.length - 1];
        const first = linePts[0];
        if (last.lat !== first.lat || last.lon !== first.lon) pts.push(first);
        pts.push(...linePts.slice(1));
      } else {
        pts.push(...linePts);
      }
    }
  }

  // Google Earth 有時使用 gx:Track，以 <gx:coord>lon lat alt</gx:coord> 儲存軌跡。
  if (pts.length < 2) {
    const coordNodes = Array.from(doc.getElementsByTagName('gx:coord'));
    coordNodes.forEach(node => {
      const parts = (node.textContent || '').trim().split(/\s+/).map(Number);
      const lon = parts[0];
      const lat = parts[1];
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
    });
  }

  if (pts.length < 2) {
    throw new Error('KML 內找不到足夠的 LineString 路線點。請確認匯出的是路線，不只是景點標記。');
  }
  return simplifyEveryN(pts, Math.ceil(pts.length / 3000));
}

function parseRouteFile(text, fileName = '') {
  const name = fileName.toLowerCase();
  const head = text.slice(0, 300).toLowerCase();
  if (name.endsWith('.kml') || head.includes('<kml')) return parseKml(text);
  if (name.endsWith('.gpx') || head.includes('<gpx')) return parseGpx(text);
  throw new Error('不支援的檔案格式。請匯入 .gpx 或 .kml。');
}

function simplifyEveryN(points, n) {
  if (n <= 1) return points;
  const out = [];
  for (let i = 0; i < points.length; i += n) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

function toRad(deg) { return deg * Math.PI / 180; }

function equirectProject(p, originLat) {
  const R = 6371000;
  return {
    x: toRad(p.lon) * R * Math.cos(toRad(originLat)),
    y: toRad(p.lat) * R,
  };
}

function distancePointToSegmentMeters(p, a, b) {
  const originLat = p.lat;
  const pp = equirectProject(p, originLat);
  const aa = equirectProject(a, originLat);
  const bb = equirectProject(b, originLat);
  const vx = bb.x - aa.x;
  const vy = bb.y - aa.y;
  const wx = pp.x - aa.x;
  const wy = pp.y - aa.y;
  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;
  let t = c2 === 0 ? 0 : c1 / c2;
  t = Math.max(0, Math.min(1, t));
  const cx = aa.x + t * vx;
  const cy = aa.y + t * vy;
  return Math.hypot(pp.x - cx, pp.y - cy);
}

function nearestDistanceToRouteMeters(p, pts) {
  if (!pts || pts.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distancePointToSegmentMeters(p, pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function evaluateDistance(d) {
  const warn = Number(els.warnM.value) || 30;
  const off = Number(els.offM.value) || 50;
  const bad = Number(els.badM.value) || 80;
  if (!Number.isFinite(d)) return { level: 'no-route', text: '未匯入路線', cls: '' };
  if (d >= bad) return { level: 'bad', text: '嚴重偏離', cls: 'status-danger' };
  if (d >= off) return { level: 'off', text: '偏離路線', cls: 'status-danger' };
  if (d >= warn) return { level: 'warn', text: '注意偏離', cls: 'status-warn' };
  return { level: 'normal', text: '正常', cls: 'status-ok' };
}

function maybeAlert(state, d, gpsQ = null) {
  const now = Date.now();
  const levelChanged = state.level !== lastAlertLevel;
  const repeatDue = now - lastAlertAt > 30000;
  const canAlert = !gpsQ || gpsQ.allowLoudAlert || (gpsQ.level === 'ok' && state.level === 'bad');
  if (['warn', 'off', 'bad'].includes(state.level) && canAlert && (levelChanged || repeatDue)) {
    lastAlertLevel = state.level;
    lastAlertAt = now;
    const gpsTail = gpsQ ? `，GPS ${gpsQ.label}` : '';
    const msg = `${state.text}，距離路線 ${Math.round(d)} 公尺${gpsTail}`;
    playAlert(msg, state.level);
    log(`提醒：${msg}`);
  }
  if (state.level === 'normal') lastAlertLevel = 'normal';
}

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep(level = 'warn') {
  const ac = getAudioCtx();
  const count = level === 'bad' ? 4 : level === 'off' ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = level === 'bad' ? 1200 : 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ac.destination);
    const start = ac.currentTime + i * 0.28;
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    osc.start(start);
    osc.stop(start + 0.2);
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW';
  u.rate = 1;
  u.volume = 1;
  window.speechSynthesis.speak(u);
}

function playAlert(text, level = 'warn') {
  const mode = els.soundMode.value;
  try {
    if (mode === 'beep' || mode === 'both') beep(level);
    if (mode === 'voice' || mode === 'both') speak(text);
  } catch (err) {
    log(`聲音播放失敗：${err.message}`);
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    els.wakeStatus.textContent = '不支援';
    log('此瀏覽器不支援 Screen Wake Lock');
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    els.wakeStatus.textContent = '已啟用';
    log('Wake Lock 已啟用');
    wakeLock.addEventListener('release', () => {
      els.wakeStatus.textContent = '已釋放';
      log('Wake Lock 已釋放');
    });
  } catch (err) {
    els.wakeStatus.textContent = '失敗';
    log(`Wake Lock 啟用失敗：${err.name} ${err.message}`);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && els.wakeStatus.textContent !== '未啟用') {
    await requestWakeLock();
  }
});

function startTracking() {
  if (!('geolocation' in navigator)) {
    log('此瀏覽器不支援 geolocation');
    return;
  }
  startAgeTimer();
  watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  });
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  setStatus('等待 GPS');
  log('開始定位');
}

function stopTracking() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  setStatus('已停止');
  if (ageTimer) clearInterval(ageTimer);
  ageTimer = null;
  log('停止定位');
}

function onGeoError(err) {
  log(`定位錯誤：${err.code} ${err.message}`);
  setStatus('定位錯誤', 'status-danger');
}

function onPosition(pos) {
  fixCount += 1;
  lastFixTime = Date.now();
  currentPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  const acc = pos.coords.accuracy;
  const speedMps = pos.coords.speed;
  const gpsQ = updateGpsPanel(acc, 0, speedMps);
  els.accuracy.textContent = `${Math.round(acc)} m`;
  els.fixCount.textContent = String(fixCount);

  const d = route.length >= 2 ? nearestDistanceToRouteMeters(currentPos, route) : Infinity;
  els.distance.textContent = metersText(d);
  els.blackDistance.textContent = `距離路線：${metersText(d)}`;
  const state = evaluateDistance(d);
  if (!gpsQ.reliable && route.length >= 2) {
    setStatus('GPS 不可靠，暫不警報', 'status-danger');
  } else if (gpsQ.level === 'ok' && ['warn', 'off', 'bad'].includes(state.level)) {
    setStatus(`${state.text}，但 GPS 普通`, 'status-warn');
  } else {
    setStatus(state.text, state.cls);
  }
  maybeAlert(state, d, gpsQ);
  draw();

  if (fixCount === 1) log(`首次定位：GPS ${gpsQ.label}，精度 ${Math.round(acc)} m`);
  if (fixCount % 10 === 0) log(`定位 ${fixCount} 次，GPS ${gpsQ.label}，精度 ${Math.round(acc)} m，距離路線 ${metersText(d)}`);
}

function routeBounds(points) {
  const all = points.slice();
  if (currentPos) all.push(currentPos);
  if (!all.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of all) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
  }
  return { minLat, maxLat, minLon, maxLon };
}

function draw() {
  const w = els.canvas.width;
  const h = els.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  const b = routeBounds(route);
  if (!b) {
    ctx.fillStyle = '#777';
    ctx.font = '28px sans-serif';
    ctx.fillText('請先匯入 GPX / KML', 40, 80);
    return;
  }
  const pad = 30;
  const latSpan = Math.max(0.00001, b.maxLat - b.minLat);
  const lonSpan = Math.max(0.00001, b.maxLon - b.minLon);
  const project = p => ({
    x: pad + ((p.lon - b.minLon) / lonSpan) * (w - pad * 2),
    y: h - pad - ((p.lat - b.minLat) / latSpan) * (h - pad * 2),
  });

  if (route.length >= 2) {
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 4;
    ctx.beginPath();
    route.forEach((p, i) => {
      const q = project(p);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
  }

  if (currentPos) {
    const q = project(currentPos);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(q.x, q.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

els.gpxInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    route = parseRouteFile(text, file.name);
    els.pointCount.textContent = String(route.length);
    log(`路線匯入成功：${file.name}，路線點 ${route.length}`);
    draw();
  } catch (err) {
    log(`路線匯入失敗：${err.message}`);
    alert(`${err.message}\n\n若你剛剛已經上傳新版，這個錯誤仍顯示 GPX 而不是 KML，通常是 iPhone 還在跑舊版快取。請刪除主畫面圖示後重新加入，或等 GitHub Pages 更新。`);
  }
});

els.startBtn.addEventListener('click', startTracking);
els.stopBtn.addEventListener('click', stopTracking);
els.wakeBtn.addEventListener('click', requestWakeLock);
els.blackBtn.addEventListener('click', () => els.blackScreen.classList.remove('hidden'));
els.testSoundBtn.addEventListener('click', () => playAlert('聲音測試，請確認口袋或耳機聽得到', 'off'));
els.copyLogBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.log.textContent).catch(() => {});
  log('已嘗試複製紀錄');
});
els.clearLogBtn.addEventListener('click', () => { els.log.textContent = ''; });

function beginHold() {
  holdStart = Date.now();
  els.holdRing.style.borderColor = '#fff';
  holdTimer = setTimeout(() => {
    endHold(true);
    els.blackScreen.classList.add('hidden');
  }, 3000);
  const tick = () => {
    const pct = Math.min(1, (Date.now() - holdStart) / 3000);
    els.holdRing.style.transform = `scale(${1 + pct * 0.5})`;
    els.holdRing.style.opacity = String(0.5 + pct * 0.5);
    holdAnim = requestAnimationFrame(tick);
  };
  tick();
}

function endHold(done = false) {
  clearTimeout(holdTimer);
  cancelAnimationFrame(holdAnim);
  holdTimer = null;
  els.holdRing.style.transform = 'scale(1)';
  els.holdRing.style.opacity = '1';
  els.holdRing.style.borderColor = done ? '#7bd88f' : '#555';
}

els.blackScreen.addEventListener('touchstart', beginHold, { passive: true });
els.blackScreen.addEventListener('touchend', () => endHold(false), { passive: true });
els.blackScreen.addEventListener('touchcancel', () => endHold(false), { passive: true });
els.blackScreen.addEventListener('mousedown', beginHold);
els.blackScreen.addEventListener('mouseup', () => endHold(false));
els.blackScreen.addEventListener('mouseleave', () => endHold(false));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then(() => {
      log('Service Worker 已註冊');
    }).catch(err => log(`Service Worker 註冊失敗：${err.message}`));
  });
}

draw();
log('v4 GPS 診斷版：請先匯入 GPX / KML，然後按「開始定位」與「啟用 Wake Lock」。');
