// app/js/datos.js
//
// Todo lo que entra y sale. Tres ideas y ninguna mas:
//
//   1. El movil es una COLA, no un archivo. iOS rechaza storage.persist(), asi
//      que nada vive aqui de forma definitiva: se escribe y se empuja en cuanto
//      hay senal. Lo definitivo esta en GitHub y en el PC.
//   2. Nada de lo que se toca durante una sesion necesita red. El paquete de la
//      semana se cachea entero; la sesion se guarda local a cada serie.
//   3. Una serie cerrada no se pierde aunque se cierre la app de golpe.

const DB = 'entreno';
const VER = 1;

let _db = null;
export function abrir() {
  if (_db) return _db;
  _db = new Promise((ok, err) => {
    const q = indexedDB.open(DB, VER);
    q.onupgradeneeded = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'id' });
    };
    q.onsuccess = () => ok(q.result);
    q.onerror = () => err(q.error);
  });
  return _db;
}

async function tx(store, modo, fn) {
  const db = await abrir();
  return new Promise((ok, err) => {
    const t = db.transaction(store, modo);
    const r = fn(t.objectStore(store));
    // OJO con el '??' aqui: cuando la clave no existe, r.result es undefined, y
    // 'r?.result ?? r' devolveria el propio IDBRequest, que es truthy. Eso hacia
    // pasar por paquete cacheado un objeto que no lo era.
    t.oncomplete = () => ok(r && typeof r === 'object' && 'result' in r ? r.result : r);
    t.onerror = () => err(t.error);
  });
}

export const get = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const set = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const del = (k) => tx('kv', 'readwrite', (s) => s.delete(k));

// ---------------------------------------------------------------------------
// Configuracion: el token vive SOLO aqui, en este movil. Nunca viaja.
// ---------------------------------------------------------------------------

export async function config() {
  return (await get('config')) ?? { repo: null, token: null, rama: 'master' };
}
export const guardarConfig = (c) => set('config', c);

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const API = 'https://api.github.com';

