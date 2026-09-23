// app/js/pantallas.js
//
// Las cuatro pestanas. El DOM se construye a mano: sin framework, como el resto
// del sistema, que no tiene una sola dependencia propia fuera del bot.

import * as D from './datos.js';
import { reescalarRestante, macrosDe } from './calorias.js';

// ─── ayudas de DOM ──────────────────────────────────────────────────────────

export function el(tag, props = {}, hijos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'texto') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const h of [].concat(hijos)) if (h) n.append(h);
  return n;
}
const ic = (id) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'ic');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#${id}`);
  s.append(u); return s;
};
const tarjeta = (...hijos) => el('div', { class: 'tarjeta' }, hijos.flat());
const vacio = (t) => el('p', { class: 'vacio', texto: t });
/**
 * La fecha de hoy, en local (no UTC: a las 00:30 en Espana toISOString() aun
 * dice ayer). Acepta ?hoy=AAAA-MM-DD para poder probar un dia concreto sin
 * tocar el reloj del movil.
 */
const hoyISO = () => {
  const forzada = new URLSearchParams(location.search).get('hoy');
  if (forzada && /^\d{4}-\d{2}-\d{2}$/.test(forzada)) return forzada;
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const num = (v, dec = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(dec).replace('.', ','));

/**
 * Lo que se puede elegir para un día: TODAS las sesiones que existen en el plan
 * de la semana, más CrossFit y descanso.
 *
 * Así «el lunes hago CrossFit en vez de pierna» o «hoy me apetece empuje» son
 * lo mismo: eliges otra sesión de la semana y aparece SU programa, con sus
 * ejercicios y sus pesos. Sin inventar nada: solo se ofrece lo que está escrito.
 */
export function opcionesDe(p) {
  const vistas = new Map();
  for (const d of p.plan.dias) {
    if (d.tipo !== 'gimnasio' || !d.ejercicios?.length) continue;
    const clave = d.titulo ?? d.dia;
    if (!vistas.has(clave)) vistas.set(clave, { id: `plan:${d.fecha}`, etiqueta: clave, tipo: 'gimnasio', fuente: d });
  }
  return [
    ...vistas.values(),
    { id: 'crossfit', etiqueta: 'CrossFit', tipo: 'crossfit', fuente: null },
    { id: 'descanso', etiqueta: 'Descanso', tipo: 'descanso', fuente: null },
  ];
}

/** La opción elegida para un día (o la que trae el plan). */
export function opcionDe(p, fecha) {
  const ops = opcionesDe(p);
  const guardada = estado.eleccion[fecha];
  if (guardada) {
    const o = ops.find((x) => x.id === guardada);
    if (o) return o;
  }
  const d = p.plan.dias.find((x) => x.fecha === fecha);
  if (!d) return ops[ops.length - 1];
  if (d.tipo === 'gimnasio' && d.ejercicios?.length) {
    return ops.find((o) => o.fuente?.fecha === fecha) ?? ops[0];
  }
  return ops.find((o) => o.tipo === d.tipo) ?? ops[ops.length - 1];
}

const DIAS_CORTOS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// ─── estado compartido entre pestanas ───────────────────────────────────────

export const estado = { paquete: null, eleccion: {}, refrescar: null };

const diaDe = (p, fecha) => p.plan.dias.find((d) => d.fecha === fecha) ?? null;

/** La modalidad vigente de un dia: la elegida si la hay, si no la del plan. */
export function modalidadDe(p, fecha) {
  return opcionDe(p, fecha).tipo;
}

/** El programa que toca ese dia: el del plan, o el de la sesion que se eligio. */
export function programaDe(p, fecha) {
  const o = opcionDe(p, fecha);
  const dia = diaDe(p, fecha);
  if (o.tipo !== 'gimnasio') {
    // El enfoque y la nota son de la sesion que el plan puso ESE dia. Si eliges
    // otra cosa no se arrastran: «SENTADILLA: 80, la tercera serie es la que se
    // mira» no pinta nada en un dia de CrossFit.
    const suyo = dia?.tipo === o.tipo;
    return {
      fecha, dia: dia?.dia, tipo: o.tipo, titulo: o.etiqueta,
      enfoque: suyo ? dia.enfoque : null,
      nota: suyo ? dia.nota : null,
      cintura: dia?.cintura ?? false,
      ejercicios: [], seriesPrevistas: 0, prestado: null,
    };
  }
  const f = o.fuente;
  return {
    ...dia,
    tipo: 'gimnasio',
    titulo: f.titulo,
    enfoque: f.enfoque,
    nota: f.nota,
    ejercicios: f.ejercicios,
    seriesPrevistas: f.seriesPrevistas,
    // Si la sesion viene de otro dia de la semana, se dice de donde.
    prestado: f.fecha !== fecha ? f.dia : null,
  };
}

/** Recalcula las dianas de la semana con lo que el usuario haya elegido. */
function dianas(p) {
  const o = p.nutricion?.orientacion;
  if (!o) return null;
  const publicado = new Map((o.publicado ?? []).map((d) => [d.fecha, d.kcal]));
  const dias = p.plan.dias.filter((d) => d.fecha).map((d) => {
    // Las series son las del programa ELEGIDO, no las del que traía el plan:
    // si cambias pierna (13 series) por tirón (18), la diana lo tiene que notar.
    const pr = programaDe(p, d.fecha);
    return {
      fecha: d.fecha,
      sesiones: pr.tipo === 'descanso' ? []
        : [{ modalidad: pr.tipo, series: pr.tipo === 'gimnasio' ? pr.seriesPrevistas : null }],
    };
  });
  const mediaSemanal = o.fase === 'medir' ? 2700 : null;   // lo fija la fase del repo
  return reescalarRestante(dias, o.parametros, { hoy: hoyISO(), publicado, mediaSemanal });
}

// ════════════════════════════════════════════════════════════════════════════
// HOY
// ════════════════════════════════════════════════════════════════════════════

export function pantallaHoy(p) {
  const fecha = hoyISO();
  const d = diaDe(p, fecha);
  const v = el('div');

  if (!d) {
    v.append(tarjeta(
      el('h2', { texto: 'Hoy no cae dentro del plan publicado' }),
      el('p', { class: 'muted', texto: `El paquete cargado es de la semana ${p.semana.iso} (${p.semana.desde} a ${p.semana.hasta}).` }),
      el('p', { class: 'muted', texto: 'El PC publica el plan nuevo cada domingo.' }),
    ));
    return v;
  }

  const prog = programaDe(p, fecha);
  const cambiado = prog.prestado || prog.tipo !== d.tipo;

  v.append(tarjeta(
    el('p', { class: 'sub', texto: `${d.dia} · ${p.semana.bloque ?? ''}`.trim() }),
    el('p', { class: 'grande', texto: prog.tipo === 'descanso' ? 'Descanso' : (prog.titulo ?? 'Sesión') }),
    prog.enfoque ? el('p', { class: 'muted', texto: prog.enfoque }) : null,
    cambiado
      ? el('p', { class: 'aviso', texto: `El plan decía ${d.titulo ?? d.tipo}. Se registrará lo que hagas de verdad, y la comida del día ya está recalculada.` })
      : null,
    el('p', { class: 'sub', texto: 'Para cambiarlo, o para ver otro día, ve a Entrenar.' }),
  ));

  // — la diana de hoy —
  const dd = dianas(p);
  const hoyDiana = dd?.dias.find((x) => x.fecha === fecha);
  const publicadaHoy = (p.nutricion.orientacion.publicado ?? []).find((x) => x.fecha === fecha)?.kcal;
  if (hoyDiana) {
    const m = p.nutricion.orientacion.macros;
    const macros = m ? macrosDe(hoyDiana.kcal, m) : null;
    const delta = publicadaHoy ? hoyDiana.kcal - publicadaHoy : 0;
    v.append(tarjeta(
      el('h2', { texto: 'Comer hoy' }),
      el('p', { class: 'grande mono', texto: `${hoyDiana.kcal} kcal` }),
      delta ? el('p', { class: 'muted', texto: `${delta > 0 ? '+' : ''}${delta} respecto a las ${publicadaHoy} del plan` }) : null,
      macros ? el('div', { class: 'rejilla' }, [
        baldosa('P', `${macros.proteina} g`, 'fijo'),
        baldosa('C', `${macros.carbos} g`, 'cicla'),
        baldosa('G', `${macros.grasa} g`, 'suelo'),
      ]) : el('p', { class: 'aviso', texto: 'Faltan los macros en referencias/gasto-diario.json: solo se puede dar la cifra de kcal.' }),
      el('p', { class: 'sub', texto: p.nutricion.orientacion.certeza }),
    ));
  }

  // — la pulsera —
  const ult = (a) => (a && a.length ? a[a.length - 1] : null);
  const s = ult(p.historico.sueno); const pa = ult(p.historico.pasos); const pe = ult(p.historico.peso);
  v.append(tarjeta(
    el('h2', { texto: 'De la pulsera' }),
    el('div', { class: 'rejilla' }, [
      baldosa('Sueño', s ? `${num(s.horas, 1)} h` : '—', s?.fecha ?? 'sin dato'),
      baldosa('Pasos', pa ? String(pa.pasos) : '—', pa?.fecha ?? 'sin dato'),
      baldosa('Peso', pe ? `${num(pe.peso, 1)} kg` : '—', pe?.fecha ?? 'sin dato'),
    ]),
    el('p', { class: 'sub', texto: 'Los pone la pulsera. La app no los toca.' }),
  ));

  if (d.cintura) {
    v.append(el('div', { class: 'aviso' }, el('span', { texto: 'Hoy toca medir cintura. Está en la pestaña Cuerpo.' })));
  }
  return v;
}

const baldosa = (k, v, sub) => el('div', { class: 'baldosa' }, [
  el('span', { class: 'v', texto: v }),
  el('span', { class: 'k', texto: k }),
  sub ? el('span', { class: 'k faint', texto: sub }) : null,
]);

// ════════════════════════════════════════════════════════════════════════════
// ENTRENAR
// ════════════════════════════════════════════════════════════════════════════

export async function pantallaEntrenar(p, api) {
  const v = el('div');
  const hoy = hoyISO();
  let ses = await D.sesionEnCurso();

  // Si hay una sesion empezada, manda ella: no se puede estar mirando el jueves
  // con el miercoles a medias.
  const fecha = ses ? ses.fecha : (estado.diaVisto ?? hoy);
  estado.diaVisto = fecha;

  // — la tira de la semana —
  const tira = el('div', { class: 'tira' });
  for (const d of p.plan.dias) {
    if (!d.fecha) continue;
    const pr = programaDe(p, d.fecha);
    const i = p.plan.dias.indexOf(d);
    tira.append(el('button', {
      class: 'dia', type: 'button',
      'aria-current': String(d.fecha === fecha),
      'data-hoy': String(d.fecha === hoy),
      'data-tipo': pr.tipo,
      disabled: !!ses && d.fecha !== fecha,
      onclick: () => { estado.diaVisto = d.fecha; estado.refrescar?.(); },
    }, [
      el('span', { class: 'dl', texto: DIAS_CORTOS[i] ?? d.dia.slice(0, 1) }),
      el('span', { class: 'dn', texto: d.fecha.slice(8) }),
      el('span', { class: 'punto' }),
    ]));
  }
  v.append(tira);

  const dia = diaDe(p, fecha);
  const prog = programaDe(p, fecha);
  const elegida = opcionDe(p, fecha);
  const esHoy = fecha === hoy;

  v.append(el('p', { class: 'sub', texto: `${dia?.dia ?? ''} ${fecha.slice(8, 10)}${esHoy ? ' · hoy' : ''}` }));

  // — elegir qué se hace ese día —
  if (!ses) {
    const chips = el('div', { class: 'chips' });
    for (const o of opcionesDe(p)) {
      const esDelPlan = o.fuente?.fecha === fecha
        || (o.tipo !== 'gimnasio' && dia?.tipo === o.tipo);
      chips.append(el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(o.id === elegida.id),
        onclick: async () => {
          estado.eleccion[fecha] = o.id;
          await D.set('eleccion', estado.eleccion);
          estado.refrescar?.();
        },
      }, [
        el('span', { texto: o.etiqueta }),
        esDelPlan ? el('span', { class: 'pista', texto: 'plan' }) : null,
      ]));
    }
    v.append(tarjeta(el('h3', { texto: 'Qué hago este día' }), chips));
  }

  // — la diana del día, que se mueve con lo que elijas —
  const dd = dianas(p);
  const dDia = dd?.dias.find((x) => x.fecha === fecha);
  const pub = (p.nutricion?.orientacion?.publicado ?? []).find((x) => x.fecha === fecha)?.kcal;
  if (dDia) {
    const delta = pub ? dDia.kcal - pub : 0;
    v.append(el('div', { class: 'linea-kcal' }, [
      el('span', { class: 'mediano mono', texto: `${dDia.kcal} kcal` }),
      el('span', { class: 'sub', texto: delta ? `${delta > 0 ? '+' : ''}${delta} sobre el plan` : 'como el plan' }),
    ]));
  }

  if (prog.tipo === 'descanso') {
    v.append(tarjeta(
      el('h2', { texto: 'Descanso' }),
      el('p', { class: 'muted', texto: 'No se recupera entrenando. Si vas a entrenar igual, elige arriba qué sesión.' }),
    ));
    return v;
  }

  // — arrancar la sesion —
  if (!ses || ses.fecha !== fecha) {
    v.append(tarjeta(
      el('h2', { texto: prog.titulo ?? 'Sesión' }),
      prog.tipo === 'gimnasio'
        ? el('p', { class: 'muted', texto: `${prog.seriesPrevistas ?? 0} series previstas` })
        : el('p', { class: 'muted', texto: 'El WOD se anota al terminar.' }),
      prog.prestado ? el('p', { class: 'sub', texto: `Es la sesión que el plan pone el ${prog.prestado.toLowerCase()}.` }) : null,
      prog.enfoque ? el('p', { class: 'muted', texto: prog.enfoque }) : null,
      prog.nota ? el('p', { class: 'aviso', texto: prog.nota }) : null,
      !esHoy ? el('p', { class: 'sub', texto: 'No es hoy: se registrará con la fecha de este día.' }) : null,
      el('button', {
        class: 'btn', type: 'button', texto: 'Empezar',
        onclick: async () => {
          await D.guardarSesion(nuevaSesion(p, prog, prog.tipo, fecha, dia));
          estado.refrescar?.();
        },
      }),
    ));
    return v;
  }

  // — la sesion en curso —
  v.append(el('p', { class: 'sub', texto: `${ses.titulo} · empezada a las ${ses.inicio.slice(11, 16)}` }));

  ses.ejercicios.forEach((e, iE) => {
    const ficha = p.catalogo.ejercicios[e.ejercicioId] ?? null;
    const uv = p.historico.ultimaVezPorEjercicio[e.ejercicioId];

    const cab = el('div', { class: 'ejercicio-cab' }, [
      el('div', {}, [
        el('h2', { texto: e.base ?? e.nombre }),
        el('div', { class: 'prescrito' }, [
          el('span', { texto: e.planeado ? `${e.planeado.series} × ${e.planeado.reps}` : 'libre' }),
          e.planeado?.pesoTexto ? el('span', { texto: `· ${e.planeado.pesoTexto}` }) : null,
          e.planeado?.rpeObjetivo ? el('span', { texto: `· RPE ${e.planeado.rpeObjetivo}` }) : null,
        ]),
        e.instruccion ? el('p', { class: 'sub', texto: e.instruccion }) : null,
      ]),
      ficha ? el('button', { class: 'btn-info', type: 'button', 'aria-label': 'Cómo se hace', onclick: () => api.hoja(fichaHTML(e, ficha)) }, ic('i-info')) : null,
    ]);

    const t = tarjeta(cab);

    if (uv) {
      t.append(el('div', { class: 'ultima-vez' }, el('span', {
        texto: `Última vez (${uv.fecha}): ${uv.series.map((x) => `${x.reps}×${num(x.kg, 1)}`).join('  ')}`
          + (uv.series[0]?.rpe ? `  @ RPE ${num(uv.series[0].rpe, 1)}` : ''),
      })));
    }

    const esTiempo = p.catalogo.ejercicios[e.ejercicioId]?.medida === 'segundos';
    const modo = p.catalogo.ejercicios[e.ejercicioId]?.carga?.modo;
    t.append(el('div', { class: 'serie cabecera' }, [
      el('span', { class: 'n', texto: '' }),
      el('span', { class: 'col', texto: esTiempo ? 'segundos' : 'reps' }),
      el('span', { class: 'col', texto: modo === 'porMancuerna' ? 'kg c/u' : (modo === 'lastre' ? 'kg lastre' : 'kg') }),
      el('span', { class: 'col', texto: '' }),
    ]));

    e.series.forEach((s, iS) => t.append(filaSerie(p, ses, e, s, iE, iS, api)));

    t.append(el('div', { class: 'btn-fila' }, [
      el('button', {
        class: 'btn sec', type: 'button', texto: '+ serie',
        onclick: async () => {
          const ant = e.series[e.series.length - 1];
          e.series.push({
            n: e.series.length + 1, tipo: 'trabajo',
            reps: ant?.reps ?? null, carga: { ...(ant?.carga ?? { valor: null, unidad: 'kg', modo: 'externa' }) },
            rpe: null, descansoSeg: null, completada: false, nota: '',
          });
          await D.guardarSesion(ses); estado.refrescar?.();
        },
      }),
      el('button', {
        class: 'btn sec', type: 'button', texto: e.omitido ? 'Recuperar' : 'No lo hago',
        onclick: async () => {
          e.omitido = e.omitido ? null : { motivo: 'saltado en la sesión' };
          await D.guardarSesion(ses); estado.refrescar?.();
        },
      }),
    ]));

    if (e.omitido) t.style.opacity = '.5';
    v.append(t);
  });

  // — anadir un ejercicio que no estaba —
  v.append(el('button', {
    class: 'btn sec', type: 'button', texto: '+ Añadir ejercicio',
    onclick: () => api.hoja(selectorEjercicio(p, async (id, ficha) => {
      ses.ejercicios.push({
        orden: ses.ejercicios.length + 1, ejercicioId: id, nombre: ficha.nombre, base: ficha.nombre,
        instruccion: null, origen: 'anadido', sustituyeA: null, planeado: null, omitido: null, nota: '',
        series: [{ n: 1, tipo: 'trabajo', reps: null, carga: { valor: null, unidad: 'kg', modo: ficha.carga.modo }, rpe: null, descansoSeg: null, completada: false, nota: '' }],
      });
      await D.guardarSesion(ses); api.cerrarHoja(); estado.refrescar?.();
    })),
  }));

  // — cerrar —
  v.append(tarjeta(
    el('h2', { texto: 'Al terminar' }),
    el('div', { class: 'rejilla' }, [
      campoNum('RPE sesión', ses.cierre.rpeGlobal, 0.5, 0, 10, async (x) => { ses.cierre.rpeGlobal = x; await D.guardarSesion(ses); }),
      campoNum('Fatiga', ses.cierre.fatigaPost, 1, 0, 10, async (x) => { ses.cierre.fatigaPost = x; await D.guardarSesion(ses); }),
    ]),
    el('h3', { texto: 'Observaciones' }),
    el('textarea', {
      placeholder: 'Lo que haga falta: molestias, cambios, cómo fue.',
      oninput: async (ev) => { ses.cierre.observaciones = ev.target.value; await D.guardarSesion(ses); },
    }, document.createTextNode(ses.cierre.observaciones ?? '')),
    el('button', {
      class: 'btn', type: 'button', texto: 'Cerrar sesión y enviar',
      onclick: async () => {
        if (ses.cierre.rpeGlobal === null || ses.cierre.fatigaPost === null) {
          if (!confirm('Falta el RPE de la sesión o la fatiga. Sin eso ninguna carga puede subir. ¿Cerrar igual?')) return;
        }
        ses.fin = new Date().toISOString();
        await D.encolar(ses);
        await D.cerrarSesion();
        api.aviso('Sesión guardada. Sube sola en cuanto haya señal.');
        estado.refrescar?.();
      },
    }),
  ));

  return v;
}

