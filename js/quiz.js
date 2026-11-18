/*
 * Explorer for Laravel — modo "Ponte a prueba".
 *
 * Dos modalidades por proceso:
 *   - Predice el siguiente paso: la animación se detiene y hay que elegir a qué
 *     componente va el próximo mensaje. Los retos salen de los mensajes que
 *     tienen la propiedad `ask` en el escenario.
 *   - Preguntas: opción múltiple, a partir de la lista `quiz` del escenario.
 *
 * Usa la API que expone js/app.js en window.LaravelExplorer.
 */
(function () {
  'use strict';

  const E = window.LaravelExplorer;
  const $ = (id) => document.getElementById(id);
  const el = {
    panel: $('quiz'), eyebrow: $('quiz-eyebrow'), progress: $('quiz-progress'),
    exit: $('quiz-exit'), content: $('quiz-body'), open: $('btn-quiz'), cta: $('quiz-cta')
  };
  if (!E || !el.panel) return;

  // Dirección pública de la demo; se usa al compartir si la página se abre en local.
  const SITE_URL = 'https://luizjack.github.io/explorer-for-laravel/';

  const MODES = {
    predict:   { name: 'Predice el siguiente paso', unit: 'reto',     units: 'retos' },
    questions: { name: 'Preguntas',                 unit: 'pregunta', units: 'preguntas' }
  };

  const q = { active: false, mode: null, items: [], index: 0, score: 0, answered: false, current: null, run: 0, timer: null };

  // ---------- Utilidades ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Índices de los mensajes que se preguntan en "Predice el siguiente paso".
  function challenges() {
    const evs = E.events;
    const asked = evs.map((ev, i) => (ev.ask ? i : -1)).filter((i) => i >= 0);
    if (asked.length) return asked;
    // Escenario sin retos escritos: se reparten hasta 8 mensajes que no sean respuestas.
    const pool = evs.map((ev, i) => (ev.type !== 'response' && !ev.optional ? i : -1)).filter((i) => i >= 0);
    const max = Math.min(8, pool.length);
    const out = [];
    for (let k = 0; k < max; k++) out.push(pool[Math.floor((k + 0.5) * pool.length / max)]);
    return [...new Set(out)];
  }
  function itemsFor(mode) { return mode === 'predict' ? challenges() : (E.scenario.quiz || []); }

  // Mejor resultado por proceso y modalidad (solo en este navegador).
  const bestKey = (mode) => E.scenario.id + ':' + mode;
  function readBest() {
    try { return JSON.parse(localStorage.getItem('le-best') || '{}') || {}; } catch (e) { return {}; }
  }
  function saveBest(mode, score, total) {
    try {
      const all = readBest();
      const prev = all[bestKey(mode)];
      if (!prev || score > prev.score) {
        all[bestKey(mode)] = { score, total };
        localStorage.setItem('le-best', JSON.stringify(all));
        return true;
      }
    } catch (e) { /* almacenamiento no disponible */ }
    return false;
  }

  function cancel() {
    q.run++;
    clearTimeout(q.timer);
    E.stop();
  }

  // ---------- Cabecera ----------

  function setHead(label) {
    el.eyebrow.textContent = 'Ponte a prueba · ' + E.scenario.name;
    if (label !== undefined) { el.progress.textContent = label; return; }
    if (!q.mode) { el.progress.textContent = ''; return; }
    const m = MODES[q.mode];
    el.progress.textContent = m.unit + ' ' + Math.min(q.index + 1, q.items.length) + ' de ' + q.items.length +
      ' · ' + q.score + (q.score === 1 ? ' acierto' : ' aciertos');
  }

  // ---------- Pantalla inicial ----------

  function showIntro() {
    cancel();
    q.mode = null;
    q.current = null;
    q.answered = false;
    E.focus([]);
    E.hint(null);
    E.goTo(-1, false);
    setHead();

    const best = readBest();
    const card = (mode, text) => {
      const n = itemsFor(mode).length;
      const m = MODES[mode];
      const b = best[bestKey(mode)];
      return '<button type="button" class="quiz-card" data-mode="' + mode + '"' + (n ? '' : ' disabled') + '>' +
        '<span class="qc-title">' + m.name + '</span>' +
        '<span class="qc-text">' + text + '</span>' +
        '<span class="qc-meta">' + (n ? n + ' ' + (n === 1 ? m.unit : m.units) : 'Aún no disponible en este proceso') +
          (b ? ' · tu mejor resultado: ' + b.score + ' de ' + b.total : '') + '</span>' +
        '</button>';
    };
    el.content.innerHTML =
      '<p class="quiz-lead">Elige cómo quieres ponerte a prueba con «' + esc(E.scenario.name) + '».</p>' +
      '<div class="quiz-intro">' +
        card('predict', 'La animación se detiene y tú eliges a qué componente va el próximo mensaje.') +
        card('questions', 'Opción múltiple sobre lo que pasa en cada paso, con la explicación al responder.') +
      '</div>';
    el.content.querySelectorAll('.quiz-card').forEach((b) => b.addEventListener('click', () => start(b.dataset.mode)));
  }

  function start(mode) {
    cancel();
    q.mode = mode;
    q.items = itemsFor(mode);
    q.index = 0;
    q.score = 0;
    E.focus([]);
    E.goTo(-1, false);
    if (mode === 'predict') E.setSpeed(2); else E.restoreSpeed();
    next();
  }

  function next() {
    q.answered = false;
    q.current = null;
    if (q.index >= q.items.length) { finish(); return; }
    setHead();
    if (q.mode === 'predict') askPredict(); else askQuestion();
  }

  // ---------- Opciones y respuesta ----------

  function optionHtml(i, label, sub, id) {
    return '<button type="button" class="quiz-opt" data-id="' + esc(id) + '">' +
      '<span class="key">' + (i + 1) + '</span>' +
      '<span><span class="o-label">' + esc(label) + '</span>' + (sub ? '<span class="o-sub">' + esc(sub) + '</span>' : '') + '</span>' +
      '</button>';
  }
  const optionButtons = () => [...el.content.querySelectorAll('.quiz-opt')];

  function markOptions(isCorrect, isChosen) {
    optionButtons().forEach((btn) => {
      btn.disabled = true;
      if (isCorrect(btn)) btn.classList.add('ok');
      else if (isChosen(btn)) btn.classList.add('bad');
    });
  }

  function feedback(ok, verdict, detail, asCode) {
    const last = q.index >= q.items.length - 1;
    const box = $('quiz-feedback');
    box.innerHTML =
      '<p><span class="verdict ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ ' : '✗ ') + esc(verdict) + '</span> ' +
        (asCode ? '<code>' + esc(detail) + '</code>' : esc(detail)) + '</p>' +
      '<button type="button" class="quiz-btn primary" id="quiz-next">' + (last ? 'Ver resultado' : 'Siguiente') + '</button>';
    const btn = $('quiz-next');
    btn.addEventListener('click', () => { q.index++; next(); });
    btn.focus({ preventScroll: true });
    setHead();
  }

  // ---------- Modalidad 1: predice el siguiente paso ----------

  // Reproduce los mensajes hasta `target` y luego llama a `done`.
  function advanceTo(target, run, done) {
    const step = () => {
      if (run !== q.run) return;
      if (E.cursor >= target) { done(); return; }
      E.goTo(E.cursor + 1, true, () => { if (run === q.run) q.timer = setTimeout(step, 140); });
    };
    step();
  }

  // Tres opciones falsas: primero los componentes que sí hablan con el emisor, que son las más creíbles.
  function distractors(ev) {
    const near = new Set();
    E.events.forEach((x) => {
      if (x.from === ev.from) near.add(x.to);
      if (x.to === ev.from) near.add(x.from);
    });
    near.delete(ev.to);
    near.delete(ev.from);
    const rest = E.scenario.nodes.map((n) => n.id).filter((id) => id !== ev.to && id !== ev.from && !near.has(id));
    return shuffle([...near]).concat(shuffle(rest)).slice(0, 3);
  }

  function askPredict() {
    const run = ++q.run;
    const idx = q.items[q.index];
    const ev = E.events[idx];
    E.focus([]);
    el.content.innerHTML = '<p class="quiz-watch"><span class="quiz-pulse"></span>Observa el recorrido…</p>';

    advanceTo(idx - 1, run, () => {
      const ids = shuffle([ev.to].concat(distractors(ev)));
      q.current = { idx, ev };
      E.focus([ev.from]);
      el.content.innerHTML =
        '<p class="quiz-kicker">El siguiente mensaje sale de <strong>' + esc(E.node(ev.from).label) + '</strong></p>' +
        '<p class="quiz-q">' + esc(ev.ask || '¿Qué componente lo recibe?') + '</p>' +
        '<div class="quiz-options cols-4">' +
          ids.map((id, i) => optionHtml(i, E.node(id).label, E.node(id).sub, id)).join('') +
        '</div>' +
        '<div class="quiz-feedback" id="quiz-feedback"></div>';
      optionButtons().forEach((btn) => {
        btn.addEventListener('click', () => answerPredict(btn.dataset.id));
        // Al pasar por una opción se señala ese componente en el diagrama.
        btn.addEventListener('mouseenter', () => { if (!q.answered) E.hint(btn.dataset.id); });
        btn.addEventListener('mouseleave', () => E.hint(null));
      });
    });
  }

  function answerPredict(choice) {
    if (q.answered || !q.current) return;
    q.answered = true;
    const ev = q.current.ev;
    const ok = choice === ev.to;
    if (ok) q.score++;
    markOptions((b) => b.dataset.id === ev.to, (b) => b.dataset.id === choice);
    E.hint(null);
    E.focus([]);
    E.goTo(q.current.idx, true);     // ahora sí: se anima el mensaje real
    feedback(ok, ok ? 'Correcto.' : 'Iba hacia ' + E.node(ev.to).label + '.', ev.info, true);
  }

  // ---------- Modalidad 2: preguntas ----------

  function askQuestion() {
    ++q.run;
    const item = q.items[q.index];
    const order = shuffle(item.options.map((_, i) => i));
    q.current = { item };
    E.focus([]);
    el.content.innerHTML =
      '<p class="quiz-q">' + esc(item.q) + '</p>' +
      '<div class="quiz-options">' + order.map((oi, i) => optionHtml(i, item.options[oi], '', String(oi))).join('') + '</div>' +
      '<div class="quiz-feedback" id="quiz-feedback"></div>';
    optionButtons().forEach((btn) => btn.addEventListener('click', () => answerQuestion(Number(btn.dataset.id))));
  }

  function answerQuestion(choice) {
    if (q.answered || !q.current) return;
    q.answered = true;
    const item = q.current.item;
    const ok = choice === item.answer;
    if (ok) q.score++;
    markOptions((b) => Number(b.dataset.id) === item.answer, (b) => Number(b.dataset.id) === choice);
    E.focus(item.nodes || []);       // señala en el diagrama los componentes de los que habla la pregunta
    feedback(ok, ok ? 'Correcto.' : 'No exactamente.', item.explain, false);
  }

  // ---------- Resultado ----------

  function shareUrl() {
    const local = !/^https?:$/.test(location.protocol) || /^(localhost|127\.|\[::1\])/.test(location.hostname);
    return (local ? SITE_URL : location.origin + location.pathname) + '#' + E.scenario.id;
  }

  function copyText(text, btn) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = 'Copiado ✓';
      setTimeout(() => { btn.textContent = old; }, 1800);
    };
    const legacy = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { if (document.execCommand('copy')) done(); } catch (e) { /* sin portapapeles */ }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy);
    else legacy();
  }

  function finish() {
    cancel();
    E.focus([]);
    const mode = q.mode, m = MODES[mode];
    const total = q.items.length, score = q.score;
    const record = saveBest(mode, score, total);
    const ratio = total ? score / total : 0;
    const msg = ratio === 1 ? 'Perfecto. Dominas este proceso.'
      : ratio >= 0.7 ? 'Muy bien. Te falta poco para dominarlo.'
      : ratio >= 0.4 ? 'Vas por buen camino. Repasa la animación y vuelve a intentarlo.'
      : 'Buen primer intento. Mira el proceso paso a paso y vuelve.';
    const other = mode === 'predict' ? 'questions' : 'predict';
    const text = 'Saqué ' + score + ' de ' + total + ' en «' + E.scenario.name + '» (' + m.name.toLowerCase() +
      ') en Explorer for Laravel, una herramienta visual para entender cómo funciona Laravel por dentro. ¿Cuánto sacas tú?\n\n' + shareUrl();

    // Aviso para otros módulos (p. ej. js/analytics.js).
    document.dispatchEvent(new CustomEvent('le:test', { detail: { id: E.scenario.id, name: E.scenario.name, mode, score, total } }));

    setHead('resultado');
    el.content.innerHTML =
      '<div class="quiz-result">' +
        '<div class="quiz-score"><span class="qs-num">' + score + '</span><span class="qs-total">de ' + total + '</span></div>' +
        '<div class="quiz-result-text">' +
          '<p class="quiz-q">' + msg + '</p>' +
          '<p class="quiz-lead">' + m.name + ' · ' + esc(E.scenario.name) + (record && score > 0 ? ' · nuevo mejor resultado' : '') + '</p>' +
          '<div class="quiz-actions">' +
            '<a class="quiz-btn primary" target="_blank" rel="noopener" href="https://www.linkedin.com/feed/?shareActive=true&amp;text=' +
              encodeURIComponent(text) + '">Compartir en LinkedIn</a>' +
            '<button type="button" class="quiz-btn" id="quiz-copy">Copiar resultado</button>' +
            '<button type="button" class="quiz-btn" id="quiz-retry">Reintentar</button>' +
            (itemsFor(other).length ? '<button type="button" class="quiz-btn" id="quiz-other">Probar «' + MODES[other].name + '»</button>' : '') +
            '<button type="button" class="quiz-btn" id="quiz-back">Volver al proceso</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    $('quiz-copy').addEventListener('click', (e) => copyText(text, e.currentTarget));
    $('quiz-retry').addEventListener('click', () => start(mode));
    $('quiz-back').addEventListener('click', close);
    if ($('quiz-other')) $('quiz-other').addEventListener('click', () => start(other));
  }

  // ---------- Entrar y salir ----------

  function open() {
    if (q.active) return;
    q.active = true;
    E.stop();
    E.setView('network');
    E.lock(true);
    document.body.classList.add('quiz-mode');
    el.panel.hidden = false;
    showIntro();
    window.scrollTo(0, 0);
  }

  function close() {
    if (!q.active) return;
    cancel();
    q.active = false;
    q.mode = null;
    q.current = null;
    E.lock(false);
    E.restoreSpeed();
    E.focus([]);
    E.hint(null);
    document.body.classList.remove('quiz-mode');
    el.panel.hidden = true;
    E.goTo(-1, false);
  }

  el.open.addEventListener('click', open);
  el.cta.addEventListener('click', open);
  el.exit.addEventListener('click', close);

  document.addEventListener('keydown', (e) => {
    if (!q.active) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'Escape') { close(); return; }
    if (/^[1-4]$/.test(e.key) && q.current && !q.answered) {
      const btn = optionButtons()[Number(e.key) - 1];
      if (btn) btn.click();
    }
  });

  // Al cambiar de proceso con el test abierto, se muestra el test de ese proceso.
  E.on('scenario', () => { if (q.active) showIntro(); });
  // Al llegar al final de la animación se invita a hacer el test.
  E.on('render', () => { el.cta.hidden = q.active || E.cursor < E.events.length - 1; });

  // Enlace directo: index.html#http/test abre el test de ese proceso.
  if (/\/test$/.test(location.hash)) open();
})();
