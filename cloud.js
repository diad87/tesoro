'use strict';
/* Cuenta + «Mis búsquedas»: Firebase Auth y Firestore. Solo se carga cuando un adulto entra en «Mis búsquedas»;
   los móviles de los niños leen la búsqueda por REST (ver fetchCloudGame en app.js) y nunca cargan este SDK. */

const FB_VERSION = '10.14.1';
const Cloud = { ready: null, auth: null, db: null, user: null, games: [], timer: null, dirty: false, saving: null };

function cloudInit() {
  if (Cloud.ready) return Cloud.ready;
  Cloud.ready = (async () => {
    const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
    await loadScript(base + 'firebase-app-compat.js');
    await Promise.all([loadScript(base + 'firebase-auth-compat.js'), loadScript(base + 'firebase-firestore-compat.js')]);
    const fb = window.firebase;
    fb.initializeApp(window.FIREBASE_CONFIG);
    Cloud.auth = fb.auth();
    Cloud.auth.languageCode = 'es';
    Cloud.db = fb.firestore();
    await new Promise((res) => {
      let first = true;
      Cloud.auth.onAuthStateChanged((u) => {
        Cloud.user = u;
        if (first) { first = false; res(); } else if ($('library').classList.contains('active')) renderLibrary();
      });
    });
  })().catch((e) => { Cloud.ready = null; throw e; });
  return Cloud.ready;
}

/* ---------- pantalla ---------- */
async function openLibrary() {
  show('library');
  $('libLoading').hidden = false; $('libAuth').hidden = true; $('libMain').hidden = true;
  $('libLoading').textContent = 'Cargando…';
  try { await cloudInit(); } catch {
    $('libLoading').textContent = 'No se pudo conectar (¿sin internet?). Puedes seguir sin cuenta:';
    $('libAuth').hidden = false; $('libAuth').querySelector('.auth-card').hidden = true;
    return;
  }
  $('libAuth').querySelector('.auth-card').hidden = false;
  renderLibrary();
}

async function renderLibrary() {
  if (!Cloud.user) {
    $('libLoading').hidden = true; $('libMain').hidden = true; $('libAuth').hidden = false;
    return;
  }
  $('libAuth').hidden = true;
  $('libUser').textContent = Cloud.user.email || Cloud.user.displayName || 'Mi cuenta';
  $('libLoading').hidden = false; $('libLoading').textContent = 'Cargando tus búsquedas…';
  try {
    const snap = await Cloud.db.collection('games').where('owner', '==', Cloud.user.uid).get();
    Cloud.games = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt ? b.updatedAt.toMillis() : Date.now()) - (a.updatedAt ? a.updatedAt.toMillis() : Date.now()));
  } catch (e) {
    console.error(e);
    $('libLoading').textContent = 'No se pudieron cargar tus búsquedas. Revisa la conexión.';
    return;
  }
  $('libLoading').hidden = true; $('libMain').hidden = false;

  const local = store.get(LS_DRAFT, null);
  const hasLocal = !!(local && local.stops && local.stops.length);
  $('libDraft').hidden = !hasLocal;
  if (hasLocal) $('libDraftInfo').textContent = `${local.name || 'Sin nombre'} · ${local.stops.length} tesoro${local.stops.length === 1 ? '' : 's'} · aún no está en tu cuenta`;

  const ul = $('libList');
  ul.textContent = '';
  $('libEmpty').hidden = Cloud.games.length > 0;
  Cloud.games.forEach((g) => {
    const li = document.createElement('li'); li.className = 'lib-card';
    const head = document.createElement('div'); head.className = 'lib-card-head';
    const name = document.createElement('b'); name.textContent = g.name || 'Búsqueda sin nombre';
    const info = document.createElement('span');
    const when = g.updatedAt ? g.updatedAt.toDate().toLocaleDateString('es', { day: 'numeric', month: 'short' }) : 'ahora';
    info.textContent = `${g.count || 0} tesoro${g.count === 1 ? '' : 's'} · editada ${when}`;
    head.append(name, info);
    const act = document.createElement('div'); act.className = 'lib-card-actions';
    const btn = (txt, cls, label, fn) => { const b = document.createElement('button'); b.className = 'btn btn-sm ' + cls; b.textContent = txt; b.setAttribute('aria-label', label); b.onclick = fn; return b; };
    const parsed = () => { const game = decodeGame(g.data); game._pid = g.id; return game; };
    const needStops = (fn) => () => (g.count ? fn() : toast('Esta búsqueda aún no tiene tesoros: pulsa Editar'));
    act.append(
      btn('▶ Jugar', 'btn-gold', 'Jugar', needStops(() => startGame(parsed(), { demo: false, returnTo: 'library' }))),
      btn('✏️ Editar', 'btn-teal', 'Editar', () => cloudEdit(g)),
      btn('🔗', 'btn-ghost icon', 'Compartir', needStops(() => shareGame(parsed(), g.id))),
      btn('📄', 'btn-ghost icon', 'Duplicar', () => cloudDuplicate(g)),
      btn('🗑️', 'btn-ghost icon', 'Borrar', () => cloudDelete(g)));
    li.append(head, act);
    ul.appendChild(li);
  });
}