function nuevaSesion(p, prog, modo, fecha, diaPlan) {
  const d = prog;
  return {
    esquema: 'entreno.sesion/1',
    id: D.nuevoId('ses'),
    revision: 1,
    emitido: new Date().toISOString(),
    app: { version: '1.0.0' },
    fecha,
    semana: p.semana.iso,
    inicio: new Date().toISOString(),
    fin: null,
    plan: diaPlan
      ? {
        fuente: `estado/plan/semanas/${p.semana.iso}.entreno.json`,
        dia: diaPlan.dia,
        hoja: diaPlan.hoja,
        tipoPrevisto: diaPlan.tipo,
        tituloPrevisto: diaPlan.titulo,
      }
      : null,
    modalidad: modo,
    titulo: modo === 'crossfit' ? 'CrossFit' : (d?.titulo ?? 'Sesión'),
    // Cambio respecto a lo PLANIFICADO para ese dia, no respecto al programa que
    // se esta usando: es lo que hay que poder auditar despues.
    cambioDeModalidad: diaPlan && (modo !== diaPlan.tipo || (d?.titulo && d.titulo !== diaPlan.titulo))
      ? { de: diaPlan.titulo ?? diaPlan.tipo, a: d?.titulo ?? modo }
      : null,
    segundaDelDia: false,
    ejercicios: modo === 'crossfit' ? [] : (d?.ejercicios ?? []).map((e, i) => ({
      orden: i + 1,
      ejercicioId: e.id,
      nombre: e.nombre,
      base: e.base,
      instruccion: e.instruccion,
      origen: 'plan',
      sustituyeA: null,
      planeado: { series: e.series, reps: e.reps, peso: e.peso, pesoTexto: e.pesoTexto, rir: e.rir, rpeObjetivo: e.rpeObjetivo, descansoSeg: e.descansoSeg },
      omitido: null,
      nota: '',
      series: Array.from({ length: e.series ?? 1 }, (_, n) => ({
        n: n + 1,
        tipo: 'trabajo',
        reps: null,
        carga: { valor: e.peso, unidad: 'kg', modo: e.pesoModo ?? 'externa' },
        rpe: null,
        descansoSeg: null,
        completada: false,
        nota: '',
      })),
    })),
    wod: modo === 'crossfit' ? { nombre: '', esquema: '', escalado: '', cargas: '', resultado: null } : null,
    cierre: { rpeGlobal: null, fatigaPost: null, duracionMin: null, observaciones: '' },
  };
}

