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
// EL FOLIO: la semana explicada
// ════════════════════════════════════════════════════════════════════════════

/** Insignia de tendencia. 'sin muestra' NO es un fallo: es el estado honesto. */
export function insignia(t) {
  if (!t || t.estado === 'sin muestra') {
    return el('span', {
      class: 'ins sin', title: `Hacen falta ${t?.faltan ?? 5} sesiones más de este ejercicio`,
      texto: `sin muestra · n=${t?.n ?? 0}`,
    });
  }
  const txt = { subiendo: '↑ subiendo', estancado: '→ estancado', bajando: '↓ cayendo' }[t.estado];
  return el('span', {
    class: `ins ${t.estado}`, title: `${t.cambioPct > 0 ? '+' : ''}${t.cambioPct} % por sesión sobre ${t.n} sesiones`,
    texto: txt,
  });
}

export function pantallaSemana(p) {
  const v = el('div');
  const f = p.analisis?.fase;
  const a = p.analisis ?? {};

  v.append(el('h2', { texto: `Semana ${p.semana.iso}` }));
  v.append(el('p', { class: 'sub', texto: p.semana.fechas ?? '' }));
  if (p.semana.bloque) v.append(el('p', { class: 'mediano', texto: p.semana.bloque }));

  // — en qué fase estás y qué significa para lo duro que hay que ir —
  v.append(el('h3', { texto: 'Fase del ciclo' }));
  if (!f) {
    v.append(el('p', { class: 'aviso', texto: 'No hay ninguna fase definida que cubra estas fechas.' }));
  } else if (f.vigente) {
    v.append(el('p', {}, el('b', { texto: f.nombre })));
    v.append(el('p', { class: 'muted', texto: `Del ${f.desde} al ${f.hasta ?? 'sin fecha de fin'}.` }));
    if (f.mediaSemanal) {
      v.append(el('p', { class: 'aviso', texto: `La media semanal está atada a ${f.mediaSemanal} kcal. Los días ciclan, la media no se mueve: si se mueve, la medición no mide nada.` }));
    }
  } else {
    v.append(el('p', {}, el('b', { texto: `Empieza «${f.nombre}» en ${f.diasPara} días` })));
    v.append(el('p', { class: 'muted', texto: `Del ${f.desde} al ${f.hasta ?? '—'}. Hasta entonces no hay fase que ate la media semanal.` }));
  }

  // — cómo de fuerte hay que ir —
  const conRir = p.plan.dias.flatMap((d) => d.ejercicios ?? []).filter((e) => e.rpeObjetivo && e.rpeObjetivo !== '—');
  if (conRir.length) {
    const rpes = [...new Set(conRir.map((e) => e.rpeObjetivo))].sort();
    v.append(el('h3', { texto: 'Cómo de fuerte ir' }));
    v.append(el('p', {}, el('b', { texto: `RPE ${rpes.join(' · ')}` })));
    v.append(el('p', { class: 'muted', texto: 'RPE 8 = te quedaban 2 repeticiones. RPE 10 = ni una más. Lo que no se anota no puede subir de peso la semana siguiente.' }));
  }

  // — qué se espera obtener: el contrato del plan —
  if (p.contrato) {
    v.append(el('h3', { texto: 'Qué se espera de esta semana' }));
    if (p.contrato.peso) v.append(el('p', { class: 'muted', texto: p.contrato.peso }));
    for (const m of p.contrato.medir ?? []) {
      v.append(el('div', { class: 'dato' }, [
        el('span', { texto: m.que }), el('span', { class: 'v', texto: m.espero }),
      ]));
    }
    if (p.contrato.decisiones?.length) {
      v.append(el('h3', { texto: 'Qué se decide con el resultado' }));
      for (const d of p.contrato.decisiones) {
        v.append(el('p', { class: 'muted' }, el('span', { texto: `Si ${d.si} → ${d.entonces}` })));
      }
    }
  }

  // — dónde mejorar, mirando atrás de verdad —
  v.append(el('h3', { texto: 'Dónde hay que mejorar' }));
  const flojos = Object.entries(a.porEjercicio ?? {})
    .filter(([, x]) => x.tendencia.estado === 'bajando' || x.tendencia.estado === 'estancado');
  const sinMuestra = Object.values(a.porEjercicio ?? {}).filter((x) => x.tendencia.estado === 'sin muestra').length;

  for (const c of p.cargas ?? []) {
    if (!c.motivo) continue;
    v.append(el('div', { class: 'dato' }, [
      el('span', { texto: c.ejercicio }), el('span', { class: 'v', texto: c.ahora ?? '' }),
    ]));
    v.append(el('p', { class: 'sub', texto: c.motivo }));
  }

  if (flojos.length) {
    v.append(el('p', { texto: 'Con historial suficiente y sin avanzar:' }));
    for (const [id, x] of flojos) {
      v.append(el('div', { class: 'dato' }, [
        el('span', { texto: p.catalogo.ejercicios[id]?.nombre ?? id }), insignia(x.tendencia),
      ]));
    }
  }
  if (sinMuestra) {
    v.append(el('p', { class: 'aviso', texto: `${sinMuestra} ejercicios no tienen todavía 5 sesiones registradas, así que de esos no se puede decir si progresas. Es lo que más te falta ahora mismo: registrar.` }));
  }

  const ses = (a.sesiones ?? []).slice(0, 6);
  if (ses.length) {
    v.append(el('h3', { texto: 'Últimas sesiones' }));
    for (const s of ses) {
      v.append(el('div', { class: 'dato' }, [
        el('span', { texto: `${s.fecha} · ${(s.titulo ?? '').split('·').pop().trim()}` }),
        el('span', { class: 'v', texto: `${s.series ?? '—'} series${s.rpe ? ` · RPE ${num(s.rpe, 1)}` : ''}` }),
      ]));
    }
  }

  if (p.notaResumen) {
    v.append(el('h3', { texto: 'Lo que decide el domingo' }));
    v.append(el('p', { class: 'muted', texto: String(p.notaResumen).replace(/\*\*/g, '').slice(0, 700) }));
  }
  return v;
}