/* ---------- operaciones ---------- */
const cloudDoc = (game) => ({ name: (game.name || '').slice(0, 60), count: game.stops.length, data: encodeGame(game) });
const stamp = () => window.firebase.firestore.FieldValue.serverTimestamp();

async function cloudCreate(game) {
  const ref = await Cloud.db.collection('games').add({ owner: Cloud.user.uid, ...cloudDoc(game), createdAt: stamp(), updatedAt: stamp() });
  return ref.id;
}

function cloudEdit(g) {
  draft = decodeGame(g.data);
  draft._pid = g.id;
  draftId = g.id;
  openEditor();
}

async function cloudDuplicate(g) {
  try {
    const game = decodeGame(g.data);
    game.name = ((g.name || 'Búsqueda') + ' (copia)').slice(0, 40);
    await cloudCreate(game);
    toast('Duplicada ✅');
    renderLibrary();
  } catch (e) { console.error(e); toast('No se pudo duplicar. Revisa la conexión.'); }
}

async function cloudDelete(g) {
  if (!confirm(`¿Borrar «${g.name || 'Búsqueda sin nombre'}»? Los enlaces que hayas compartido dejarán de funcionar.`)) return;
  try { await Cloud.db.collection('games').doc(g.id).delete(); renderLibrary(); }
  catch (e) { console.error(e); toast('No se pudo borrar. Revisa la conexión.'); }
}

/* ---------- autoguardado del editor ---------- */
function cloudSaveSoon() {
  Cloud.dirty = true;
  $('edStatus').textContent = 'Guardando…';
  clearTimeout(Cloud.timer);
  Cloud.timer = setTimeout(cloudFlush, 900);
}
async function cloudFlush() {
  clearTimeout(Cloud.timer);
  if (Cloud.saving) await Cloud.saving;
  if (!Cloud.dirty || !draftId || !Cloud.user) return;
  Cloud.dirty = false;
  const id = draftId;
  Cloud.saving = Cloud.db.collection('games').doc(id).update({ ...cloudDoc(draft), updatedAt: stamp() })
    .then(() => { if (!Cloud.dirty) $('edStatus').textContent = 'Guardado en tu cuenta ✓'; })
    .catch((e) => { console.error(e); Cloud.dirty = true; $('edStatus').textContent = '⚠️ Sin guardar (¿sin conexión?)'; })
    .finally(() => { Cloud.saving = null; });
  await Cloud.saving;
}
// al salir del editor: guarda lo pendiente, tira las búsquedas nuevas que se quedaron vacías y vuelve al borrador local
async function cloudLeaveEditor() {
  if (!draftId) return;
  await cloudFlush();
  if (Cloud.dirty) toast('⚠️ Los últimos cambios no se han podido guardar', 4000);
  if (!draft.stops.length && !draft.name) { try { await Cloud.db.collection('games').doc(draftId).delete(); } catch { /* se queda vacía en la lista */ } }
  draftId = null; Cloud.dirty = false;
  draft = store.get(LS_DRAFT, null) || emptyGame();
}
window.addEventListener('pagehide', () => { if (Cloud.dirty) cloudFlush(); });

