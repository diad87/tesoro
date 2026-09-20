'use strict';
/* Búsqueda del Tesoro — web AR con GPS + brújula + cámara. Sin servidor: la partida viaja en el enlace (#g=...). */

const $ = (id) => document.getElementById(id);
const AIETE = [43.3046, -1.9906]; // centro del parque de Aiete (Donostia)
const GEMS = ['💎', '👑', '🪙', '🗝️', '🔮', '⭐', '🦜', '🐚', '🧿', '🏅', '🍀', '🦄'];
const LS_DRAFT = 'tesoro.draft';
const LS_PROG = 'tesoro.prog.';
const H_FOV = 55, V_FOV = 68; // campo de visión aproximado de la cámara trasera en vertical (grados)

/* ---------- utilidades geo ---------- */
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

function distM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
function bearing(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function moveM(p, north, east) {
  return { lat: p.lat + north / 111320, lng: p.lng + east / (111320 * Math.cos(rad(p.lat))) };
}

/* ---------- partida <-> enlace ---------- */
function encodeGame(g) {
  const compact = { n: g.name, r: g.radius, f: g.final, s: g.stops.map((s) => [+s.lat.toFixed(6), +s.lng.toFixed(6), s.clue || '', s.prize || '']) };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeGame(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  const stops = (c.s || []).map((a) => ({ lat: +a[0], lng: +a[1], clue: String(a[2] || ''), prize: String(a[3] || '') }))
    .filter((s) => isFinite(s.lat) && isFinite(s.lng));
  return { name: String(c.n || ''), radius: clamp(+c.r || 12, 4, 60), final: String(c.f || ''), stops };
}
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } },
};

/* ---------- UI general ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function loadScript(src) {
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
}
function loadCss(href) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}

/* =====================================================================
   INICIO
   ===================================================================== */
let urlGame = null; // partida que viene en el enlace
let draft = store.get(LS_DRAFT, null) || { name: '', radius: 12, final: '', stops: [] };

function readUrlGame() {
  urlGame = null;
  const m = location.hash.match(/g=([\w-]+)/);
  if (!m) return;
  try {
    const g = decodeGame(m[1]);
    if (g.stops.length) urlGame = g;
  } catch { toast('El enlace de la búsqueda está roto 😕'); }
}
function playableGame() {
  if (urlGame) return urlGame;
  return draft.stops.length ? draft : null;
}
function progKey(g) { return LS_PROG + hashStr(encodeGame(g)); }

function refreshHome() {
  const g = playableGame();
  $('btnPlay').hidden = !g;
  $('btnDemo').hidden = !g;
  $('homeSub').textContent = (g && g.name) || 'Parque de Aiete';
  const hp = $('homeProgress');
  hp.hidden = true;
  if (g) {
    const idx = store.get(progKey(g), 0);
    if (idx > 0 && idx < g.stops.length) {
      hp.hidden = false;
      hp.textContent = `Lleváis ${idx} de ${g.stops.length} tesoros. `;
      const again = document.createElement('button');
      again.className = 'btn-link';
      again.textContent = 'Empezar de cero';
      again.onclick = () => { store.set(progKey(g), 0); refreshHome(); };
      hp.appendChild(again);
    }
  }
  $('httpsWarn').hidden = window.isSecureContext;
}

$('btnPlay').onclick = () => startGame(playableGame(), { demo: false, returnTo: 'home' });
$('btnDemo').onclick = () => startGame(playableGame(), { demo: true, returnTo: 'home' });
$('btnEdit').onclick = () => openEditor();
window.addEventListener('hashchange', () => { readUrlGame(); refreshHome(); });

/* =====================================================================
   EDITOR (para los mayores)
   ===================================================================== */
const ED = { map: null, layers: null, base: {}, sat: false, me: null, watchId: null, lastPos: null, collecting: null };

function saveDraft() { store.set(LS_DRAFT, draft); }

