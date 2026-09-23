// app/js/app.js
//
// Arranque, router de pestanas, cronometro de descanso y hoja inferior.

import * as D from './datos.js';
import { estado, pantallaHoy, pantallaEntrenar, pantallaComer, pantallaCuerpo } from './pantallas.js';

const $ = (s) => document.querySelector(s);
const vista = $('#vista');

// ─── hoja inferior ──────────────────────────────────────────────────────────

const hoja = $('#hoja'); const hojaCuerpo = $('#hoja-cuerpo');
function abrirHoja(nodo) { hojaCuerpo.replaceChildren(nodo); hoja.hidden = false; }
function cerrarHoja() { hoja.hidden = true; hojaCuerpo.replaceChildren(); }
hoja.addEventListener('click', (e) => { if (e.target === hoja) cerrarHoja(); });

// ─── avisos ─────────────────────────────────────────────────────────────────

function aviso(texto) {
  const n = document.createElement('div');
  n.className = 'aviso';
  n.textContent = texto;
  Object.assign(n.style, {
    position: 'fixed', left: '16px', right: '16px', zIndex: '60',
    bottom: 'calc(80px + env(safe-area-inset-bottom))',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderLeftColor: 'var(--accion)', boxShadow: 'var(--shadow-lg)',
  });
  document.body.append(n);
  setTimeout(() => n.remove(), 4200);
}

// ─── cronometro de descanso ─────────────────────────────────────────────────
//
// Wake Lock para que la pantalla no se apague entre series. En Safari funciona
// desde iOS 16.4, pero DENTRO de una PWA instalada estuvo roto hasta iOS 18.4:
// si falla, no pasa nada grave, suena igual. Por eso va en try/catch y no se
// promete lo que el telefono no pueda cumplir.

const bDesc = $('#descanso'); const bReloj = $('#descanso-reloj');
const bQue = $('#descanso-que'); const bBarra = $('#descanso-barra');
let tDesc = null; let quedan = 0; let total = 0; let lock = null;

async function pedirLock() {
  try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
}
function soltarLock() { try { lock?.release(); } catch { /* da igual */ } lock = null; }

function pintaDesc() {
  const m = Math.floor(quedan / 60); const s = quedan % 60;
  bReloj.textContent = `${m}:${String(s).padStart(2, '0')}`;
  bBarra.style.width = `${total ? (quedan / total) * 100 : 0}%`;
}

function descanso(segundos, que) {
  clearInterval(tDesc);
  total = segundos; quedan = segundos;
  bQue.textContent = que ?? '';
  bDesc.hidden = false;
  pintaDesc();
  pedirLock();
  tDesc = setInterval(() => {
    quedan -= 1;
    pintaDesc();
    if (quedan <= 0) { finDescanso(true); }
  }, 1000);
}

function finDescanso(sonar) {
  clearInterval(tDesc); tDesc = null;
  bDesc.hidden = true;
  soltarLock();
  if (sonar) pitido();
}

$('#descanso-fin').addEventListener('click', () => finDescanso(false));
$('#descanso-mas').addEventListener('click', () => { quedan += 30; total = Math.max(total, quedan); pintaDesc(); });

// Un pitido sintetizado: sin fichero de audio que cachear ni que se pierda.
let ac = null;
function pitido() {
  try {
    ac ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    for (const [i, f] of [880, 1175].entries()) {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ac.destination);
      const t = ac.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    }
  } catch { /* sin audio: el reloj ya llego a cero en pantalla */ }
}

// ─── estado de sincronizacion ───────────────────────────────────────────────

const chip = $('#estado-sync'); const chipN = $('#pendientes');
async function pintaSync(n) {
  const c = await D.config();
  const pend = n ?? await D.pendientes();
  if (!c.token || !c.repo) { chip.dataset.estado = 'sin-token'; chipN.textContent = 'conectar'; return; }
  if (pend > 0) { chip.dataset.estado = 'pendiente'; chipN.textContent = String(pend); return; }
  chip.dataset.estado = 'ok'; chipN.textContent = '';
}
D.alCambiarCola((n) => pintaSync(n));
chip.addEventListener('click', () => abrirHoja(pantallaAjustes()));

function pantallaAjustes() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h2>Conectar con el repositorio</h2>
    <p class="sub">El token se guarda solo en este móvil. No viaja a ningún otro sitio.</p>
    <h3>Repositorio</h3>
    <div class="paso"><input id="c-repo" placeholder="usuario/ENTRENAMIENTO"></div>
    <h3>Token</h3>
    <div class="paso"><input id="c-token" type="password" placeholder="github_pat_..."></div>
    <h3>Rama</h3>
    <div class="paso"><input id="c-rama" placeholder="master"></div>
  `;
  const guardar = document.createElement('button');
  guardar.className = 'btn'; guardar.type = 'button'; guardar.textContent = 'Guardar y sincronizar';
  guardar.addEventListener('click', async () => {
    await D.guardarConfig({
      repo: wrap.querySelector('#c-repo').value.trim() || null,
      token: wrap.querySelector('#c-token').value.trim() || null,
      rama: wrap.querySelector('#c-rama').value.trim() || 'master',
    });
    cerrarHoja();
    try { await D.paquete({ forzarRed: true }); await D.vaciar(); aviso('Conectado.'); }
    catch (e) { aviso(`No se pudo conectar: ${e.message}`); }
    arrancar();
  });
  wrap.append(guardar);

  D.config().then((c) => {
    wrap.querySelector('#c-repo').value = c.repo ?? '';
    wrap.querySelector('#c-rama').value = c.rama ?? 'master';
  });
  return wrap;
}

// ─── router ─────────────────────────────────────────────────────────────────

const api = { hoja: abrirHoja, cerrarHoja, aviso, descanso };
let tab = 'hoy';

const TITULOS = { hoy: 'Hoy', entrenar: 'Entrenar', comer: 'Comer', cuerpo: 'Cuerpo' };

for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => { tab = b.dataset.tab; pinta(); });
}

async function pinta() {
  for (const b of document.querySelectorAll('#tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  $('#titulo').textContent = TITULOS[tab];
  const p = estado.paquete;
  if (!p) return;

  $('#subtitulo').textContent = p._origen === 'cache'
    ? `semana ${p.semana.iso} · copia local`
    : `semana ${p.semana.iso}`;

  let nodo;
  try {
    if (tab === 'hoy') nodo = pantallaHoy(p);
    else if (tab === 'entrenar') nodo = await pantallaEntrenar(p, api);
    else if (tab === 'comer') nodo = pantallaComer(p);
    else nodo = pantallaCuerpo(p, api);
  } catch (e) {
    nodo = document.createElement('div');
    nodo.className = 'aviso malo';
    nodo.textContent = `Se rompió al pintar «${tab}»: ${e.message}`;
    console.error(e);
  }
  vista.replaceChildren(nodo);
  window.scrollTo(0, 0);
}

estado.refrescar = pinta;

// ─── arranque ───────────────────────────────────────────────────────────────

async function arrancar() {
  await pintaSync();
  estado.eleccion = (await D.get('eleccion')) ?? {};
  try {
    estado.paquete = await D.paquete();
  } catch (e) {
    vista.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'aviso malo',
      textContent: `No hay datos todavía: ${e.message}. Conecta el repositorio con el botón de arriba a la derecha.`,
    }));
    return;
  }
  await pinta();
  D.vaciar();
}

if ('serviceWorker' in navigator) {
  // updateViaCache none: que un cambio publicado se vea al siguiente arranque.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}

arrancar();
