// app/js/app.js
//
// Arranque, router de pestanas, cronometro de descanso y hoja inferior.

import * as D from './datos.js';
import { estado, pantallaHoy, pantallaEntrenar, pantallaComer, pantallaAnalisis, pantallaSemana } from './pantallas.js';

// Se sube a mano en cada despliegue. Sirve para dos cosas: que se vea en
// Ajustes qué versión está corriendo el móvil (sin eso, «no veo los cambios»
// es indiagnosticable) y para que el service worker se reinstale.
export const VERSION = '2026-09-24.1';

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
let tDesc = null; let lock = null;

// El estado del descanso es un INSTANTE de fin, no una cuenta que se decrementa.
//
// Esa es la diferencia entre que el reloj siga bien al volver de otra app o
// que se quede congelado: iOS suspende el JavaScript cuando sales, asi que un
// setInterval que resta de uno en uno pierde todos los segundos que pasan
// fuera. Con un instante de fin, el tiempo lo lleva el reloj del telefono y al
// volver solo hay que restar. Ademas sobrevive a que la app se recargue.
let fin = null;      // marca de tiempo en ms
let total = 0;       // duracion pedida, para la barra
let etiqueta = '';

const restan = () => (fin ? Math.max(0, Math.round((fin - Date.now()) / 1000)) : 0);

async function pedirLock() {
  try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
}
function soltarLock() { try { lock?.release(); } catch { /* da igual */ } lock = null; }

function pintaDesc() {
  const q = restan();
  const m = Math.floor(q / 60); const s = q % 60;
  bReloj.textContent = `${m}:${String(s).padStart(2, '0')}`;
  bBarra.style.width = `${total ? (q / total) * 100 : 0}%`;
}

function guardarDescanso() {
  try {
    if (fin) sessionStorage.setItem('descanso', JSON.stringify({ fin, total, etiqueta }));
    else sessionStorage.removeItem('descanso');
  } catch { /* sin almacenamiento: el descanso simplemente no sobrevive a recargar */ }
}

function descanso(segundos, que) {
  clearInterval(tDesc);
  total = segundos;
  fin = Date.now() + segundos * 1000;
  etiqueta = que ?? '';
  bQue.textContent = etiqueta;
  bDesc.hidden = false;
  guardarDescanso();
  pintaDesc();
  pedirLock();
  sonido.arrancar();
  tDesc = setInterval(tic, 250);      // 250 ms: el segundo cambia sin retraso visible
}

function tic() {
  pintaDesc();
  if (restan() <= 0) finDescanso(true);
}

function finDescanso(sonar, tardio = false) {
  clearInterval(tDesc); tDesc = null;
  fin = null; guardarDescanso();
  bDesc.hidden = true;
  soltarLock();
  sonido.parar();
  if (sonar) pitido();
  if (tardio) aviso(`El descanso de «${etiqueta}» terminó mientras estabas fuera.`);
}

$('#descanso-fin').addEventListener('click', () => finDescanso(false));
$('#descanso-mas').addEventListener('click', () => {
  if (!fin) return;
  fin += 30000; total = Math.max(total, Math.round((fin - Date.now()) / 1000));
  guardarDescanso(); pintaDesc();
});

// Al volver de otra app (o de la pantalla apagada) se recalcula en el acto.
// Si el descanso se acabo mientras tanto, se dice, en vez de enseñar 0:00 sin
// explicar nada.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Una PWA que vuelve del fondo NO recarga: sin esto, la comprobacion de
  // version del arranque no volveria a correr nunca y el movil se quedaria con
  // lo que cargo el primer dia. Si hay descanso en marcha no se recarga: se
  // perderia el reloj.
  if (!fin) D.autoActualizar(VERSION).catch(() => {});
  if (!fin) return;
  if (restan() <= 0) finDescanso(true, true);
  else { pintaDesc(); pedirLock(); }
});