async function openEditor() {
  // si se abre desde un enlace compartido y no hay borrador propio, se edita esa partida
  if (urlGame && !draft.stops.length) { draft = JSON.parse(JSON.stringify(urlGame)); saveDraft(); }
  show('editor');
  $('edName').value = draft.name;
  $('edRadius').value = draft.radius;
  $('edRadiusVal').textContent = draft.radius;
  $('edFinal').value = draft.final;
  renderStops();
  if (!ED.map) {
    try {
      loadCss('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js');
      initMap();
    } catch { toast('No se pudo cargar el mapa (¿sin internet?). Puedes usar el botón del GPS.', 5000); }
  }
  if (ED.map) { ED.map.invalidateSize(); drawMap(true); }
  if (navigator.geolocation && ED.watchId == null) {
    ED.watchId = navigator.geolocation.watchPosition(onEditorPos, () => {}, { enableHighAccuracy: true, maximumAge: 1000 });
  }
}
function closeEditor() {
  if (ED.watchId != null) { navigator.geolocation.clearWatch(ED.watchId); ED.watchId = null; }
  refreshHome();
  show('home');
}

function initMap() {
  const L = window.L;
  ED.map = L.map('map', { zoomControl: true, maxZoom: 21 }).setView(AIETE, 17);
  ED.base.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
  ED.base.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: '© Esri' });
  ED.base.osm.addTo(ED.map);
  ED.layers = L.layerGroup().addTo(ED.map);
  ED.map.on('click', (e) => addStop(e.latlng.lat, e.latlng.lng));
}

function drawMap(fit) {
  const L = window.L;
  if (!ED.map) return;
  ED.layers.clearLayers();
  const pts = draft.stops.map((s) => [s.lat, s.lng]);
  if (pts.length > 1) L.polyline(pts, { color: '#0b3c49', weight: 3, dashArray: '6 8', opacity: .8 }).addTo(ED.layers);
  draft.stops.forEach((s, i) => {
    L.circle([s.lat, s.lng], { radius: draft.radius, color: '#f59e0b', weight: 1, fillOpacity: .18 }).addTo(ED.layers);
    const icon = L.divIcon({ className: '', html: `<div class="num-marker"><b>${i + 1}</b></div>`, iconSize: [34, 34], iconAnchor: [17, 41] });
    const mk = L.marker([s.lat, s.lng], { icon, draggable: true }).addTo(ED.layers);
    mk.on('dragend', () => { const p = mk.getLatLng(); s.lat = p.lat; s.lng = p.lng; saveDraft(); drawMap(false); });
  });
  if (fit && pts.length) ED.map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 19 });
}

function onEditorPos(p) {
  ED.lastPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
  if (ED.collecting && (!ED.collecting.best || ED.lastPos.acc < ED.collecting.best.acc)) ED.collecting.best = ED.lastPos;
  if (ED.map) {
    const L = window.L;
    if (!ED.me) {
      ED.me = L.marker([ED.lastPos.lat, ED.lastPos.lng], { icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: -100 }).addTo(ED.map);
    } else ED.me.setLatLng([ED.lastPos.lat, ED.lastPos.lng]);
  }
}

function addStop(lat, lng) {
  draft.stops.push({ lat, lng, clue: '', prize: '' });
  saveDraft(); renderStops(); drawMap(false);
}

$('edHere').onclick = () => {
  if (!navigator.geolocation) return toast('Este dispositivo no tiene GPS');
  if (ED.collecting) return;
  ED.collecting = { best: null };
  toast('📡 Midiendo GPS… quédate quieto 4 segundos', 4000);
  setTimeout(() => {
    const p = ED.collecting.best || ED.lastPos;
    ED.collecting = null;
    if (!p) return toast('No hay señal GPS todavía. Revisa los permisos de ubicación.', 4000);
    addStop(p.lat, p.lng);
    if (ED.map) ED.map.setView([p.lat, p.lng], Math.max(ED.map.getZoom(), 19));
    toast(`✅ Tesoro ${draft.stops.length} colocado (precisión ±${Math.round(p.acc)} m)`);
  }, 4000);
};