// ════════════════════════════════════════════════════════════════════════════
// HOY
// ════════════════════════════════════════════════════════════════════════════

export function pantallaHoy(p, api) {
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
    el('p', { class: 'sub', texto: 'Para cambiarlo, o para ver otro día, ve a Entreno.' }),
  ));

  // — la diana de hoy, y cuánto llevas comido contra ella —
  const dd = dianas(p);
  const hoyDiana = dd?.dias.find((x) => x.fecha === fecha);
  const publicadaHoy = (p.nutricion.orientacion.publicado ?? []).find((x) => x.fecha === fecha)?.kcal;
  if (hoyDiana) {
    const m = p.nutricion.orientacion.macros;
    const macros = m ? macrosDe(hoyDiana.kcal, m) : null;
    const delta = publicadaHoy ? hoyDiana.kcal - publicadaHoy : 0;
    const comido = (p.historico.nutricionReal ?? []).find((x) => x.fecha === fecha) ?? null;
    v.append(tarjeta(
      el('h2', { texto: 'Comer hoy' }),
      el('p', { class: 'grande mono', texto: `${hoyDiana.kcal} kcal` }),
      delta ? el('p', { class: 'muted', texto: `${delta > 0 ? '+' : ''}${delta} respecto a las ${publicadaHoy} del plan` }) : null,
      barraKcal(comido?.kcal ?? null, hoyDiana.kcal, macros, comido),
      macros ? el('div', { class: 'rejilla' }, [
        baldosa('P', `${macros.proteina} g`, 'fijo'),
        baldosa('C', `${macros.carbos} g`, 'cicla'),
        baldosa('G', `${macros.grasa} g`, 'suelo'),
      ]) : el('p', { class: 'aviso', texto: 'Faltan los macros en referencias/gasto-diario.json: solo se puede dar la cifra de kcal.' }),
      el('p', { class: 'sub', texto: p.nutricion.orientacion.certeza }),
    ));
  }

  // — pasos: los de hoy, y la banda que el cálculo de calorías da por supuesta —
  const ult = (a) => (a && a.length ? a[a.length - 1] : null);
  const banda = p.analisis?.pasos?.banda ?? null;
  const pasosSemana = (p.historico.pasos ?? []).filter((x) => x.fecha >= p.semana.desde && x.fecha <= p.semana.hasta);
  const sumaSem = pasosSemana.reduce((a, x) => a + (x.pasos ?? 0), 0);
  const pa = ult(p.historico.pasos);
  const deHoy = (p.historico.pasos ?? []).find((x) => x.fecha === fecha);

  const tarjPasos = tarjeta(
    el('h2', { texto: 'Pasos' }),
    el('p', { class: 'grande mono', texto: deHoy ? String(deHoy.pasos) : (pa ? String(pa.pasos) : '—') }),
    el('p', { class: 'sub', texto: deHoy ? 'de hoy' : (pa ? `último dato: ${pa.fecha}` : 'sin dato') }),
  );
  if (banda) {
    const refDia = deHoy?.pasos ?? null;
    tarjPasos.append(el('div', { class: 'rejilla' }, [
      baldosa('Día', `${banda[0] / 1000}-${banda[1] / 1000}k`, 'lo que supone el cálculo'),
      baldosa('Semana', `${Math.round((banda[0] * 7) / 1000)}-${Math.round((banda[1] * 7) / 1000)}k`, `llevas ${Math.round(sumaSem / 1000)}k en ${pasosSemana.length} días`),
    ]));
    tarjPasos.append(el('p', { class: 'sub', texto: p.analisis.pasos.nota }));
    if (refDia !== null && refDia < banda[0] * 0.6) {
      tarjPasos.append(el('p', { class: 'aviso', texto: 'Muy por debajo de la banda. Un día suelto no dice nada; varios seguidos sí, y entonces la diana de calorías queda alta.' }));
    }
  }
  v.append(tarjPasos);

  // — el resto de la pulsera, y el boton para traerla sin PC —
  const s = ult(p.historico.sueno); const pe = ult(p.historico.peso);
  // La hora de la ultima sincronizacion, visible: sin esto «no esta actualizada»
  // no se puede distinguir de «la pulsera aun no ha volcado a Google Health».
  const gen = p.generado ? new Date(p.generado) : null;
  const hora = gen ? gen.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'desconocida';
  const estadoBtn = el('p', { class: 'sub', texto: `Sincronizado el ${hora}. Los pone la pulsera; la app no los toca.` });
  const btnPulsera = el('button', {
    class: 'btn sec', type: 'button', texto: 'Actualizar pulsera',
    onclick: async () => {
      btnPulsera.disabled = true;
      try {
        await D.actualizarPulsera((t) => { estadoBtn.textContent = t; });
        estadoBtn.textContent = 'Listo. Cargando los datos nuevos…';
        estado.paquete = await D.paquete({ forzarRed: true });
        api.aviso('Pulsera actualizada.');
        estado.refrescar?.();
      } catch (e) {
        estadoBtn.textContent = e.message;
        btnPulsera.disabled = false;
      }
    },
  });
  v.append(tarjeta(
    el('h2', { texto: 'De la pulsera' }),
    el('div', { class: 'rejilla' }, [
      baldosa('Sueño', s ? `${num(s.horas, 1)} h` : '—', s?.fecha ?? 'sin dato'),
      baldosa('Peso', pe ? `${num(pe.peso, 1)} kg` : '—', pe?.fecha ?? 'sin dato'),
    ]),
    btnPulsera,
    estadoBtn,
  ));

  // — el resumen del día, con lo que hay escrito, sin inventar nada —
  const resumen = [];
  if (prog.tipo === 'descanso') resumen.push('Hoy no se entrena.');
  else resumen.push(`${prog.titulo}${prog.seriesPrevistas ? `, ${prog.seriesPrevistas} series` : ''}.`);
  if (hoyDiana) resumen.push(`Comes ${hoyDiana.kcal} kcal.`);
  if (d.cintura) resumen.push('Toca medir cintura.');
  const faltan = [];
  if (!(p.historico.peso ?? []).some((x) => x.fecha === fecha)) faltan.push('el peso de hoy');
  if (d.cintura && !(p.historico.cintura ?? []).some((x) => x.fecha === fecha)) faltan.push('la cintura');
  v.append(tarjeta(
    el('h2', { texto: 'En una línea' }),
    el('p', { texto: resumen.join(' ') }),
    faltan.length
      ? el('p', { class: 'aviso', texto: `Falta por registrar: ${faltan.join(' y ')}. Está en Análisis → Medidas.` })
      : el('p', { class: 'sub', texto: 'No falta nada por registrar hoy.' }),
  ));
  return v;
}