/** Recupera un descanso en curso tras recargar la app. */
function recuperarDescanso() {
  let g;
  try { g = JSON.parse(sessionStorage.getItem('descanso') ?? 'null'); } catch { return; }
  if (!g?.fin) return;
  fin = g.fin; total = g.total; etiqueta = g.etiqueta ?? '';
  if (restan() <= 0) { finDescanso(false, true); return; }
  bQue.textContent = etiqueta;
  bDesc.hidden = false;
  pintaDesc();
  tDesc = setInterval(tic, 250);
}

/**
 * Mantener vivo el aviso con la app en segundo plano.
 *
 * iOS congela el JavaScript al salir de la app, PERO no corta el audio. Un
 * sonido en bucle a volumen cero mantiene viva la pagina y hace que el pitido
 * suene a su hora aunque estes en otra aplicacion.
 *
 * El coste es real y por eso NO va activado: iOS da la sesion de audio a quien
 * la pide, asi que esto puede pausarte la musica. Se elige en Ajustes.
 */
const sonido = (() => {
  // WAV de un segundo de silencio, generado aqui para no depender de un fichero.
  const SILENCIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  let el = null; let activo = false;
  return {
    get activo() { return activo; },
    set(v) { activo = v; try { localStorage.setItem('sonidoFondo', v ? '1' : '0'); } catch { /**/ } },
    cargar() { try { activo = localStorage.getItem('sonidoFondo') === '1'; } catch { /**/ } },
    arrancar() {
      if (!activo) return;
      try {
        el ??= Object.assign(new Audio(SILENCIO), { loop: true, volume: 0.0001 });
        el.play().catch(() => {});
      } catch { /* sin audio: el reloj sigue siendo correcto al volver */ }
    },
    parar() { try { el?.pause(); } catch { /**/ } },
  };
})();
sonido.cargar();

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

// ─── el boton de actualizar, junto al titulo ────────────────────────────────
//
// Un solo toque hace las tres cosas en orden: version nueva de la app (si la
// hay, recarga y ya), pulsera desde GitHub Actions, y paquete fresco. Lo que
// pasa se cuenta en el subtitulo; lo que falla se dice, no se esconde.

const btnAct = $('#btn-actualizar');
const sub = $('#subtitulo');
async function actualizarTodo() {
  if (btnAct.dataset.ocupado === 'true') return;
  btnAct.dataset.ocupado = 'true';
  const di = (t) => { sub.textContent = t; };
  try {
    di('Comprobando versión…');
    if (await D.autoActualizar(VERSION)) return;      // recarga en marcha

    const c = await D.config();
    if (c.token && c.repo) {
      try {
        await D.actualizarPulsera(di);
      } catch (e) {
        aviso(e.message);                             // se cuenta, pero se sigue
      }
    }

    di('Cargando datos…');
    estado.paquete = await D.paquete({ forzarRed: true });
    await pinta();
    const h = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    sub.textContent = `${sub.textContent.replace(/ · actualizado.*$/, '')} · actualizado ${h}`;
  } catch (e) {
    aviso(`No se pudo actualizar: ${e.message}`);
    await pinta();
  } finally {
    btnAct.dataset.ocupado = 'false';
  }
}
btnAct.addEventListener('click', actualizarTodo);