function renderStops() {
  const ol = $('stopList');
  ol.textContent = '';
  $('edEmpty').hidden = draft.stops.length > 0;
  draft.stops.forEach((s, i) => {
    const li = document.createElement('li'); li.className = 'stop';
    const head = document.createElement('div'); head.className = 'stop-head';
    const num = document.createElement('span'); num.className = 'stop-num'; num.textContent = i + 1;
    const title = document.createElement('span'); title.className = 'stop-title'; title.textContent = i === draft.stops.length - 1 && i > 0 ? 'Tesoro final' : `Tesoro ${i + 1}`;
    const mkBtn = (txt, label, fn, disabled) => { const b = document.createElement('button'); b.textContent = txt; b.setAttribute('aria-label', label); b.disabled = !!disabled; b.onclick = fn; return b; };
    const swap = (a, b) => { [draft.stops[a], draft.stops[b]] = [draft.stops[b], draft.stops[a]]; saveDraft(); renderStops(); drawMap(false); };
    head.append(num, title,
      mkBtn('↑', 'Subir', () => swap(i, i - 1), i === 0),
      mkBtn('↓', 'Bajar', () => swap(i, i + 1), i === draft.stops.length - 1),
      mkBtn('🗑️', 'Borrar', () => { draft.stops.splice(i, 1); saveDraft(); renderStops(); drawMap(false); }));
    const clue = document.createElement('input'); clue.type = 'text'; clue.maxLength = 140; clue.value = s.clue;
    clue.placeholder = 'Pista para llegar (ej.: «Donde nadan los patos»)';
    clue.oninput = () => { s.clue = clue.value; saveDraft(); };
    const prize = document.createElement('input'); prize.type = 'text'; prize.maxLength = 140; prize.value = s.prize;
    prize.placeholder = 'Al abrir el cofre (ej.: «Mirad debajo del banco»)';
    prize.oninput = () => { s.prize = prize.value; saveDraft(); };
    li.append(head, clue, prize);
    ol.appendChild(li);
  });
}

$('edBack').onclick = closeEditor;
$('edLayer').onclick = () => {
  if (!ED.map) return;
  ED.sat = !ED.sat;
  ED.map.removeLayer(ED.sat ? ED.base.osm : ED.base.sat);
  ED.map.addLayer(ED.sat ? ED.base.sat : ED.base.osm);
  $('edLayer').textContent = ED.sat ? '🗺️' : '🛰️';
};
$('edName').oninput = (e) => { draft.name = e.target.value; saveDraft(); };
$('edFinal').oninput = (e) => { draft.final = e.target.value; saveDraft(); };
$('edRadius').oninput = (e) => { draft.radius = +e.target.value; $('edRadiusVal').textContent = draft.radius; saveDraft(); drawMap(false); };
$('edClear').onclick = () => {
  if (!confirm('¿Borrar todos los tesoros de este borrador?')) return;
  draft = { name: '', radius: 12, final: '', stops: [] };
  saveDraft(); openEditor();
};
$('edTest').onclick = () => {
  if (!draft.stops.length) return toast('Pon al menos un tesoro en el mapa');
  startGame(draft, { demo: true, returnTo: 'editor' });
};

/* ---------- compartir ---------- */
$('edShare').onclick = async () => {
  if (!draft.stops.length) return toast('Pon al menos un tesoro en el mapa');
  const url = location.origin + location.pathname + '#g=' + encodeGame(draft);
  $('shareUrl').value = url;
  $('shLocalWarn').hidden = !(location.protocol === 'file:' || /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname));
  $('shNative').hidden = !navigator.share;
  $('ovShare').hidden = false;
  const qrBox = $('qr');
  qrBox.textContent = '';
  try {
    if (!window.qrcode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
    const qr = window.qrcode(0, 'L');
    qr.addData(url);
    qr.make();
    qrBox.innerHTML = qr.createImgTag(4, 8);
  } catch { qrBox.textContent = 'QR no disponible (enlace demasiado largo o sin internet). Usa «Copiar» o «Enviar».'; qrBox.style.lineHeight = '1.3'; }
};
$('shCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('shareUrl').value); } catch { $('shareUrl').select(); document.execCommand('copy'); }
  toast('Enlace copiado ✅');
};
$('shNative').onclick = () => navigator.share({ title: draft.name || 'Búsqueda del tesoro', text: '¡Búsqueda del tesoro! Abre el enlace con el móvil:', url: $('shareUrl').value }).catch(() => {});
$('shClose').onclick = () => { $('ovShare').hidden = true; };

