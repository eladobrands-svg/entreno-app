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

// El repositorio no cambia nunca, asi que viene puesto: lo unico que hay que
// pegar es el token. Va aqui y no en un fichero de configuracion porque esta
// app se publica en abierto y el nombre del repo no es un secreto (su
// contenido si, y eso lo protege el token).
const REPO_POR_DEFECTO = 'eladobrands-svg/ENTRENAMIENTO';
const RAMA_POR_DEFECTO = 'master';

function pantallaAjustes() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h2>Conectar</h2>
    <p class="sub">Esto se hace UNA vez. Después la app funciona desde cualquier sitio:
      no necesita tu wifi ni que el ordenador esté encendido.</p>
    <h3>Token de GitHub</h3>
    <div class="paso"><input id="c-token" type="password" autocomplete="off"
      autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="pega aquí el token"></div>
    <p class="sub">Se guarda solo en este móvil, en el almacén de esta página. No viaja a ningún
      otro sitio ni se envía a nadie.</p>
    <details><summary class="sub">Cambiar repositorio o rama</summary>
      <div class="paso" style="margin-top:8px"><input id="c-repo" autocapitalize="off" spellcheck="false"></div>
      <div class="paso" style="margin-top:8px"><input id="c-rama" autocapitalize="off" spellcheck="false"></div>
    </details>
    <p id="c-estado" class="sub"></p>
  `;
  const estadoTxt = wrap.querySelector('#c-estado');
  const guardar = document.createElement('button');
  guardar.className = 'btn'; guardar.type = 'button'; guardar.textContent = 'Conectar';

  guardar.addEventListener('click', async () => {
    const token = wrap.querySelector('#c-token').value.trim();
    if (!token) { estadoTxt.textContent = 'Falta el token.'; return; }
    guardar.disabled = true;
    estadoTxt.textContent = 'Comprobando…';

    const anterior = await D.config();
    const nueva = {
      repo: wrap.querySelector('#c-repo').value.trim() || REPO_POR_DEFECTO,
      token,
      rama: wrap.querySelector('#c-rama').value.trim() || RAMA_POR_DEFECTO,
    };
    await D.guardarConfig(nueva);
    try {
      // Se comprueba de verdad antes de dar por buena la conexion: un token
      // mal pegado tiene que fallar AQUI, no tres dias despues en el gimnasio.
      const p = await D.paquete({ forzarRed: true });
      estadoTxt.textContent = `Conectado. Plan de la semana ${p.semana.iso}.`;
      await D.vaciar();
      cerrarHoja();
      aviso(`Conectado a ${nueva.repo}.`);
      arrancar();
    } catch (e) {
      await D.guardarConfig(anterior);          // no se deja una config rota puesta
      estadoTxt.textContent = /401|403/.test(e.message)
        ? 'El token no vale o no tiene permiso sobre ese repositorio.'
        : `No se pudo conectar: ${e.message}`;
      guardar.disabled = false;
    }
  });
  wrap.append(guardar);

  D.config().then((c) => {
    wrap.querySelector('#c-repo').value = c.repo ?? REPO_POR_DEFECTO;
    wrap.querySelector('#c-rama').value = c.rama ?? RAMA_POR_DEFECTO;
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

/**
 * Traspaso de configuracion por URL: #config=<base64 de {repo,token,rama}>.
 *
 * Existe para no tener que teclear un token de 40 caracteres en un movil. Se
 * guarda y se BORRA de la barra de direcciones en el acto, para que no quede en
 * el historial ni se comparta sin querer al pasar el enlace.
 */
async function configDesdeUrl() {
  const m = /[#&]config=([A-Za-z0-9+/=_-]+)/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const json = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const c = JSON.parse(json);
    if (!c.repo || !c.token) throw new Error('faltan repo o token');
    await D.guardarConfig({ repo: c.repo, token: c.token, rama: c.rama ?? 'master' });
    aviso('Conectado con el repositorio.');
    return true;
  } catch (e) {
    aviso(`El enlace de configuración no vale: ${e.message}`);
    return false;
  }
}

async function arrancar() {
  const reciente = await configDesdeUrl();
  await pintaSync();
  estado.eleccion = (await D.get('eleccion')) ?? {};
  try {
    // Recien configurada, se va a la red: el cache de antes no sirve.
    estado.paquete = await D.paquete({ forzarRed: reciente });
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
