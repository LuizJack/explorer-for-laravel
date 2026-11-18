/*
 * Explorer for Laravel — estadísticas de uso (opcional).
 *
 * Solo hace algo si index.html carga el script de GoatCounter (https://www.goatcounter.com),
 * que cuenta visitas sin cookies ni datos personales. Además de la visita a la página,
 * aquí se registra qué proceso se abre y qué tests se terminan, para saber cuáles se usan más.
 */
(function () {
  'use strict';

  const E = window.LaravelExplorer;
  if (!E) return;

  const pending = [];
  const ready = () => window.goatcounter && typeof window.goatcounter.count === 'function';

  function send(item) {
    try { window.goatcounter.count({ path: item.path, title: item.title, event: true }); } catch (e) { /* sin estadísticas */ }
  }
  function track(path, title) {
    const item = { path, title };
    if (ready()) send(item); else pending.push(item);
  }
  // El script de GoatCounter carga en paralelo: lo que se registró antes se envía al terminar la carga.
  window.addEventListener('load', () => { if (ready()) pending.splice(0).forEach(send); });

  const openProcess = () => track('proceso/' + E.scenario.id, 'Proceso: ' + E.scenario.name);
  E.on('scenario', openProcess);
  if (E.scenario) openProcess();     // el proceso con el que abrió la página

  document.addEventListener('le:test', (e) => {
    track('test/' + e.detail.id + '/' + e.detail.mode, 'Test terminado: ' + e.detail.name + ' (' + e.detail.mode + ')');
  });
})();