async function gh(ruta, opciones = {}) {
  const c = await config();
  if (!c.token || !c.repo) throw new Error('sin-token');
  const r = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...opciones.headers,
    },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = new Error(`GitHub ${r.status}: ${t.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  // El dispatch de un workflow responde 204 sin cuerpo: parsearlo reventaria.
  if (r.status === 204) return null;
  return r.json();
}

/**
 * Por que ha fallado la conexion, en cristiano.
 *
 * Importa distinguir dos casos que parecen el mismo: GitHub responde 404 (no
 * 403) cuando el token es valido pero NO alcanza ese repositorio, para no
 * revelar que existe. Sin esta distincion, «no se puede con ese token» puede
 * significar dos cosas opuestas y no sabes cual arreglar.
 */
export async function diagnosticar(token, repo) {
  const cab = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  let quien;
  try {
    const r = await fetch(`${API}/user`, { headers: cab });
    if (r.status === 401) return { ok: false, motivo: 'El token no es válido. Revisa que lo has copiado entero, sin espacios ni cortes.' };
    if (!r.ok) return { ok: false, motivo: `GitHub responde ${r.status} al comprobar el token.` };
    quien = (await r.json()).login;
  } catch {
    return { ok: false, motivo: 'No hay conexión con GitHub. Comprueba los datos o el wifi.' };
  }

  const r2 = await fetch(`${API}/repos/${repo}`, { headers: cab });
  if (r2.status === 404) {
    return {
      ok: false,
      motivo: `El token es de ${quien} y funciona, pero no alcanza «${repo}». `
        + 'Si es un token fine-grained: en Repository access elige «Only select repositories» y marca ENTRENAMIENTO, '
        + 'y en Permissions → Repository permissions pon Contents en «Read and write».',
    };
  }
  if (r2.status === 403) return { ok: false, motivo: `El token es de ${quien} pero GitHub deniega el acceso (403).` };
  if (!r2.ok) return { ok: false, motivo: `GitHub responde ${r2.status} al leer el repositorio.` };

  const j = await r2.json();
  if (!j.permissions?.push) {
    return { ok: false, motivo: `El token de ${quien} solo puede LEER «${repo}». Necesita Contents: Read and write para guardar las series.` };
  }
  return { ok: true, motivo: `Token de ${quien}, con permiso de escritura sobre ${repo}.` };
}

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const deB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

export async function leerDelRepo(ruta) {
  const c = await config();
  const j = await gh(`/repos/${c.repo}/contents/${ruta}?ref=${c.rama}`);
  return JSON.parse(deB64(j.content));
}

export async function escribirEnRepo(ruta, texto, mensaje) {
  const c = await config();
  let sha;
  try {
    sha = (await gh(`/repos/${c.repo}/contents/${ruta}?ref=${c.rama}`)).sha;
  } catch { /* no existe: es un alta */ }
  return gh(`/repos/${c.repo}/contents/${ruta}`, {
    method: 'PUT',
    body: JSON.stringify({ message: mensaje, content: b64(texto), branch: c.rama, ...(sha ? { sha } : {}) }),
  });
}

// ---------------------------------------------------------------------------
// Disparar la pulsera desde el movil
// ---------------------------------------------------------------------------

/**
 * Pide a GitHub Actions que traiga la pulsera (pulsera.yml) y espera a que
 * termine. No hace falta el PC: la sincronizacion corre en los servidores de
 * GitHub con la configuracion de Google guardada como secreto.
 *
 * Devuelve cuando el trabajo acaba (bien o mal) o a los ~3 minutos. Lo que
 * sigue es volver a pedir el paquete, que ya traera los datos nuevos.
 */
export async function actualizarPulsera(onEstado = () => {}) {
  // Se pide escribiendo un fichero: el push dispara pulsera.yml. Con eso basta
  // el permiso «Contents» que ya tiene el token; no hace falta «Actions», que
  // es lo que fallaba con un token fine-grained minimo.
  const pedido = new Date().toISOString();
  const antes = await indiceGenerado();
  try {
    await escribirEnRepo('entrada/pulsera/pedir.json',
      `${JSON.stringify({ pedido, desde: 'app' }, null, 1)}\n`, `app: pedir pulsera ${pedido}`);
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      throw new Error('Tu token no puede escribir en el repositorio. Necesita «Contents: Read and write» sobre ENTRENAMIENTO.');
    }
    throw e;
  }
  onEstado('Pedido a GitHub. Suele tardar un minuto…');

  // Cuando la sincronizacion termina, republica el paquete: el indice cambia
  // de fecha de generacion. Eso se puede leer con el mismo permiso, asi que es
  // la senal de «terminado» sin tocar la API de Actions.
  const inicio = Date.now();
  let vueltas = 0;
  while (Date.now() - inicio < 240000) {
    await new Promise((r) => setTimeout(r, 8000));
    vueltas++;
    let ahora = null;
    try { ahora = await indiceGenerado(); } catch { /* red floja: se reintenta */ }
    if (ahora && ahora !== antes && ahora > pedido) return { generado: ahora };
    onEstado(vueltas < 4 ? 'En cola en GitHub…' : 'Trayendo datos de Google Health…');
  }
  throw new Error('Sigue corriendo. Los datos aparecerán en la siguiente actualización.');
}

async function indiceGenerado() {
  const c = await config();
  if (!(c.token && c.repo)) throw new Error('sin-token');
  return (await leerDelRepo('derivado/app/indice.json')).generado ?? null;
}

// ---------------------------------------------------------------------------
// El paquete de la semana
// ---------------------------------------------------------------------------

/**
 * En desarrollo (servido desde el propio repo) se lee el fichero de al lado.
 * En el movil se lee de GitHub. Si no hay red, el que este cacheado.
 *
 * Nunca falla por no tener red: si hay copia, se usa la copia y se dice desde
 * cuando es. Un dato viejo etiquetado es util; uno viejo disfrazado de fresco, no.
 */
/**
 * El paquete de la semana, SIEMPRE al día.
 *
 * Primero se mira el índice, que pesa 130 bytes: dice qué semana es la actual y
 * cuándo se generó. Si algo cambió —plan nuevo del domingo, sesión ingerida por
 * Actions, cargas recalculadas— se baja el paquete entero antes de pintar. Si no
 * cambió, se usa la copia y no se gasta ni una petición de más.
 *
 * Sin red se usa la copia y se dice que es copia. Un dato viejo etiquetado sirve;
 * uno viejo disfrazado de fresco, no.
 */
export async function paquete({ forzarRed = false } = {}) {
  const cache = await get('paquete');

  if (cache && !forzarRed) {
    if (!navigator.onLine) return { ...cache, _origen: 'cache' };
    try {
      const idx = await indice();
      const alDia = idx.semanaActual === cache.semana?.iso && idx.generado === cache._indice;
      if (alDia) return { ...cache, _origen: 'cache' };
    } catch {
      return { ...cache, _origen: 'cache' };       // sin red: la copia vale
    }
  }

  try {
    const p = await descargarPaquete();
    await set('paquete', p);
    return { ...p, _origen: 'red' };
  } catch (e) {
    if (cache) return { ...cache, _origen: 'cache', _errorRed: e.message };
    throw e;
  }
}

async function indice() {
  const c = await config();
  if (c.token && c.repo) return leerDelRepo('derivado/app/indice.json');
  return (await fetch('../derivado/app/indice.json', { cache: 'no-store' })).json();
}

async function descargarPaquete() {
  const c = await config();
  const idx = await indice();
  const p = (c.token && c.repo)
    ? await leerDelRepo(`derivado/app/${idx.semanaActual}.json`)
    // Modo local: la app servida desde el repo, sin token. Para construir y probar.
    : await (await fetch(`../derivado/app/${idx.semanaActual}.json`, { cache: 'no-store' })).json();
  p._indice = idx.generado;                        // la huella con la que se compara
  return p;
}

/**
 * ¿Hay una versión nueva de la app publicada?
 *
 * version.json se pide siempre saltándose la caché. Si no coincide con la que
 * está corriendo, se borran las cachés y se recarga UNA vez. Sin esto, un móvil
 * con la app instalada puede quedarse meses con una versión vieja y no hay forma
 * de saberlo desde fuera.
 */
export async function autoActualizar(versionActual) {
  if (!navigator.onLine) return false;
  let remota;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return false;
    remota = (await r.json()).version;
  } catch { return false; }
  if (!remota || remota === versionActual) return false;

  // Candado: si tras recargar sigue sin coincidir, no se entra en bucle.
  try {
    if (sessionStorage.getItem('recargadoPara') === remota) return false;
    sessionStorage.setItem('recargadoPara', remota);
  } catch { /* sin sessionStorage se recarga una vez y ya */ }

  try {
    for (const k of await caches.keys()) await caches.delete(k);
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch { /* da igual: la recarga ya trae lo nuevo */ }
  location.reload();
  return true;
}


// ---------------------------------------------------------------------------
// La cola de salida
// ---------------------------------------------------------------------------

const listeners = new Set();
export const alCambiarCola = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const avisar = async () => { const n = await pendientes(); for (const f of listeners) f(n); };

export const pendientes = () => tx('cola', 'readonly', (s) => s.count());
export const colaEntera = () => tx('cola', 'readonly', (s) => s.getAll());

/** Encola un sobre. La ruta es donde acabara dentro del repo. */
export async function encolar(sobre) {
  const mes = (sobre.fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  const ruta = `entrada/app/${mes}/${sobre.id}.json`;
  await tx('cola', 'readwrite', (s) => s.put({ id: sobre.id, ruta, sobre, intentos: 0 }));
  await avisar();
  vaciar();
  return ruta;
}

let vaciando = false;
/**
 * Empuja lo pendiente. Se llama al arrancar, al volver la red y tras cada
 * sobre. Un fallo NO borra nada: se reintenta a la siguiente.
 */
export async function vaciar() {
  if (vaciando || !navigator.onLine) return { subidos: 0, quedan: await pendientes() };
  const c = await config();
  if (!c.token || !c.repo) return { subidos: 0, quedan: await pendientes(), motivo: 'sin-token' };

  vaciando = true;
  let subidos = 0;
  try {
    for (const item of await colaEntera()) {
      try {
        await escribirEnRepo(item.ruta, `${JSON.stringify(item.sobre, null, 1)}\n`,
          `app: ${item.sobre.esquema} ${item.sobre.id}`);
        await tx('cola', 'readwrite', (s) => s.delete(item.id));
        subidos++;
      } catch (e) {
        // Se queda en la cola con la cuenta de intentos. No se pierde.
        await tx('cola', 'readwrite', (s) => s.put({ ...item, intentos: item.intentos + 1, ultimoError: e.message }));
      }
    }
  } finally {
    vaciando = false;
    await avisar();
  }
  return { subidos, quedan: await pendientes() };
}

addEventListener('online', () => vaciar());

// ---------------------------------------------------------------------------
// La sesion en curso
// ---------------------------------------------------------------------------

/**
 * Las sesiones abiertas van por FECHA, no una sola.
 *
 * Así se puede mirar el jueves con el miércoles a medias sin perder una serie:
 * cada día guarda lo suyo y se recupera al volver. Antes había una única clave
 * 'sesion' y navegar a otro día la habría pisado.
 */
const TODAS = 'sesiones';

export async function sesiones() { return (await get(TODAS)) ?? {}; }
export async function sesionEnCurso(fecha) {
  const t = await sesiones();
  if (fecha) return t[fecha] ?? null;
  // Sin fecha: la que esté abierta, si solo hay una.
  const abiertas = Object.values(t);
  return abiertas.length === 1 ? abiertas[0] : null;
}
export async function guardarSesion(s) {
  const t = await sesiones();
  t[s.fecha] = s;
  return set(TODAS, t);
}
export async function cerrarSesion(fecha) {
  const t = await sesiones();
  delete t[fecha];
  return set(TODAS, t);
}

/** Migración desde la clave única antigua. Se hace una vez y en silencio. */
export async function migrarSesionVieja() {
  const vieja = await get('sesion');
  if (!vieja?.fecha) return;
  await guardarSesion(vieja);
  await del('sesion');
}

export function nuevoId(prefijo) {
  const t = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const r = Math.random().toString(16).slice(2, 6);
  return `${prefijo}_${t}_${r}`;
}