function filaSerie(p, ses, e, s, iE, iS, api) {
  const paso = (valor, step, onCambio, unidad) => {
    const inp = el('input', { type: 'number', inputmode: 'decimal', step: String(step), value: valor ?? '' });
    inp.addEventListener('change', () => onCambio(inp.value === '' ? null : Number(inp.value)));
    const ajusta = (dir) => {
      const base = inp.value === '' ? (valor ?? 0) : Number(inp.value);
      const nuevo = Math.max(0, Math.round((base + dir * step) * 100) / 100);
      inp.value = String(nuevo); onCambio(nuevo);
    };
    return el('div', { class: 'paso' }, [
      el('button', { type: 'button', 'aria-label': 'menos', onclick: () => ajusta(-1) }, ic('i-menos')),
      inp,
      unidad ? el('span', { class: 'uni', texto: unidad }) : null,
      el('button', { type: 'button', 'aria-label': 'más', onclick: () => ajusta(1) }, ic('i-mas')),
    ]);
  };

  const incremento = p.catalogo.ejercicios[e.ejercicioId]?.carga?.incrementoKg ?? 2.5;
  // La unidad NO va dentro del campo: en 390 px se comia el espacio y '82,5'
  // se veia como '82,'. Va en la cabecera de columna, una vez por ejercicio.

  const fila = el('div', { class: `serie${s.completada ? ' hecha' : ''}${s.tipo === 'calentamiento' ? ' calent' : ''}` }, [
    el('button', {
      class: 'n', type: 'button', texto: s.tipo === 'calentamiento' ? 'C' : String(s.n),
      title: 'Cambiar entre serie de trabajo y de calentamiento',
      onclick: async () => {
        s.tipo = s.tipo === 'calentamiento' ? 'trabajo' : 'calentamiento';
        await D.guardarSesion(ses); estado.refrescar?.();
      },
    }),
    paso(s.reps, 1, async (x) => { s.reps = x; await D.guardarSesion(ses); }, null),
    paso(s.carga.valor, incremento, async (x) => { s.carga.valor = x; await D.guardarSesion(ses); }, null),
    el('button', {
      class: 'ok', type: 'button', 'aria-label': 'Serie hecha',
      onclick: async () => {
        s.completada = !s.completada;
        await D.guardarSesion(ses);
        if (s.completada && e.planeado?.descansoSeg) {
          api.descanso(e.planeado.descansoSeg, `${e.base ?? e.nombre} · serie ${s.n}`);
        }
        estado.refrescar?.();
      },
    }, ic('i-check')),
  ]);
  return fila;
}