/* =====================================================================
   JUEGO
   ===================================================================== */
const G = {
  game: null, key: null, idx: 0, demo: false, returnTo: 'home', running: false,
  pos: null, acc: null, rawHeading: null, heading: null, compassSeen: false, coursePos: null, elev: 0,
  inRange: false, opening: false, paused: false, muted: false,
  watchId: null, stream: null, wake: null, raf: 0, lastT: 0, lastPing: 0, keys: new Set(),
  W: 0, H: 0, compassSrc: '', oriCount: 0, frameCount: 0, statT: 0, oriHz: 0, fps: 0,
};
const el = {
  game: $('game'), cam: $('cam'), fake: $('fakeWorld'), arrowWrap: $('arrowWrap'), arrow: $('arrow'),
  beacon: $('beacon'), beaconLabel: $('beaconLabel'), chest: $('chest'),
  count: $('hudCount'), gps: $('hudGps'), loot: $('loot'), distNum: $('distNum'), heat: $('heatLabel'), heatFill: $('heatFill'),
  clue: $('clueText'), turn: $('turnHint'), pad: $('pad'),
};
const setText = (node, txt) => { if (node.textContent !== txt) node.textContent = txt; };
// escribir en el DOM solo cuando cambia algo: el bucle va a 60 fps encima del vídeo
const setHidden = (node, h) => { if (node.hidden !== h) node.hidden = h; };
const setStyle = (node, prop, val) => { if (node._s === undefined) node._s = {}; if (node._s[prop] !== val) { node._s[prop] = val; node.style[prop] = val; } };
function measure() { G.W = el.game.clientWidth; G.H = el.game.clientHeight; }
window.addEventListener('resize', measure);

function startGame(game, { demo, returnTo }) {
  if (!game || !game.stops.length) return;
  Object.assign(G, { game, demo, returnTo, key: progKey(game), compassSrc: '', pos: null, acc: null, rawHeading: null, heading: null, compassSeen: false, coursePos: null, elev: 0, inRange: false, opening: false, paused: false });
  G.idx = demo ? 0 : store.get(G.key, 0);
  if (G.idx >= game.stops.length) G.idx = 0;
  $('startTitle').textContent = game.name || '¿Preparados?';
  $('ovStart').hidden = false; $('ovFound').hidden = true; $('ovWin').hidden = true; $('ovMenu').hidden = true;
  el.chest.hidden = true; el.chest.classList.remove('open'); el.beacon.hidden = true; el.arrowWrap.hidden = true;
  el.pad.hidden = !demo;
  updateStaticHud();
  show('game');
  measure();
}

function updateStaticHud() {
  const n = G.game.stops.length;
  setText(el.count, `⭐ ${G.idx}/${n}`);
  setText(el.loot, Array.from({ length: G.idx }, (_, i) => GEMS[i % GEMS.length]).join(''));
  const s = G.game.stops[G.idx];
  if (s) setText(el.clue, s.clue || (G.idx === n - 1 && n > 1 ? '¡Último tesoro! Sigue la flecha hasta el cofre.' : 'Sigue la flecha hasta encontrar el cofre.'));
}