// El folio: la semana explicada. Fase, qué se espera, dónde mejorar.
$('#btn-semana').addEventListener('click', () => {
  if (estado.paquete) abrirHoja(pantallaSemana(estado.paquete));
});

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
    <h3>Descanso en segundo plano</h3>
    <label class="opcion"><input type="checkbox" id="c-sonido">
      <span>Avisar aunque salga de la app<br>
      <span class="sub">El reloj siempre vuelve bien al reentrar. Esto además hace que el pitido
      suene a su hora estando fuera, a costa de poder pausarte la música.</span></span></label>
    <details><summary class="sub">Cambiar repositorio o rama</summary>
      <div class="paso" style="margin-top:8px"><input id="c-repo" autocapitalize="off" spellcheck="false"></div>
      <div class="paso" style="margin-top:8px"><input id="c-rama" autocapitalize="off" spellcheck="false"></div>
    </details>
    <p id="c-estado" class="sub"></p>
    <p class="sub">Versión ${VERSION}. Se actualiza sola al abrir.</p>
  `;
  const estadoTxt = wrap.querySelector('#c-estado');
  const guardar = document.createElement('button');
  guardar.className = 'btn'; guardar.type = 'button'; guardar.textContent = 'Conectar';

  guardar.addEventListener('click', async () => {
    // Al pegar desde iOS se cuelan espacios, saltos y a veces caracteres
    // invisibles. Se limpia todo lo que no sea del token.
    const token = wrap.querySelector('#c-token').value.replace(/[^\x21-\x7e]/g, '');
    if (!token) { estadoTxt.textContent = 'Falta el token.'; return; }
    guardar.disabled = true;
    estadoTxt.textContent = 'Comprobando⬦';

    const anterior = await D.config();
    const nueva = {
      repo: wrap.querySelector('#c-repo').value.trim() || REPO_POR_DEFECTO,
      token,
      rama: wrap.querySelector('#c-rama').value.trim() || RAMA_POR_DEFECTO,
    };

    // Primero se diagnostica, y se dice QUE falla. «No se puede con ese token»
    // no es una respuesta: hay que saber si el token es malo, si no llega al
    // repositorio o si solo puede leer.
    const d = await D.diagnosticar(token, nueva.repo);
    if (!d.ok) { estadoTxt.textContent = d.motivo; guardar.disabled = false; return; }

    await D.guardarConfig(nueva);
    try {
      const p = await D.paquete({ forzarRed: true });
      estadoTxt.textContent = `Conectado. Plan de la semana ${p.semana.iso}.`;
      await D.vaciar();
      cerrarHoja();
      aviso(`Conectado a ${nueva.repo}.`);
      arrancar();
    } catch (e) {
      await D.guardarConfig(anterior);          // no se deja una config rota puesta
      estadoTxt.textContent = e.status === 404
        ? `El token vale, pero no encuentro derivado/app/ en «${nueva.repo}» (rama ${nueva.rama}). `
          + 'Falta publicar el paquete desde el ordenador.'
        : `No se pudo conectar: ${e.message}`;
      guardar.disabled = false;
    }
  });
  wrap.append(guardar);

  const chk = wrap.querySelector('#c-sonido');
  chk.checked = sonido.activo;
  chk.addEventListener('change', () => sonido.set(chk.checked));

  D.config().then((c) => {
    wrap.querySelector('#c-repo').value = c.repo ?? REPO_POR_DEFECTO;
    wrap.querySelector('#c-rama').value = c.rama ?? RAMA_POR_DEFECTO;
  });
  return wrap;
}

// ─── router ─────────────────────────────────────────────────────────────────

const api = { hoja: abrirHoja, cerrarHoja, aviso, descanso };
let tab = 'hoy';

const TITULOS = { hoy: 'Hoy', entrenar: 'Entreno', comer: 'Comida', cuerpo: 'Análisis' };

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
    if (tab === 'hoy') nodo = pantallaHoy(p, api);
    else if (tab === 'entrenar') nodo = await pantallaEntrenar(p, api);
    else if (tab === 'comer') nodo = pantallaComer(p);
    else nodo = pantallaAnalisis(p, api);
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
  // Lo PRIMERO: si hay una versión nueva publicada, se recarga sola. Sin esto
  // un móvil con la app instalada puede quedarse meses con una versión vieja y
  // desde fuera no hay forma de saberlo.
  if (await D.autoActualizar(VERSION)) return;
  await D.migrarSesionVieja();

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
  recuperarDescanso();
  D.vaciar();
}

if ('serviceWorker' in navigator) {
  // updateViaCache none: que un cambio publicado se vea al siguiente arranque.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  // Un service worker nuevo pide recargar a todas las pestañas al activarse.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo === 'recargar' && !fin) location.reload();
  });
}

// Con la app abierta en primer plano, cada 5 minutos se mira si hay version
// nueva. iOS no ejecuta esto en segundo plano, pero mientras la miras, si.
setInterval(() => { if (!fin) D.autoActualizar(VERSION).catch(() => {}); }, 5 * 60 * 1000);

arrancar();