function campoNum(etiqueta, valor, step, min, max, onCambio) {
  const inp = el('input', { type: 'number', inputmode: 'decimal', step: String(step), min: String(min), max: String(max), value: valor ?? '' });
  inp.addEventListener('change', () => onCambio(inp.value === '' ? null : Number(inp.value)));
  return el('div', { class: 'baldosa' }, [
    el('div', { class: 'paso' }, inp),
    el('span', { class: 'k', texto: etiqueta }),
  ]);
}

function fichaHTML(e, f) {
  return el('div', {}, [
    el('h2', { texto: f.nombre }),
    el('p', { class: 'sub', texto: `${f.patron} · ${f.equipamiento.join(', ')}` }),
    el('h3', { texto: 'Cómo se hace' }),
    el('p', { texto: f.tecnica.como }),
    el('h3', { texto: 'Fallo típico' }),
    el('p', { texto: f.tecnica.fallo }),
    el('h3', { texto: 'Músculos' }),
    el('p', { class: 'muted', texto: `${f.musculos.principal.join(', ')}${f.musculos.secundario.length ? ' · y de apoyo: ' + f.musculos.secundario.join(', ') : ''}` }),
    f.notas ? el('p', { class: 'aviso', texto: f.notas }) : null,
    f.video?.url
      ? el('a', { class: 'btn', href: f.video.url, target: '_blank', rel: 'noopener', texto: 'Ver el vídeo' })
      : el('p', { class: 'aviso', texto: 'Vídeo pendiente. Se añade cuando esté comprobado: un enlace sin verificar es un dato inventado.' }),
  ]);
}