$('btnStartBack').onclick = exitGame;
$('btnStart').onclick = async () => {
  initAudio();
  if (G.demo) {
    el.fake.hidden = false; el.cam.hidden = true;
    const first = G.game.stops[G.idx];
    G.pos = moveM(first, -40, -18); G.acc = 3; G.rawHeading = 0; G.heading = 0; G.compassSeen = true; G.compassSrc = 'simulada';
    el.gps.className = 'pill gps ok'; setText(el.gps, '🎮 Modo prueba');
  } else {
    // 1) brújula — en iPhone hay que pedir permiso dentro del toque
    await askCompass();
    // 2) cámara
    await startCam();
    // 3) GPS
    if (navigator.geolocation) {
      G.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    } else { el.gps.className = 'pill gps bad'; setText(el.gps, '🚫 Sin GPS'); }
    requestWake();
  }
  $('ovStart').hidden = true;
  G.running = true; G.lastT = performance.now();
  cancelAnimationFrame(G.raf);
  G.raf = requestAnimationFrame(frame);
};

const needsCompassPermission = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
async function askCompass() {
  try {
    if (needsCompassPermission()) {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') toast('Brújula sin permiso. Cierra esta pestaña de Safari, vuelve a abrir el enlace y pulsa «Permitir».', 6000);
    }
  } catch { /* seguimos sin brújula */ }
  window.removeEventListener('deviceorientationabsolute', onOrient, true);
  window.removeEventListener('deviceorientation', onOrient, true);
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}

async function startCam() {
  try {
    G.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    el.cam.srcObject = G.stream; el.cam.hidden = false; el.fake.hidden = true;
    await el.cam.play().catch(() => {});
  } catch {
    el.cam.hidden = true; el.fake.hidden = false;
    toast('No hay cámara (o sin permiso). Se puede jugar igual 🙂', 4000);
  }
}
async function requestWake() {
  try { if ('wakeLock' in navigator) G.wake = await navigator.wakeLock.request('screen'); } catch { /* no pasa nada */ }
}
document.addEventListener('visibilitychange', () => { if (G.running && !G.demo && document.visibilityState === 'visible') requestWake(); });

function exitGame() {
  G.running = false;
  cancelAnimationFrame(G.raf);
  if (G.watchId != null) { navigator.geolocation.clearWatch(G.watchId); G.watchId = null; }
  if (G.stream) { G.stream.getTracks().forEach((t) => t.stop()); G.stream = null; el.cam.srcObject = null; }
  window.removeEventListener('deviceorientationabsolute', onOrient, true);
  window.removeEventListener('deviceorientation', onOrient, true);
  if (G.wake) { G.wake.release().catch(() => {}); G.wake = null; }
  G.keys.clear();
  if (G.returnTo === 'editor') openEditor(); else { refreshHome(); show('home'); }
}

/* ---------- sensores ---------- */
function onPos(p) {
  const np = { lat: p.coords.latitude, lng: p.coords.longitude };
  G.pos = np; G.acc = p.coords.accuracy;
  const a = Math.round(G.acc);
  el.gps.className = 'pill gps ' + (a <= 10 ? 'ok' : a <= 25 ? 'meh' : 'bad');
  setText(el.gps, a <= 25 ? `📡 GPS ±${a} m` : `📡 GPS flojo ±${a} m · sal a cielo abierto`);
  // sin brújula: orientamos con el rumbo al caminar
  if (!G.compassSeen) {
    const c = p.coords;
    if (typeof c.heading === 'number' && !isNaN(c.heading) && c.speed > 0.5) { G.rawHeading = c.heading; G.coursePos = np; G.compassSrc = 'rumbo GPS'; }
    else if (!G.coursePos) G.coursePos = np;
    else if (distM(G.coursePos, np) > 3) { G.rawHeading = bearing(G.coursePos, np); G.coursePos = np; G.compassSrc = 'rumbo GPS'; }
  }
}
function onPosErr(e) {
  el.gps.className = 'pill gps bad';
  if (e.code === 1) { setText(el.gps, '🚫 GPS sin permiso'); toast('Activa la ubicación para esta web en los ajustes del navegador', 5000); }
  else setText(el.gps, '📡 Buscando GPS…');
}

