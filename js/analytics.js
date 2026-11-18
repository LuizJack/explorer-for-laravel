/*
 * Explorer for Laravel — contador de visitas.
 *
 * Usa GoatCounter (https://www.goatcounter.com): cuenta visitas sin cookies ni datos personales.
 * Solo se activa en el sitio publicado; en local o en un fork no se carga ni se cuenta nada.
 * Además de la visita a la página, registra qué proceso se abre y qué tests se terminan,
 * para saber cuáles se usan más.
 *
 * Si publicas tu propia copia y quieres estadísticas, cambia SITE por tu dominio y tu cuenta.
 */
(function () {
  'use strict';

  const SITE = {
    hostname: 'luizjack.github.io',
    endpoint: 'https://explorer-for-laravel.goatcounter.com/count'
  };

  const E = window.LaravelExplorer;
  if (!E || location.hostname !== SITE.hostname) return;

  const pending = [];
  const ready = () => window.goatcounter && typeof window.goatcounter.count === 'function';

  function send(item) {
    try { window.goatcounter.count({ path: item.path, title: item.title, event: true }); } catch (e) { /* sin estadísticas */ }
  }
  function track(path, title) {
    const item = { path, title };
    if (ready()) send(item); else pending.push(item);
  }

  // El script de GoatCounter cuenta la visita por sí solo al cargar.
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.setAttribute('data-goatcounter', SITE.endpoint);
  script.onload = () => { if (ready()) pending.splice(0).forEach(send); };
  document.head.appendChild(script);

  const openProcess = () => track('proceso/' + E.scenario.id, 'Proceso: ' + E.scenario.name);
  E.on('scenario', openProcess);
  if (E.scenario) openProcess();     // el proceso con el que abrió la página

  document.addEventListener('le:test', (e) => {
    track('test/' + e.detail.id + '/' + e.detail.mode, 'Test terminado: ' + e.detail.name + ' (' + e.detail.mode + ')');
  });
})();