/**
 * Comido contra diana, con lo que queda o lo que sobra en CANTIDAD, no en %.
 * «Te faltan 340 kcal» se entiende con la barra cargada delante; «84 %», no.
 * Sin dato de FatSecret se dice que no hay dato: la barra vacia no es «0 kcal».
 */
function barraKcal(comido, diana, macros, comidoObj) {
  if (comido === null || !diana) {
    return el('p', { class: 'sub', texto: 'Lo comido llega por FatSecret cuando se sincroniza la pulsera.' });
  }
  const resto = diana - comido;
  const pct = Math.min(100, Math.round((comido / diana) * 100));
  const pasado = resto < 0;
  const w = el('div', { class: 'kcal-barra' }, [
    el('div', { class: `kcal-relleno${pasado ? ' pasado' : ''}`, style: `width:${pct}%` }),
  ]);
  const linea = el('div', { class: 'kcal-linea' }, [
    el('span', { class: 'mediano mono', texto: `${comido}` }),
    el('span', { class: 'sub', texto: ` de ${diana} kcal` }),
    el('span', { class: `kcal-resto${pasado ? ' pasado' : ''}`, texto: pasado ? `+${-resto} de más` : `quedan ${resto}` }),
  ]);
  const wrap = el('div', { class: 'kcal' }, [linea, w]);
  if (macros && comidoObj) {
    const fila = (k, real, obj) => {
      const d = real - obj;
      return el('span', { class: 'kcal-macro', texto: `${k} ${real}/${obj} g${Math.abs(d) >= 10 ? ` (${d > 0 ? '+' : ''}${d})` : ''}` });
    };
    wrap.append(el('div', { class: 'kcal-macros' }, [
      fila('P', comidoObj.proteina ?? 0, macros.proteina),
      fila('C', comidoObj.carbos ?? 0, macros.carbos),
      fila('G', comidoObj.grasa ?? 0, macros.grasa),
    ]));
  }
  return wrap;
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
  const abiertas = await D.sesiones();

  // El dia que se esta mirando es libre: se puede ir al jueves con el miercoles
  // a medias. Cada dia guarda LO SUYO, asi que nada se pierde al navegar.
  const fecha = estado.diaVisto ?? hoy;
  estado.diaVisto = fecha;
  const ses = abiertas[fecha] ?? null;

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
      'data-abierta': String(!!abiertas[d.fecha]),
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

  const otras = Object.keys(abiertas).filter((f) => f !== fecha);
  if (otras.length) {
    v.append(el('p', { class: 'aviso', texto: `Tienes otra sesión a medias (${otras.join(', ')}). No se pierde nada: cada día guarda lo suyo y sigue donde lo dejaste.` }));
  }

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

    // Progresando, estancado o cayendo. Con n<5 dice «sin muestra», que es lo
    // honesto: con tres puntos no se declara una tendencia.
    const an = p.analisis?.porEjercicio?.[e.ejercicioId];
    if (an) t.append(el('div', { class: 'fila-ins' }, insignia(an.tendencia)));

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

    // Quitar la última serie. Si tiene datos o está marcada, se pregunta: una
    // serie registrada es un dato, y un dato no se borra por un toque de más.
    const ultima = e.series[e.series.length - 1];
    const tieneDatos = !!ultima && (ultima.completada || ultima.reps !== null || ultima.nota);

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
        class: 'btn sec', type: 'button', texto: '− serie',
        disabled: e.series.length <= 1,
        title: e.series.length <= 1 ? 'Para no hacer el ejercicio, usa «No lo hago»' : 'Quita la última serie',
        onclick: async () => {
          if (tieneDatos) {
            const q = ultima.completada
              ? `La serie ${ultima.n} está marcada como hecha${ultima.reps ? ` (${ultima.reps} reps)` : ''}. ¿La quito igual?`
              : `La serie ${ultima.n} tiene datos escritos. ¿La quito igual?`;
            if (!confirm(q)) return;
          }
          e.series.pop();
          // Renumerar, o la tabla de la sesión saldría con huecos en «Serie».
          e.series.forEach((s, i) => { s.n = i + 1; });
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
        await D.cerrarSesion(ses.fecha);
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

/** Pendiente de una serie temporal, en unidades por semana. Null si n<5. */
function pendienteSemanal(puntos, campo) {
  const xs = puntos.filter((x) => x[campo] !== null && x[campo] !== undefined);
  if (xs.length < 5) return { n: xs.length, porSemana: null };
  const t0 = Date.parse(xs[0].fecha);
  const dias = xs.map((x) => (Date.parse(x.fecha) - t0) / 86400000);
  const ys = xs.map((x) => Number(x[campo]));
  const mx = dias.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / xs.length;
  let num = 0; let den = 0;
  dias.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return { n: xs.length, porSemana: den ? (num / den) * 7 : 0, desde: xs[0].fecha, hasta: xs[xs.length - 1].fecha };
}

/**
 * Analisis: un menu vertical de tarjetas, cada una con su dato vivo, que abre
 * su seccion. Sin seccion elegida se ve el menu; dentro, una cabecera con
 * «volver». El dato de cada tarjeta es el resumen honesto de lo que hay, no
 * decoracion: si no hay cintura, la tarjeta lo dice.
 */
export function pantallaAnalisis(p, api) {
  const v = el('div');
  const a = p.analisis ?? {};
  const sec = estado.seccionAnalisis ?? null;
  const ult = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

  const pe = ult(p.historico.peso); const cu = ult(p.historico.cintura);
  const ej = Object.values(a.porEjercicio ?? {});
  const conTend = ej.filter((x) => x.tendencia.estado !== 'sin muestra').length;
  const ses = a.sesiones ?? [];
  const sinRpe = ses.filter((s) => s.rpe === null).length;
  const real = (p.historico.nutricionReal ?? []).slice(-14);
  const mediaKcal = real.length ? Math.round(real.reduce((x, d) => x + (d.kcal ?? 0), 0) / real.length) : null;

  const SECCIONES = [
    { id: 'medidas', titulo: 'Medidas', icono: 'i-cuerpo',
      dato: pe ? `${num(pe.peso, 1)} kg` : '—',
      pie: cu ? `cintura ${num(cu.cintura, 1)} cm · ${cu.fecha}` : 'cintura sin medir todavía',
      alerta: !cu },
    { id: 'peso', titulo: 'Peso', icono: 'i-analisis',
      dato: pe ? `${num(pe.peso, 1)} kg` : '—',
      pie: `${(p.historico.peso ?? []).length} pesadas en el histórico` },
    { id: 'fuerza', titulo: 'Fuerza', icono: 'i-entrenar',
      dato: `${ej.length} ejercicios`,
      pie: conTend ? `${conTend} con tendencia` : 'ninguno con 5 sesiones aún',
      alerta: ej.length > 0 && !conTend },
    { id: 'sesiones', titulo: 'Sesiones', icono: 'i-folio',
      dato: `${ses.length} registradas`,
      pie: sinRpe ? `${sinRpe} sin RPE` : 'todas con RPE',
      alerta: sinRpe > 0 },
    { id: 'comida', titulo: 'Comida', icono: 'i-comer',
      dato: mediaKcal ? `${mediaKcal} kcal` : '—',
      pie: real.length ? `media de ${real.length} días, FatSecret` : 'sin datos de FatSecret' },
  ];

  if (!sec) {
    const menu = el('div', { class: 'menu-analisis' });
    for (const s of SECCIONES) {
      menu.append(el('button', {
        class: `fila-analisis${s.alerta ? ' alerta' : ''}`, type: 'button',
        onclick: () => { estado.seccionAnalisis = s.id; estado.refrescar?.(); },
      }, [
        el('span', { class: 'fa-icono' }, ic(s.icono)),
        el('span', { class: 'fa-texto' }, [
          el('span', { class: 'fa-titulo', texto: s.titulo }),
          el('span', { class: 'fa-pie', texto: s.pie }),
        ]),
        el('span', { class: 'fa-dato', texto: s.dato }),
        el('span', { class: 'fa-flecha', texto: '›' }),
      ]));
    }
    v.append(menu);
    return v;
  }

  const actual = SECCIONES.find((s) => s.id === sec) ?? SECCIONES[0];
  v.append(el('div', { class: 'cab-seccion' }, [
    el('button', {
      class: 'volver', type: 'button', 'aria-label': 'Volver a Análisis',
      onclick: () => { estado.seccionAnalisis = null; estado.refrescar?.(); },
    }, el('span', { texto: '‹ Análisis' })),
    el('h2', { texto: actual.titulo }),
  ]));

  if (sec === 'medidas') v.append(seccionMedidas(p, api));
  else if (sec === 'peso') v.append(seccionPeso(p));
  else if (sec === 'fuerza') v.append(seccionFuerza(p));
  else if (sec === 'sesiones') v.append(seccionSesiones(p, a));
  else v.append(seccionComida(p, a));
  return v;
}

function seccionPeso(p) {
  const v = el('div');
  const pesos = p.historico.peso ?? [];
  const pend = pendienteSemanal(pesos, 'peso');
  const ult = pesos[pesos.length - 1];

  v.append(tarjeta(
    el('h2', { texto: 'Peso' }),
    el('p', { class: 'grande mono', texto: ult ? `${num(ult.peso, 1)} kg` : '—' }),
    el('p', { class: 'sub', texto: ult ? `último: ${ult.fecha}` : 'sin dato' }),
    pend.porSemana === null
      ? el('p', { class: 'aviso', texto: `Con ${pend.n} pesadas no hay tendencia. Hacen falta 5, y para decidir de verdad, 21 días seguidos.` })
      : el('div', { class: 'rejilla' }, [
        baldosa('Por semana', `${pend.porSemana > 0 ? '+' : ''}${num(pend.porSemana, 2)} kg`, `${pend.n} pesadas`),
        baldosa('Desde', pend.desde, 'hasta ' + pend.hasta),
      ]),
    el('p', { class: 'sub', texto: 'La báscula manda: es lo único que decide si la ingesta sube o baja. Una pesada suelta no dice nada; la pendiente de tres semanas sí.' }),
  ));

  const cint = p.historico.cintura ?? [];
  v.append(tarjeta(
    el('h2', { texto: 'Cintura' }),
    cint.length
      ? el('div', {}, cint.slice(-8).reverse().map((c) => el('div', { class: 'dato' }, [
        el('span', { texto: c.fecha }), el('span', { class: 'v', texto: `${num(c.cintura, 1)} cm` }),
      ])))
      : el('p', { class: 'aviso malo', texto: 'Ni una medida registrada. Es la entrada de dos frenos del lazo de control: sin ella, ciertas decisiones no se pueden tomar.' }),
  ));
  return v;
}

function seccionFuerza(p) {
  const v = el('div');
  const ej = Object.entries(p.analisis?.porEjercicio ?? {});
  if (!ej.length) return el('div', {}, vacio('Todavía no hay sesiones registradas con series.'));

  const orden = { bajando: 0, estancado: 1, subiendo: 2, 'sin muestra': 3 };
  ej.sort((x, y) => orden[x[1].tendencia.estado] - orden[y[1].tendencia.estado]);

  const conMuestra = ej.filter(([, x]) => x.tendencia.estado !== 'sin muestra');
  v.append(tarjeta(
    el('h2', { texto: 'Progresión por ejercicio' }),
    el('p', { class: 'sub', texto: 'Se compara el tonelaje de la mejor serie (kg × reps) de cada sesión. Con menos de 5 sesiones no se declara tendencia.' }),
    !conMuestra.length
      ? el('p', { class: 'aviso', texto: `Ninguno de los ${ej.length} ejercicios llega a 5 sesiones registradas todavía. Hasta entonces, «progresando» o «estancado» serían inventados.` })
      : null,
  ));

  for (const [id, x] of ej) {
    const f = p.catalogo.ejercicios[id];
    const ses = x.sesiones.slice(-6).reverse();
    v.append(tarjeta(
      el('div', { class: 'ejercicio-cab' }, [
        el('div', {}, [
          el('h2', { texto: f?.nombre ?? id }),
          el('p', { class: 'sub', texto: f ? `${f.patron} · ${f.musculos.principal.join(', ')}` : '' }),
        ]),
        insignia(x.tendencia),
      ]),
      el('div', {}, ses.map((s) => el('div', { class: 'dato' }, [
        el('span', { texto: s.fecha }),
        el('span', { class: 'v', texto: s.mejorSerie ? `${s.mejorSerie.reps} × ${num(s.mejorSerie.kg, 1)} kg` : `${s.series.length} series` }),
      ]))),
    ));
  }
  return v;
}

function seccionSesiones(p, a) {
  const v = el('div');
  const ses = a.sesiones ?? [];
  if (!ses.length) return el('div', {}, vacio('Sin sesiones registradas.'));

  const conRpe = ses.filter((s) => s.rpe !== null);
  const conSeries = ses.filter((s) => s.series !== null);
  v.append(tarjeta(
    el('h2', { texto: 'Resumen' }),
    el('div', { class: 'rejilla' }, [
      baldosa('Sesiones', String(ses.length), 'registradas'),
      baldosa('RPE medio', conRpe.length ? num(conRpe.reduce((x, s) => x + s.rpe, 0) / conRpe.length, 1) : '—', `${conRpe.length} con RPE`),
      baldosa('Series/sesión', conSeries.length ? num(conSeries.reduce((x, s) => x + s.series, 0) / conSeries.length, 0) : '—', `${conSeries.length} estructuradas`),
    ]),
    conRpe.length < ses.length
      ? el('p', { class: 'aviso', texto: `${ses.length - conRpe.length} sesiones sin RPE. Sin RPE, ninguna carga de esa sesión puede subir.` })
      : null,
  ));

  for (const s of ses) {
    v.append(el('div', { class: 'dato' }, [
      el('span', {}, [
        el('span', { texto: s.fecha }),
        el('br'),
        el('span', { class: 'sub', texto: (s.titulo ?? '').split('·').pop().trim() }),
      ]),
      el('span', { class: 'v', texto: `${s.series ?? '—'} ser${s.rpe ? ` · RPE ${num(s.rpe, 1)}` : ''}${s.fatiga ? ` · fat ${num(s.fatiga, 1)}` : ''}` }),
    ]));
  }
  return v;
}

function seccionComida(p, a) {
  const v = el('div');
  const real = p.historico.nutricionReal ?? [];
  const obj = p.nutricion?.orientacion?.macros;

  if (!real.length) return el('div', {}, vacio('Sin datos de comida todavía.'));

  const ultimos = real.slice(-14);
  const media = (c) => ultimos.reduce((x, d) => x + (d[c] ?? 0), 0) / ultimos.length;

  v.append(tarjeta(
    el('h2', { texto: `Lo que comes de verdad · ${ultimos.length} días` }),
    el('p', { class: 'sub', texto: 'De FatSecret, que lo publica en Google Health. Medias, no un día suelto.' }),
    el('div', { class: 'rejilla' }, [
      baldosa('kcal', num(media('kcal'), 0), ''),
      baldosa('Proteína', `${num(media('proteina'), 0)} g`, obj ? `objetivo ${obj.proteinaG}` : ''),
      baldosa('Hidrato', `${num(media('carbos'), 0)} g`, ''),
      baldosa('Grasa', `${num(media('grasa'), 0)} g`, obj ? `suelo ${obj.grasaMinimaG}` : ''),
      baldosa('Fibra', `${num(media('fibra'), 0)} g`, a.micros?.fibra?.suelo ? `suelo ${a.micros.fibra.suelo}` : ''),
    ]),
  ));

  // Consejos, pero solo los que se deducen de un número que existe.
  const consejos = [];
  if (obj && media('proteina') < obj.proteinaSueloG) {
    consejos.push(`La proteína media (${num(media('proteina'), 0)} g) está por debajo del suelo de ${obj.proteinaSueloG} g. Es lo primero que hay que arreglar: sostiene el músculo.`);
  } else if (obj && media('proteina') < obj.proteinaG) {
    consejos.push(`La proteína media (${num(media('proteina'), 0)} g) está bajo el objetivo de ${obj.proteinaG} g pero encima del suelo. Aceptable, mejorable.`);
  } else if (obj) {
    consejos.push(`La proteína está en su sitio (${num(media('proteina'), 0)} g). Eso no se toca.`);
  }
  if (a.micros?.fibra?.suelo && media('fibra') < a.micros.fibra.suelo) {
    consejos.push(`La fibra (${num(media('fibra'), 0)} g) no llega al suelo de ${a.micros.fibra.suelo} g. Verdura y legumbre, que además arrastran micros.`);
  }
  if (obj && media('grasa') < obj.grasaMinimaG) {
    consejos.push(`La grasa (${num(media('grasa'), 0)} g) está por debajo del suelo hormonal de ${obj.grasaMinimaG} g. Ese suelo no se baja para cuadrar calorías.`);
  }
  const dianas = p.nutricion?.orientacion?.publicado ?? [];
  const pares = ultimos.map((d) => ({ d, o: dianas.find((x) => x.fecha === d.fecha)?.kcal })).filter((x) => x.o);
  if (pares.length >= 3) {
    const dif = pares.reduce((x, q) => x + (q.d.kcal - q.o), 0) / pares.length;
    consejos.push(Math.abs(dif) < 100
      ? `Comes de media a ${num(Math.abs(dif), 0)} kcal de tu diana. Eso es clavarlo.`
      : `Comes de media ${dif > 0 ? 'por encima' : 'por debajo'} de tu diana en ${num(Math.abs(dif), 0)} kcal/día. Sostenido, eso mueve la báscula y desvía la medición.`);
  }

  v.append(tarjeta(
    el('h2', { texto: 'Qué hacer' }),
    ...consejos.map((c) => el('p', { class: 'muted', texto: c })),
    consejos.length ? null : el('p', { class: 'sub', texto: 'Sin objetivos publicados no hay nada que comparar.' }),
  ));

  // Micronutrientes: lo que NO se puede saber, dicho claro.
  v.append(tarjeta(
    el('h2', { texto: 'Micronutrientes' }),
    el('p', { class: 'aviso', texto: a.micros?.aviso ?? 'Sin datos de micros.' }),
    a.micros?.objetivos?.length
      ? el('p', { class: 'sub', texto: `Hay ${a.micros.objetivos.length} micros con objetivo definido. Se calculan sobre el menú planificado con «node centro/scripts/menu.js», no sobre lo comido.` })
      : null,
  ));
  return v;
}

function seccionMedidas(p, api) {
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