function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  G.oriCount++;
  const b = rad(e.beta), g = rad(e.gamma);
  const cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // elevación de la cámara trasera sobre el horizonte
  G.elev = deg(Math.asin(clamp(-cB * cG, -1, 1)));

  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) { // iPhone
    G.rawHeading = e.webkitCompassHeading; G.compassSeen = true; G.compassSrc = 'iPhone';
    return;
  }
  const absolute = e.type === 'deviceorientationabsolute' || e.absolute === true;
  if (!absolute || e.alpha == null) return;
  // Android: dirección horizontal hacia la que mira el móvil (mezcla "parte de arriba" + "cámara trasera"
  // para que funcione igual con el móvil tumbado que de pie)
  const a = rad(e.alpha), cA = Math.cos(a), sA = Math.sin(a);
  const topE = -cB * sA, topN = cA * cB;
  const backE = -(cG * sA * sB + cA * sG), backN = -(sA * sG - cA * cG * sB);
  const E = topE + backE, N = topN + backN;
  if (Math.abs(E) + Math.abs(N) < 0.05) return;
  G.rawHeading = (deg(Math.atan2(E, N)) + 360) % 360; G.compassSeen = true; G.compassSrc = 'Android';
}

/* ---------- bucle principal ---------- */
function frame(t) {
  if (!G.running) return;
  G.raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - G.lastT) / 1000); G.lastT = t;
  const W = G.W, H = G.H;
  G.frameCount++;
  if (t - G.statT >= 1000) { G.fps = G.frameCount; G.oriHz = G.oriCount; G.frameCount = 0; G.oriCount = 0; G.statT = t; if (!$('ovMenu').hidden) renderDiag(); }
  const blocked = G.paused || G.opening || !$('ovFound').hidden || !$('ovWin').hidden || !$('ovMenu').hidden;

  if (G.demo && !blocked) {
    if (G.keys.has('left')) G.rawHeading = (G.rawHeading - 90 * dt + 360) % 360;
    if (G.keys.has('right')) G.rawHeading = (G.rawHeading + 90 * dt) % 360;
    if (G.keys.has('up')) { const h = rad(G.rawHeading); G.pos = moveM(G.pos, Math.cos(h) * 6 * dt, Math.sin(h) * 6 * dt); }
  }
  if (G.rawHeading != null) {
    // suavizado adaptativo: los giros grandes se siguen casi al instante, el temblor pequeño se filtra
    const diff = G.heading == null ? 0 : norm180(G.rawHeading - G.heading);
    const k = Math.min(1, dt * (Math.abs(diff) > 12 ? 25 : 10));
    G.heading = G.heading == null ? G.rawHeading : (G.heading + diff * k + 360) % 360;
  }

  const target = G.game.stops[G.idx];
  if (!target || !G.pos) { setHidden(el.arrowWrap, true); setHidden(el.beacon, true); return; }

  const d = distM(G.pos, target);
  const rel = G.heading == null ? null : norm180(bearing(G.pos, target) - G.heading);
  const radius = G.game.radius;

  // entrar / salir de la zona del cofre (con histéresis para que no parpadee)
  if (!G.inRange && d <= radius) { G.inRange = true; if (!blocked) { sfxNear(); if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } }
  else if (G.inRange && d > radius * 1.6 && !G.opening) G.inRange = false;

  // HUD
  setText(el.distNum, d >= 1000 ? (d / 1000).toFixed(1) + 'k' : String(Math.round(d)));
  const heat = G.inRange ? '🎉 ¡Aquí está!' : d < 20 ? '🌋 ¡Te quemas!' : d < 40 ? '🔥 Caliente' : d < 80 ? '🌤️ Templado' : '❄️ Frío';
  setText(el.heat, heat);
  setStyle(el.heatFill, 'width', Math.round(clamp(1 - (d - radius) / 120, 0.04, 1) * 100) + '%');
  el.game.classList.toggle('hot', d < 20 || G.inRange);
  el.game.classList.toggle('near', d >= 20 && d < 40);

  // flecha en el suelo
  setHidden(el.arrowWrap, rel == null || blocked || G.inRange);
  if (rel != null) setStyle(el.arrow, 'transform', `rotate(${rel.toFixed(1)}deg)`);

  // pista de giro
  let turn = '';
  if (rel == null) turn = G.demo ? '' : '🚶 Camina un poco para orientar la flecha';
  else if (!G.compassSeen) turn = '🧭 Sin brújula · camina recto para orientar la flecha';
  else if (Math.abs(rel) > 135) turn = '↩️ ¡Date la vuelta!';
  else if (rel > 50) turn = 'Gira a la derecha ➡️';
  else if (rel < -50) turn = '⬅️ Gira a la izquierda';
  else if (G.inRange) turn = '¡Toca el cofre!';
  setHidden(el.turn, !turn || blocked); setText(el.turn, turn);

  // objetos AR
  const yAR = H / 2 + ((G.elev + 6) / V_FOV) * H;
  if (G.inRange) {
    setHidden(el.beacon, true);
    setHidden(el.chest, !$('ovFound').hidden || !$('ovWin').hidden);
    const x = rel == null ? W / 2 : clamp(W / 2 + (rel / H_FOV) * W, 80, W - 80); // siempre tocable
    const y = clamp(yAR, H * 0.3, H * 0.52);
    const sc = clamp(1.05 - (d / radius) * 0.35, 0.65, 1.05) * Math.min(1, W / 380);
    setStyle(el.chest, 'transform', `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) scale(${sc.toFixed(2)})`);
  } else {
    setHidden(el.chest, true);
    const vis = rel != null && Math.abs(rel) < H_FOV / 2 + 8 && !blocked;
    setHidden(el.beacon, !vis);
    if (vis) {
      const x = W / 2 + (rel / H_FOV) * W, y = clamp(yAR, H * 0.25, H * 0.58);
      setStyle(el.beacon, 'transform', `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) scale(${clamp(28 / d, 0.45, 1.15).toFixed(2)})`);
      setText(el.beaconLabel, `${Math.round(d)} m`);
    }
  }

  // "sonar": pita más rápido cuanto más cerca
  if (!blocked && !G.inRange && t - G.lastPing > clamp(d / 40, 0.35, 2.5) * 1000) {
    G.lastPing = t;
    tone(clamp(1100 - d * 6, 420, 1100), 0.09, 'sine', 0, 0.12);
  }
}

