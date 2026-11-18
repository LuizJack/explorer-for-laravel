/*
 * Laravel Explorer — motor de visualización.
 * Lee los escenarios de window.SCENARIOS (js/scenarios/*.js) y los anima.
 * Sin dependencias: funciona abriendo index.html directamente.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const NODE_W = 132;
  const NODE_H = 54;
  const BASE_TRAVEL_MS = 1100;
  const BASE_PAUSE_MS = 450;
  const STEP_PAUSE_MS = 700;

  const TYPE_LABELS = {
    request: 'Petición',
    response: 'Respuesta',
    sql: 'SQL',
    cache: 'Caché / sesión',
    queue: 'Cola',
    internal: 'Interno',
    error: 'Error'
  };

  const GROUP_LABELS = {
    client: 'Cliente',
    server: 'Servidor',
    laravel: 'Laravel',
    data: 'Datos',
    external: 'Externo'
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    tabs: $('scenario-tabs'),
    tagline: $('tagline'),
    steps: $('steps'),
    svg: $('diagram'),
    legend: $('legend'),
    stepCounter: $('step-counter'),
    stepTitle: $('step-title'),
    stepSubtitle: $('step-subtitle'),
    stepDescription: $('step-description'),
    eventCard: $('event-card'),
    eventType: $('event-type'),
    eventRoute: $('event-route'),
    eventInfo: $('event-info'),
    eventMeta: $('event-meta'),
    facts: $('step-facts'),
    code: $('step-code'),
    rows: $('event-rows'),
    progress: $('progress'),
    btnReset: $('btn-reset'),
    btnPrev: $('btn-prev'),
    btnPlay: $('btn-play'),
    btnNext: $('btn-next'),
    speed: $('speed')
  };

  const scenarios = window.SCENARIOS || [];

  const state = {
    scenario: null,
    nodes: {},        // id -> nodo
    edges: {},        // "a|b" -> { path, a, b }
    events: [],       // eventos aplanados con stepIndex
    cursor: -1,       // -1 = inicio, antes del primer evento
    playing: false,
    speed: 1,
    rafId: null,
    timerId: null
  };

  // ---------- Utilidades ----------

  function svg(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function color(type) { return 'var(--t-' + type + ')'; }
  function groupColor(group) { return 'var(--g-' + group + ')'; }

  function fmtTime(t) { return t.toFixed(3) + 's'; }

  function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ¿El segmento a→b atraviesa la caja de algún otro nodo?
  function segmentHitsNode(a, b, skip) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    return state.scenario.nodes.some((n) => {
      if (skip.includes(n.id)) return false;
      const t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / len2;
      if (t <= 0.05 || t >= 0.95) return false;
      const px = a.x + t * dx, py = a.y + t * dy;
      return Math.abs(px - n.x) < NODE_W / 2 + 6 && Math.abs(py - n.y) < NODE_H / 2 + 6;
    });
  }

  function edgePathD(a, b) {
    if (!segmentHitsNode(a, b, [a.id, b.id])) {
      return 'M' + a.x + ',' + a.y + ' L' + b.x + ',' + b.y;
    }
    // Curva que esquiva los nodos intermedios (se dobla hacia arriba).
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let nx = -dy / len, ny = dx / len;
    if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
    const off = 110;
    return 'M' + a.x + ',' + a.y + ' Q' + (mx + nx * off) + ',' + (my + ny * off) + ' ' + b.x + ',' + b.y;
  }

  function insideBox(pt, n, pad) {
    return Math.abs(pt.x - n.x) <= NODE_W / 2 + pad && Math.abs(pt.y - n.y) <= NODE_H / 2 + pad;
  }

  // Tramo de la arista que queda fuera de las cajas de sus dos nodos,
  // para que el paquete salga del borde de un nodo y llegue al borde del otro.
  function visibleRange(path, a, b) {
    const len = path.getTotalLength();
    let start = 0, end = len;
    for (let l = 0; l <= len; l += 2) {
      if (!insideBox(path.getPointAtLength(l), a, 4)) { start = l; break; }
    }
    for (let l = len; l >= 0; l -= 2) {
      if (!insideBox(path.getPointAtLength(l), b, 4)) { end = l; break; }
    }
    return end > start ? [start, end] : [0, len];
  }

  // ---------- Construcción ----------

  function buildTabs() {
    el.tabs.innerHTML = '';
    scenarios.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'tab';
      b.type = 'button';
      b.textContent = s.name;
      b.setAttribute('role', 'tab');
      b.dataset.id = s.id;
      b.addEventListener('click', () => { location.hash = s.id; });
      el.tabs.appendChild(b);
    });
  }

  function loadScenario(id) {
    const scenario = scenarios.find((s) => s.id === id) || scenarios[0];
    if (!scenario) return;
    stop();
    state.scenario = scenario;
    state.nodes = {};
    scenario.nodes.forEach((n) => { state.nodes[n.id] = n; });
    state.events = [];
    scenario.steps.forEach((step, si) => {
      step.events.forEach((ev) => state.events.push(Object.assign({ stepIndex: si }, ev)));
    });
    state.cursor = -1;

    [...el.tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === scenario.id)));
    el.tagline.textContent = scenario.tagline;

    buildSteps();
    buildDiagram();
    buildLegend();
    buildTable();
    render();
  }

  function buildSteps() {
    el.steps.innerHTML = '';
    state.scenario.steps.forEach((step, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'step';
      b.type = 'button';
      b.innerHTML =
        '<span class="num">' + (i + 1) + '</span>' +
        '<span class="name">' + escapeHtml(step.title) + '</span>' +
        '<span class="sub">' + escapeHtml(step.subtitle) + '</span>';
      b.addEventListener('click', () => {
        stop();
        const first = state.events.findIndex((e) => e.stepIndex === i);
        goTo(first, true);
      });
      li.appendChild(b);
      el.steps.appendChild(li);
    });
  }

  function buildDiagram() {
    const root = el.svg;
    root.innerHTML = '';
    const edgeLayer = svg('g', { class: 'edges' }, root);
    const nodeLayer = svg('g', { class: 'nodes' }, root);
    svg('g', { class: 'packets', id: 'packet-layer' }, root);

    // Aristas: una por cada par de nodos que intercambian mensajes.
    state.edges = {};
    state.events.forEach((ev) => {
      const key = edgeKey(ev.from, ev.to);
      if (state.edges[key]) return;
      const [a, b] = key.split('|').map((id) => state.nodes[id]);
      const path = svg('path', { class: 'edge', d: edgePathD(a, b) }, edgeLayer);
      if (ev.optional) path.setAttribute('stroke-dasharray', '5 5');
      const range = visibleRange(path, a, b);
      state.edges[key] = { path, a: a.id, b: b.id, startLen: range[0], endLen: range[1] };
    });

    // Nodos
    state.scenario.nodes.forEach((n) => {
      const g = svg('g', { class: 'node', transform: 'translate(' + n.x + ',' + n.y + ')', 'data-id': n.id }, nodeLayer);
      const box = svg('rect', { class: 'box', x: -NODE_W / 2, y: -NODE_H / 2, width: NODE_W, height: NODE_H, rx: 10 }, g);
      box.style.stroke = groupColor(n.group);
      box.style.strokeOpacity = '0.55';
      const dot = svg('circle', { class: 'bar', cx: -NODE_W / 2 + 10, cy: -NODE_H / 2 + 10, r: 3.5 }, g);
      dot.style.fill = groupColor(n.group);
      const label = svg('text', { class: 'label', x: 0, y: -2, 'text-anchor': 'middle' }, g);
      label.textContent = n.label;
      const sub = svg('text', { class: 'sub', x: 0, y: 15, 'text-anchor': 'middle' }, g);
      sub.textContent = n.sub || '';
      fitText(label, NODE_W - 20);
      fitText(sub, NODE_W - 12);
      const title = svg('title', {}, g);
      title.textContent = n.label + ' — ' + (n.sub || '') + ' (' + GROUP_LABELS[n.group] + ')';
    });
  }

  function fitText(textEl, max) {
    try {
      if (textEl.getComputedTextLength() > max) {
        textEl.setAttribute('textLength', max);
        textEl.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    } catch (e) { /* el SVG puede no estar visible aún */ }
  }

  function buildLegend() {
    const types = [...new Set(state.events.map((e) => e.type))];
    el.legend.innerHTML = types
      .map((t) => '<span><i style="background:' + color(t) + '"></i>' + TYPE_LABELS[t] + '</span>')
      .join('');
  }

  function buildTable() {
    el.rows.innerHTML = '';
    state.events.forEach((ev, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="mono">' + (i + 1) + '</td>' +
        '<td class="mono">' + fmtTime(ev.t) + '</td>' +
        '<td>' + escapeHtml(state.nodes[ev.from].label) + '</td>' +
        '<td>' + escapeHtml(state.nodes[ev.to].label) + '</td>' +
        '<td><span class="dot" style="background:' + color(ev.type) + '"></span>' + TYPE_LABELS[ev.type] + '</td>' +
        '<td class="info">' + escapeHtml(ev.info) + '</td>' +
        '<td class="mono">' + (ev.size || '—') + '</td>';
      tr.addEventListener('click', () => { stop(); goTo(i, true); });
      el.rows.appendChild(tr);
    });
  }

  // ---------- Render ----------

  function render() {
    const ev = state.events[state.cursor] || null;
    const stepIndex = ev ? ev.stepIndex : 0;
    const step = state.scenario.steps[stepIndex];
    const total = state.scenario.steps.length;

    // Barra de pasos
    [...el.steps.querySelectorAll('.step')].forEach((b, i) => {
      b.classList.toggle('active', ev !== null && i === stepIndex);
      b.classList.toggle('done', ev !== null && i < stepIndex);
    });

    // Panel de detalle
    el.stepCounter.textContent = ev ? 'PASO ' + (stepIndex + 1) + ' DE ' + total : 'INICIO · ' + total + ' PASOS';
    el.stepTitle.textContent = step.title;
    el.stepSubtitle.textContent = step.subtitle;
    el.stepDescription.textContent = step.description;
    el.facts.innerHTML = (step.facts || [])
      .map(([k, v]) => '<dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd>')
      .join('');
    el.code.textContent = step.code || '';

    if (ev) {
      el.eventCard.classList.remove('empty');
      el.eventType.textContent = TYPE_LABELS[ev.type] + (ev.optional ? ' · alternativa' : '');
      el.eventType.style.background = color(ev.type);
      el.eventRoute.textContent = state.nodes[ev.from].label + ' → ' + state.nodes[ev.to].label;
      el.eventInfo.textContent = ev.info;
      el.eventMeta.textContent =
        'EVENTO ' + (state.cursor + 1) + ' DE ' + state.events.length + ' · t = ' + fmtTime(ev.t) + (ev.size ? ' · ' + ev.size : '');
    } else {
      el.eventCard.classList.add('empty');
    }

    // Nodos y aristas
    el.svg.querySelectorAll('.node').forEach((g) => {
      const id = g.dataset.id;
      const active = ev && (id === ev.from || id === ev.to);
      g.classList.toggle('active', !!active);
      g.classList.toggle('dim', !!ev && !active);
      g.querySelector('rect.box').style.strokeOpacity = active ? '1' : '0.55';
    });
    Object.keys(state.edges).forEach((key) => {
      const p = state.edges[key].path;
      const active = ev && key === edgeKey(ev.from, ev.to);
      p.classList.toggle('active', !!active);
      p.style.stroke = active ? color(ev.type) : '';
    });

    // Tabla
    [...el.rows.children].forEach((tr, i) => {
      tr.classList.toggle('current', i === state.cursor);
      tr.classList.toggle('future', i > state.cursor);
    });
    const currentRow = el.rows.children[state.cursor];
    if (currentRow && state.playing) {
      const wrap = currentRow.closest('.table-wrap');
      if (wrap) currentRow.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // Controles
    el.progress.textContent = (state.cursor + 1) + ' / ' + state.events.length;
    el.btnPrev.disabled = state.cursor < 0;
    el.btnNext.disabled = state.cursor >= state.events.length - 1;
    el.btnPlay.textContent = state.playing ? '❚❚ Pausar' : (state.cursor >= state.events.length - 1 ? '↻ Repetir' : '▶ Reproducir');
  }

  // ---------- Paquete animado ----------

  function drawPacket(ev, progress) {
    const layer = $('packet-layer');
    layer.innerHTML = '';
    if (!ev) return;
    const edge = state.edges[edgeKey(ev.from, ev.to)];
    const path = edge.path;
    const forward = edge.a === ev.from;
    const span = edge.endLen - edge.startLen;
    const pt = path.getPointAtLength(edge.startLen + span * (forward ? progress : 1 - progress));

    const g = svg('g', { class: 'packet' + (ev.optional ? ' optional' : '') }, layer);
    const bg = svg('rect', { class: 'plabel-bg', rx: 6, height: 20 }, g);
    const text = svg('text', { class: 'plabel', 'text-anchor': 'middle' }, g);
    text.textContent = ev.label;
    text.style.fill = color(ev.type);
    bg.style.stroke = color(ev.type);
    const c = svg('circle', { cx: pt.x, cy: pt.y, r: 7 }, g);
    c.style.fill = color(ev.type);

    let w = 60;
    try { w = text.getComputedTextLength() + 16; } catch (e) { /* noop */ }
    // En aristas verticales la etiqueta va al lado; en las horizontales, encima.
    const na = state.nodes[ev.from], nb = state.nodes[ev.to];
    const vertical = Math.abs(nb.y - na.y) > Math.abs(nb.x - na.x);
    let lx = vertical ? pt.x + w / 2 + 12 : pt.x;
    if (vertical && lx + w / 2 > 996) lx = pt.x - w / 2 - 12;
    lx = Math.min(Math.max(lx, w / 2 + 4), 1000 - w / 2 - 4);
    const ly = vertical ? pt.y + 4 : Math.max(pt.y - 22, 60);
    bg.setAttribute('x', lx - w / 2);
    bg.setAttribute('y', ly - 14);
    bg.setAttribute('width', w);
    text.setAttribute('x', lx);
    text.setAttribute('y', ly);
  }

  function animatePacket(ev, done) {
    cancelAnimationFrame(state.rafId);
    const duration = BASE_TRAVEL_MS / state.speed;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { drawPacket(ev, 1); if (done) done(); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      drawPacket(ev, eased);
      if (p < 1) state.rafId = requestAnimationFrame(tick);
      else if (done) done();
    };
    state.rafId = requestAnimationFrame(tick);
  }

  // ---------- Navegación ----------

  function goTo(index, animate, onArrive) {
    clearTimeout(state.timerId);
    cancelAnimationFrame(state.rafId);
    state.cursor = Math.max(-1, Math.min(index, state.events.length - 1));
    render();
    const ev = state.events[state.cursor];
    if (!ev) { drawPacket(null); return; }
    if (animate) animatePacket(ev, onArrive);
    else { drawPacket(ev, 1); if (onArrive) onArrive(); }
  }

  function playNext() {
    if (!state.playing) return;
    if (state.cursor >= state.events.length - 1) { stop(); return; }
    const next = state.cursor + 1;
    goTo(next, true, () => {
      if (!state.playing) return;
      const cur = state.events[state.cursor];
      const nxt = state.events[state.cursor + 1];
      const stepChange = nxt && nxt.stepIndex !== cur.stepIndex;
      const pause = (stepChange ? STEP_PAUSE_MS + BASE_PAUSE_MS : BASE_PAUSE_MS) / state.speed;
      state.timerId = setTimeout(playNext, pause);
    });
  }

  function play() {
    if (state.cursor >= state.events.length - 1) state.cursor = -1;
    state.playing = true;
    render();
    playNext();
  }

  function stop() {
    state.playing = false;
    clearTimeout(state.timerId);
    if (state.scenario) render();
  }

  function togglePlay() { state.playing ? stop() : play(); }

  // ---------- Eventos de UI ----------

  el.btnPlay.addEventListener('click', togglePlay);
  el.btnNext.addEventListener('click', () => { stop(); goTo(state.cursor + 1, true); });
  el.btnPrev.addEventListener('click', () => { stop(); goTo(state.cursor - 1, false); });
  el.btnReset.addEventListener('click', () => { stop(); goTo(-1, false); });
  el.speed.addEventListener('change', () => { state.speed = parseFloat(el.speed.value) || 1; });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'input' || tag === 'textarea') return;
    if (e.key === ' ' && tag !== 'button') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { stop(); goTo(state.cursor + 1, true); }
    else if (e.key === 'ArrowLeft') { stop(); goTo(state.cursor - 1, false); }
    else if (e.key === 'Home') { stop(); goTo(-1, false); }
  });

  window.addEventListener('hashchange', () => loadScenario(location.hash.slice(1)));

  // ---------- Inicio ----------

  if (!scenarios.length) {
    el.stepTitle.textContent = 'No hay escenarios cargados';
    return;
  }
  buildTabs();
  loadScenario(location.hash.slice(1) || scenarios[0].id);
})();