function selectorEjercicio(p, onElegir) {
  const lista = el('div');
  const busca = el('input', { type: 'search', placeholder: 'Buscar ejercicio…', class: 'paso' });
  const pinta = (filtro = '') => {
    lista.replaceChildren();
    for (const [id, f] of Object.entries(p.catalogo.ejercicios)) {
      if (filtro && !f.nombre.toLowerCase().includes(filtro.toLowerCase())) continue;
      lista.append(el('button', { class: 'btn sec', type: 'button', texto: f.nombre, onclick: () => onElegir(id, f) }));
    }
  };
  busca.addEventListener('input', () => pinta(busca.value));
  pinta();
  return el('div', {}, [el('h2', { texto: 'Añadir ejercicio' }), el('div', { class: 'paso' }, busca), lista]);
}

// ════════════════════════════════════════════════════════════════════════════
// COMER
// ════════════════════════════════════════════════════════════════════════════

export function pantallaComer(p) {
  const fecha = hoyISO();
  const v = el('div');
  const dd = dianas(p);
  const hoyD = dd?.dias.find((x) => x.fecha === fecha);
  const o = p.nutricion?.orientacion;

  if (!hoyD || !o) return el('div', {}, vacio('Sin orientación calórica publicada.'));

  const m = o.macros ? macrosDe(hoyD.kcal, o.macros) : null;
  const real = p.historico.nutricionReal.find((x) => x.fecha === fecha);

  v.append(tarjeta(
    el('h2', { texto: 'Diana de hoy' }),
    el('p', { class: 'grande mono', texto: `${hoyD.kcal} kcal` }),
    el('p', { class: 'muted', texto: `Entreno: ${hoyD.entreno} kcal · ${modalidadDe(p, fecha)}` }),
    m ? el('div', { class: 'rejilla' }, [
      baldosa('Proteína', `${m.proteina} g`, 'no cicla'),
      baldosa('Hidrato', `${m.carbos} g`, 'el que cicla'),
      baldosa('Grasa', `${m.grasa} g`, 'suelo'),
    ]) : null,
    real
      ? el('p', { class: 'muted', texto: `Llevas ${real.kcal} kcal · P ${real.proteina} g (de FatSecret, hasta la última sincronización).` })
      : el('p', { class: 'sub', texto: 'Lo comido llega por FatSecret cuando el PC sincroniza.' }),
  ));

  if (dd.restante !== null) {
    const quedan = dd.dias.filter((x) => !x.pasado).length;
    v.append(el('p', { class: 'aviso' }, el('span', {
      texto: `Fase de medición: la media de la semana tiene que quedarse clavada. Quedan ${quedan} días para repartir ${Math.round(dd.restante)} kcal.`,
    })));
  }

  const menu = p.nutricion.menu;
  const dm = menu?.dias?.find((x) => x.fecha === fecha) ?? null;
  if (!dm) {
    v.append(tarjeta(
      el('h2', { texto: 'Menú' }),
      el('p', { class: 'muted', texto: 'No hay menú publicado para esta semana. El PC lo genera el domingo.' }),
    ));
    return v;
  }

  for (const toma of ['desayuno', 'comida', 'cena']) {
    const c = dm.comidas?.[toma];
    if (!c) continue;
    v.append(tarjeta(
      el('h2', { texto: `${toma[0].toUpperCase()}${toma.slice(1)} · ${c.titulo ?? ''}` }),
      el('div', {}, (c.items ?? []).map(([id, g]) => el('div', { class: 'dato' }, [
        el('span', { texto: id }), el('span', { class: 'v', texto: `${g} g` }),
      ]))),
    ));
  }
  return v;
}