/* ---------- abrir cofre ---------- */
el.chest.onclick = () => { if (!G.opening && G.inRange) foundCurrent(); };

function foundCurrent() {
  G.opening = true;
  el.chest.hidden = false;
  el.chest.classList.add('open');
  sfxOpen(); confetti(120);
  if (navigator.vibrate) navigator.vibrate(300);
  const stop = G.game.stops[G.idx], n = G.game.stops.length, last = G.idx === n - 1;
  setTimeout(() => {
    $('foundGem').textContent = GEMS[G.idx % GEMS.length];
    $('foundTitle').textContent = `¡Tesoro ${G.idx + 1} de ${n}!`;
    $('foundMsg').textContent = stop.prize || '¡Genial! Habéis ganado una joya para la colección.';
    $('btnNext').textContent = last ? '¡Ver el final! 🏆' : 'Siguiente pista ➜';
    G.idx++;
    if (!G.demo) store.set(G.key, G.idx);
    updateStaticHud();
    $('ovFound').hidden = false;
    el.chest.hidden = true; el.chest.classList.remove('open');
    G.opening = false; G.inRange = false;
  }, 1100);
}

$('btnNext').onclick = () => {
  $('ovFound').hidden = true;
  if (G.idx >= G.game.stops.length) {
    $('lootFinal').textContent = G.game.stops.map((_, i) => GEMS[i % GEMS.length]).join(' ');
    $('winMsg').textContent = G.game.final || '¡Sois unos auténticos piratas buscatesoros!';
    $('ovWin').hidden = false;
    sfxWin(); confetti(260);
  }
};
$('btnAgain').onclick = () => { G.idx = 0; if (!G.demo) store.set(G.key, 0); G.inRange = false; updateStaticHud(); $('ovWin').hidden = true; };
$('btnWinHome').onclick = exitGame;

