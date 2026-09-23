// app/js/calorias.js
//
// La misma formula que centro/lib/calorias-dia.js, en el movil, para que
// cambiar de sesion recalcule la diana sin cobertura.
//
// LA TRAMPA QUE ESTO EVITA: orientacionSemana() del repo reescala los 7 dias a
// la vez para clavar la media semanal. Si el lunes cambias pierna por CrossFit
// y se recalculase igual, cambiaria tambien el objetivo del martes... y el de
// los dias YA COMIDOS. Un objetivo publicado no se mueve hacia atras.
//
// Por eso aqui solo se reparte el PRESUPUESTO RESTANTE, de hoy en adelante.
// Los dias pasados valen lo que se publico, no lo que se comio: castigarte hoy
// por lo de ayer seria un lazo diario, y en este sistema el lazo es semanal y
// lo cierra la bascula.

const aDecena = (n) => Math.round(n / 10) * 10;

export function costeEntreno(sesiones, p) {
  if (!sesiones || !sesiones.length) return 0;
  return sesiones.reduce((t, s) => {
    if (/crossfit|wod|metcon/i.test(s.modalidad || '')) return t + p.kcalCrossfit;
    if (s.series == null) return t + p.bandaSesionGym[0];
    return t + s.series * p.kcalPorSerie;
  }, 0);
}

export const bruta = (entreno, p) => (p.basalKcal + p.neatKcal + entreno) / (1 - p.tefFraccion);

/**
 * Diana de cada dia de hoy en adelante.
 *
 *   dias:      [{fecha, sesiones:[{modalidad, series}]}]  los 7, con lo ELEGIDO
 *   publicado: Map<fecha, kcal>  lo que se publico el domingo
 *   fase:      {mediaSemanal} o null (sin mediaSemanal no se reescala)
 */
export function reescalarRestante(dias, p, { hoy, publicado, mediaSemanal }) {
  const brutas = dias.map((d) => {
    const e = costeEntreno(d.sesiones, p);
    return { fecha: d.fecha, entreno: e, bruta: bruta(e, p) };
  });

  if (!mediaSemanal) {
    // Fase sin media atada: cada dia pide lo suyo y ya esta.
    return { factor: 1, restante: null, dias: brutas.map((b) => ({ ...b, kcal: aDecena(b.bruta) })) };
  }

  const pasados = brutas.filter((b) => b.fecha < hoy);
  const futuros = brutas.filter((b) => b.fecha >= hoy);
  const gastado = pasados.reduce((a, b) => a + (publicado.get(b.fecha) ?? aDecena(b.bruta)), 0);
  const restante = mediaSemanal * dias.length - gastado;
  const sumaFutura = futuros.reduce((a, b) => a + b.bruta, 0);
  const factor = sumaFutura > 0 ? restante / sumaFutura : 1;

  return {
    factor,
    restante,
    dias: brutas.map((b) => ({
      ...b,
      kcal: b.fecha < hoy
        ? (publicado.get(b.fecha) ?? aDecena(b.bruta))
        : aDecena(b.bruta * factor),
      pasado: b.fecha < hoy,
    })),
  };
}

/**
 * Macros desde las kcal, con la doctrina ya escrita:
 *   la proteina NO cicla (fija), la grasa tiene suelo, y el hidrato absorbe
 *   toda la diferencia, porque es el que alimenta la sesion.
 */
export function macrosDe(kcal, m) {
  const p = m.proteinaG;
  const g = Math.max(m.grasaMinimaG ?? 0, m.grasaObjetivoG ?? 0);
  const c = Math.max(0, Math.round((kcal - 4 * p - 9 * g) / 4));
  return { kcal, proteina: p, grasa: g, carbos: c };
}