/* ---------- botones ---------- */
$('libBack').onclick = () => { refreshHome(); show('home'); };
$('libLogout').onclick = () => Cloud.auth.signOut();
$('libNew').onclick = async () => {
  try {
    const game = emptyGame();
    const id = await cloudCreate(game);
    draft = game; draft._pid = id; draftId = id;
    openEditor();
  } catch (e) { console.error(e); toast('No se pudo crear. Revisa la conexión.'); }
};
$('libDraftEdit').onclick = () => { draftId = null; draft = store.get(LS_DRAFT, null) || emptyGame(); openEditor(); };
$('libDraftUp').onclick = async () => {
  try {
    await cloudCreate(store.get(LS_DRAFT, null));
    store.set(LS_DRAFT, emptyGame());
    if (!draftId) draft = emptyGame();
    toast('Guardada en tu cuenta ☁️');
    renderLibrary();
  } catch (e) { console.error(e); toast('No se pudo guardar. Revisa la conexión.'); }
};
$('auSkip').onclick = () => { draftId = null; openEditor(); };

/* ---------- login ---------- */
const AUTH_ERRORS = {
  'auth/invalid-credential': 'El email o la contraseña no son correctos.',
  'auth/wrong-password': 'El email o la contraseña no son correctos.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese email. Pulsa «Crear cuenta».',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese email. Pulsa «Entrar».',
  'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
  'auth/invalid-email': 'Ese email no parece válido.',
  'auth/missing-password': 'Escribe una contraseña.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un poco y vuelve a probar.',
  'auth/network-request-failed': 'No hay conexión a internet.',
  'auth/operation-not-allowed': 'Este tipo de acceso todavía no está activado.',
  'auth/unauthorized-domain': 'Este dominio no está autorizado para iniciar sesión.',
};
function authError(e) {
  if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
  console.error(e);
  const p = $('auErr');
  p.textContent = (e && AUTH_ERRORS[e.code]) || 'No se pudo iniciar sesión. Inténtalo de nuevo.';
  p.hidden = false;
}
const authBusy = (on) => ['auGoogle', 'auLogin', 'auRegister'].forEach((id) => { $(id).disabled = on; });
async function authRun(fn) {
  $('auErr').hidden = true; authBusy(true);
  try { await fn(); } catch (e) { authError(e); } finally { authBusy(false); }
}
const creds = () => [$('auEmail').value.trim(), $('auPass').value];

$('auGoogle').onclick = () => authRun(async () => {
  const provider = new window.firebase.auth.GoogleAuthProvider();
  try { await Cloud.auth.signInWithPopup(provider); }
  catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await Cloud.auth.signInWithRedirect(provider);
    else throw e;
  }
});
$('auForm').onsubmit = (ev) => { ev.preventDefault(); authRun(() => Cloud.auth.signInWithEmailAndPassword(...creds())); };
$('auRegister').onclick = () => { if ($('auForm').reportValidity()) authRun(() => Cloud.auth.createUserWithEmailAndPassword(...creds())); };
$('auReset').onclick = () => {
  const email = $('auEmail').value.trim();
  if (!email) { $('auErr').textContent = 'Escribe tu email arriba y vuelve a pulsar.'; $('auErr').hidden = false; return; }
  authRun(async () => { await Cloud.auth.sendPasswordResetEmail(email); toast('Te hemos enviado un email para cambiar la contraseña 📧', 5000); });
};