/* ---------- menú ---------- */
function renderDiag() {
  const compass = G.compassSeen ? `✅ ${G.compassSrc} · ${G.oriHz} lecturas/s` : `❌ no llega (${G.compassSrc || 'esperando'})`;
  $('mnDiag').textContent = `Brújula: ${compass}\nRumbo: ${G.heading == null ? '–' : Math.round(G.heading) + '°'}   Fluidez: ${G.fps} fps\nGPS: ${G.acc == null ? 'sin señal' : '±' + Math.round(G.acc) + ' m'}`;
  $('mnCompass').hidden = G.demo || G.compassSeen;
}
$('mnCompass').onclick = async () => { await askCompass(); setTimeout(renderDiag, 800); };
$('hudMenu').onclick = () => { renderDiag(); $('ovMenu').hidden = false; };
$('mnClose').onclick = () => { $('ovMenu').hidden = true; };
$('mnExit').onclick = () => { $('ovMenu').hidden = true; exitGame(); };
$('mnSound').onclick = () => { G.muted = !G.muted; $('mnSound').textContent = G.muted ? '🔇 Sonido: no' : '🔊 Sonido: sí'; };
{
  const b = $('mnSkip'); let timer;
  const cancel = () => { clearTimeout(timer); b.classList.remove('holding'); };
  b.addEventListener('pointerdown', () => {
    b.classList.add('holding');
    timer = setTimeout(() => { cancel(); $('ovMenu').hidden = true; if (G.idx < G.game.stops.length) { G.inRange = true; foundCurrent(); } }, 2000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, cancel));
}

/* ---------- mandos del modo prueba ---------- */
const KEYMAP = { ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', a: 'left', d: 'right' };
window.addEventListener('keydown', (e) => { if (G.running && G.demo && KEYMAP[e.key]) { G.keys.add(KEYMAP[e.key]); e.preventDefault(); } });
window.addEventListener('keyup', (e) => { if (KEYMAP[e.key]) G.keys.delete(KEYMAP[e.key]); });
el.pad.querySelectorAll('button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); G.keys.add(b.dataset.k); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => G.keys.delete(b.dataset.k)));
});

/* ---------- sonido ---------- */
let actx = null;
function initAudio() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { actx = null; }
}
function tone(freq, dur, type = 'sine', when = 0, vol = 0.2) {
  if (!actx || G.muted) return;
  const t0 = actx.currentTime + when, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
const sfxNear = () => [660, 880, 1320].forEach((f, i) => tone(f, 0.16, 'triangle', i * 0.09, 0.2));
const sfxOpen = () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', i * 0.08, 0.22));
const sfxWin = () => [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'square', i * 0.16, 0.12));

/* ---------- confeti ---------- */
const cf = { parts: [], raf: 0 };
function confetti(n) {
  const c = $('confetti'), W = c.width = c.clientWidth, H = c.height = c.clientHeight;
  const colors = ['#ffc83d', '#ff5d5d', '#5be37d', '#5ec8ff', '#c77dff', '#fff'];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 10;
    cf.parts.push({ x: W / 2, y: H * 0.42, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, s: 5 + Math.random() * 7, r: Math.random() * 6, c: colors[i % colors.length], life: 1 });
  }
  if (cf.raf) return;
  const ctx = c.getContext('2d');
  const step = () => {
    ctx.clearRect(0, 0, W, H);
    cf.parts = cf.parts.filter((p) => p.life > 0 && p.y < H + 20);
    cf.parts.forEach((p) => {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += 0.2; p.life -= 0.006;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); ctx.restore();
    });
    cf.raf = cf.parts.length ? requestAnimationFrame(step) : 0;
    if (!cf.raf) ctx.clearRect(0, 0, W, H);
  };
  cf.raf = requestAnimationFrame(step);
}

/* ---------- arranque ---------- */
readUrlGame();
refreshHome();