// ════════════════════════════════════════════════════════════════════════════
// CUERPO
// ════════════════════════════════════════════════════════════════════════════

export function pantallaCuerpo(p, api) {
  const fecha = hoyISO();
  const d = diaDe(p, fecha);
  const v = el('div');
  const ult = (a) => (a && a.length ? a[a.length - 1] : null);

  const enviar = async (kind, campo, valor, notas) => {
    if (valor === null || Number.isNaN(valor)) { api.aviso('Falta el número.'); return; }
    await D.encolar({
      esquema: 'entreno.metricas/1',
      id: D.nuevoId('met'),
      revision: 1,
      emitido: new Date().toISOString(),
      app: { version: '1.0.0' },
      fecha,
      registros: [{ kind, fecha, [campo]: valor, notas }],
    });
    api.aviso('Guardado. Sube solo en cuanto haya señal.');
    estado.refrescar?.();
  };

  // — peso —
  let peso = null;
  const pe = ult(p.historico.peso);
  v.append(tarjeta(
    el('h2', { texto: 'Peso de hoy' }),
    el('p', { class: 'sub', texto: 'En ayunas, tras orinar, antes de beber. Todos los días.' }),
    el('div', { class: 'paso' }, [
      el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: pe ? num(pe.peso, 1) : '85,0', oninput: (e) => { peso = e.target.value === '' ? null : Number(e.target.value); } }),
      el('span', { class: 'uni', texto: 'kg' }),
    ]),
    el('button', { class: 'btn', type: 'button', texto: 'Guardar peso', onclick: () => enviar('body', 'peso', peso, null) }),
    pe ? el('p', { class: 'sub', texto: `Último registrado: ${num(pe.peso, 1)} kg el ${pe.fecha}` }) : null,
  ));

  // — cintura —
  let c1 = null; let c2 = null;
  const cu = ult(p.historico.cintura);
  const tocaHoy = d?.cintura === true || new Date(`${fecha}T12:00`).getDay() === 1;
  const tc = tarjeta(
    el('h2', { texto: tocaHoy ? 'Cintura — hoy toca' : 'Cintura' }),
    el('p', { class: 'sub', texto: 'Lunes, en ayunas, tras orinar, de pie, al final de una espiración normal, a la altura del ombligo, cinta ceñida sin apretar.' }),
    el('p', { class: 'sub', texto: 'Dos medidas. Si difieren más de 0,5 cm, una tercera, y se anota la media.' }),
    el('div', { class: 'rejilla' }, [
      el('div', { class: 'paso' }, [el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: '1.ª', oninput: (e) => { c1 = e.target.value === '' ? null : Number(e.target.value); } }), el('span', { class: 'uni', texto: 'cm' })]),
      el('div', { class: 'paso' }, [el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: '2.ª', oninput: (e) => { c2 = e.target.value === '' ? null : Number(e.target.value); } }), el('span', { class: 'uni', texto: 'cm' })]),
    ]),
    el('button', {
      class: 'btn', type: 'button', texto: 'Guardar cintura',
      onclick: () => {
        if (c1 === null) { api.aviso('Falta la primera medida.'); return; }
        if (c2 !== null && Math.abs(c1 - c2) > 0.5) {
          api.aviso(`Las dos medidas difieren ${num(Math.abs(c1 - c2), 1)} cm, más de 0,5. Hazte una tercera y anota la media.`);
          return;
        }
        const media = c2 === null ? c1 : Math.round(((c1 + c2) / 2) * 10) / 10;
        enviar('cintura', 'cintura', media, c2 === null ? 'automedida (app), una sola medida' : 'automedida (app), media de 2');
      },
    }),
    cu
      ? el('p', { class: 'sub', texto: `Última: ${num(cu.cintura, 1)} cm el ${cu.fecha}` })
      : el('p', { class: 'aviso malo', texto: 'No hay ni una medida de cintura registrada. Es la entrada de dos frenos del lazo de control y de la condición para entrar en la fase Construir.' }),
  );
  if (tocaHoy) tc.style.borderColor = 'var(--aviso)';
  v.append(tc);

  return v;
}
