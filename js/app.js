/*
 * Laravel Explorer — motor de visualización.
 * Lee los escenarios de window.SCENARIOS (js/scenarios/*.js), dibuja la vista
 * de red (íconos isométricos) y la vista de secuencia, y anima cada mensaje.
 * Sin dependencias: funciona abriendo index.html directamente.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW = { x: 0, y: 30, w: 1000, h: 565 };
  const HIT = { left: 48, right: 48, top: 50, bottom: 80 };   // zona que ocupa un nodo (ícono + textos)
  const CLIP = 46;                                              // radio para que el paquete salga del borde del ícono
  const BASE_TRAVEL_MS = 1200;
  const BASE_PAUSE_MS = 450;
  const STEP_PAUSE_MS = 700;

  const TYPE_LABELS = {
    request: 'Petición', response: 'Respuesta', sql: 'SQL', cache: 'Caché / sesión',
    queue: 'Cola', internal: 'Interno', error: 'Error'
  };

  // Ícono por defecto de cada nodo (se puede sobrescribir con node.icon en el escenario).
  const NODE_ICONS = {
    browser:    { kind: 'laptop' },
    nginx:      { kind: 'server', glyph: 'globe' },
    fpm:        { kind: 'server', glyph: 'gear' },
    supervisor: { kind: 'server', glyph: 'eye' },
    worker:     { kind: 'server', glyph: 'gear' },
    index:      { kind: 'block', glyph: 'file' },
    app:        { kind: 'block', glyph: 'box' },
    providers:  { kind: 'block', glyph: 'plug' },
    kernel:     { kind: 'block', glyph: 'gear' },
    router:     { kind: 'block', glyph: 'route' },
    middleware: { kind: 'stack', glyph: 'layers' },
    controller: { kind: 'block', glyph: 'code' },
    model:      { kind: 'block', glyph: 'table' },
    view:       { kind: 'block', glyph: 'layout' },
    terminate:  { kind: 'block', glyph: 'flag' },
    bus:        { kind: 'block', glyph: 'send' },
    job:        { kind: 'block', glyph: 'briefcase' },
    request:    { kind: 'block', glyph: 'form' },
    guard:      { kind: 'block', glyph: 'key' },
    provider:   { kind: 'block', glyph: 'user' },
    hash:       { kind: 'block', glyph: 'hash' },
    events:     { kind: 'block', glyph: 'bell' },
    limiter:    { kind: 'cylinder', glyph: 'shield' },
    redis:      { kind: 'cylinder', glyph: 'bolt' },
    session:    { kind: 'cylinder', glyph: 'bolt' },
    failed:     { kind: 'cylinder', glyph: 'x' },
    db:         { kind: 'db' },
    smtp:       { kind: 'cloud', glyph: 'mail' }
  };
  const GROUP_ICONS = { client: { kind: 'laptop' }, server: { kind: 'server' }, data: { kind: 'db' }, external: { kind: 'cloud' }, laravel: { kind: 'block', glyph: 'box' } };

  const $ = (id) => document.getElementById(id);
  const el = {
    html: document.documentElement,
    sidebar: $('sidebar'), scrim: $('scrim'), btnMenu: $('btn-menu'),
    search: $('search'), list: $('scenario-list'),
    name: $('scenario-name'), tagline: $('tagline'),
    viewNetwork: $('view-network'), viewSequence: $('view-sequence'),
    btnTheme: $('btn-theme'),
    steps: $('steps'),
    networkWrap: $('network-wrap'), sequenceWrap: $('sequence-wrap'),
    svg: $('diagram'), seq: $('sequence'), legend: $('legend'),
    stepCounter: $('step-counter'), stepTitle: $('step-title'), stepSubtitle: $('step-subtitle'),
    stepDescription: $('step-description'),
    eventCard: $('event-card'), eventType: $('event-type'), eventRoute: $('event-route'),
    eventInfo: $('event-info'), eventMeta: $('event-meta'),
    facts: $('step-facts'), code: $('step-code'), rows: $('event-rows'),
    progress: $('progress'), btnReset: $('btn-reset'), btnPrev: $('btn-prev'),
    btnPlay: $('btn-play'), playLabel: $('play-label'), btnNext: $('btn-next'), speed: $('speed')
  };

  const scenarios = window.SCENARIOS || [];

  const state = {
    scenario: null,
    nodes: {},
    edges: {},
    events: [],
    seqRows: [],
    cursor: -1,
    playing: false,
    speed: 1,
    view: 'network',
    locked: false,          // true mientras un módulo externo (el test) controla la reproducción
    rafId: null,
    timerId: null
  };

  // Módulos externos (js/quiz.js) se enganchan aquí: ver window.LaravelExplorer más abajo.
  const hooks = { scenario: [], render: [] };

  // ---------- Utilidades ----------

  function svg(tag, attrs, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const typeColor = (t) => 'var(--t-' + t + ')';
  const fmtTime = (t) => t.toFixed(3) + 's';
  const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function iconFor(node) {
    return Object.assign({ group: node.group }, node.icon || NODE_ICONS[node.id] || GROUP_ICONS[node.group] || GROUP_ICONS.laravel);
  }
  function fitText(textEl, max) {
    try {
      if (textEl.getComputedTextLength() > max) {
        textEl.setAttribute('textLength', max);
        textEl.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    } catch (e) { /* oculto */ }
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Geometría de aristas ----------

  function segmentHitsNode(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    return state.scenario.nodes.some((n) => {
      if (n.id === a.id || n.id === b.id) return false;
      const t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / len2;
      if (t <= 0.05 || t >= 0.95) return false;
      const px = a.x + t * dx, py = a.y + t * dy;
      return px > n.x - HIT.left && px < n.x + HIT.right && py > n.y - HIT.top && py < n.y + HIT.bottom;
    });
  }

  function edgePathD(a, b) {
    if (!segmentHitsNode(a, b)) return 'M' + a.x + ',' + a.y + ' L' + b.x + ',' + b.y;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    let nx = -dy / len, ny = dx / len;
    if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
    const off = 120;
    return 'M' + a.x + ',' + a.y + ' Q' + (mx + nx * off) + ',' + (my + ny * off) + ' ' + b.x + ',' + b.y;
  }

  function visibleRange(path, a, b) {
    const len = path.getTotalLength();
    let start = 0, end = len;
    // El paquete arranca y termina justo fuera del ícono y sus textos.
    const inside = (p, n) => p.x > n.x - CLIP && p.x < n.x + CLIP && p.y > n.y - CLIP - 4 && p.y < n.y + HIT.bottom + 6;
    for (let l = 0; l <= len; l += 2) {
      if (!inside(path.getPointAtLength(l), a)) { start = l; break; }
    }
    for (let l = len; l >= 0; l -= 2) {
      if (!inside(path.getPointAtLength(l), b)) { end = l; break; }
    }
    return end > start ? [start, end] : [0, len];
  }

  // ---------- Menú lateral ----------

  function buildSidebar() {
    const q = el.search.value.trim().toLowerCase();
    const matches = scenarios.filter((s) => {
      if (!q) return true;
      const hay = [s.name, s.tagline, s.category]
        .concat(s.steps.map((st) => st.title + ' ' + st.subtitle))
        .concat(s.nodes.map((n) => n.label))
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
    el.list.innerHTML = '';
    if (!matches.length) {
      el.list.innerHTML = '<p class="scenario-empty">Ningún proceso coincide con la búsqueda.</p>';
      return;
    }
    const cats = [];
    matches.forEach((s) => { const c = s.category || 'Procesos'; if (!cats.includes(c)) cats.push(c); });
    cats.forEach((cat) => {
      const sec = document.createElement('div');
      sec.innerHTML = '<p class="cat-title">' + escapeHtml(cat) + '</p>';
      matches.filter((s) => (s.category || 'Procesos') === cat).forEach((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'scenario-item';
        b.dataset.id = s.id;
        if (state.scenario && state.scenario.id === s.id) b.setAttribute('aria-current', 'true');
        const icon = document.createElementNS(SVG_NS, 'svg');
        icon.setAttribute('viewBox', '-42 -38 84 76');
        icon.setAttribute('aria-hidden', 'true');
        b.appendChild(icon);
        const txt = document.createElement('span');
        txt.innerHTML = '<span class="si-name">' + escapeHtml(s.name) + '</span><span class="si-sub">' +
          s.steps.length + ' pasos · ' + s.steps.reduce((n, st) => n + st.events.length, 0) + ' mensajes</span>';
        b.appendChild(txt);
        b.addEventListener('click', () => { location.hash = s.id; closeMenu(); });
        sec.appendChild(b);
        el.list.appendChild(sec);
        window.ISO.draw(icon, Object.assign({ group: 'laravel' }, s.icon || { kind: 'block', glyph: 'box' }));
      });
    });
  }

  function openMenu() {
    el.sidebar.classList.add('open');
    el.scrim.hidden = false;
    el.btnMenu.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    el.sidebar.classList.remove('open');
    el.scrim.hidden = true;
    el.btnMenu.setAttribute('aria-expanded', 'false');
  }

  // ---------- Carga de escenario ----------

  function loadScenario(id) {
    const scenario = scenarios.find((s) => s.id === id) || scenarios[0];
    if (!scenario) return;
    stop();
    state.scenario = scenario;
    state.nodes = {};
    scenario.nodes.forEach((n) => { state.nodes[n.id] = n; });
    state.events = [];
    scenario.steps.forEach((step, si) => step.events.forEach((ev) => state.events.push(Object.assign({ stepIndex: si }, ev))));
    state.cursor = -1;

    el.name.textContent = scenario.name;
    el.tagline.textContent = scenario.tagline;
    document.title = scenario.name + ' · Laravel Explorer';

    buildSidebar();
    buildSteps();
    buildNetwork();
    buildSequence();
    buildLegend();
    buildTable();
    render();
    drawPacket(null);
    hooks.scenario.forEach((fn) => fn());
  }

  function buildSteps() {
    el.steps.innerHTML = '';
    state.scenario.steps.forEach((step, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'step';
      b.type = 'button';
      b.innerHTML = '<span class="num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="name">' + escapeHtml(step.title) + '</span>' +
        '<span class="sub">' + escapeHtml(step.subtitle) + '</span>';
      b.addEventListener('click', () => { stop(); goTo(state.events.findIndex((e) => e.stepIndex === i), true); });
      li.appendChild(b);
      el.steps.appendChild(li);
    });
  }

  // ---------- Vista de red ----------

  function buildNetwork() {
    const root = el.svg;
    root.innerHTML = '';
    root.classList.remove('has-focus');

    // Cuadrícula isométrica de fondo
    const defs = svg('defs', {}, root);
    const pat = svg('pattern', { id: 'iso-grid', width: 34.64, height: 20, patternUnits: 'userSpaceOnUse' }, defs);
    svg('path', { d: 'M0,0 L34.64,20 M0,20 L34.64,0', class: 'grid-line' }, pat);
    svg('rect', { x: VIEW.x - 400, y: VIEW.y - 200, width: VIEW.w + 800, height: VIEW.h + 400, fill: 'url(#iso-grid)' }, root);

    const edgeLayer = svg('g', { class: 'edges' }, root);
    const nodeLayer = svg('g', { class: 'nodes' }, root);
    svg('g', { id: 'packet-layer' }, root);

    state.edges = {};
    state.events.forEach((ev) => {
      const key = edgeKey(ev.from, ev.to);
      if (state.edges[key]) return;
      const [a, b] = key.split('|').map((id) => state.nodes[id]);
      const path = svg('path', { class: 'edge', d: edgePathD(a, b) }, edgeLayer);
      const range = visibleRange(path, a, b);
      state.edges[key] = { path, a: a.id, b: b.id, startLen: range[0], endLen: range[1], optional: !!ev.optional };
    });

    state.scenario.nodes.forEach((n) => {
      const g = svg('g', { class: 'node', transform: 'translate(' + n.x + ',' + n.y + ')', 'data-id': n.id }, nodeLayer);
      g.style.setProperty('--c', 'var(--g-' + n.group + ')');
      svg('ellipse', { class: 'halo', cx: 0, cy: 2, rx: 56, ry: 52 }, g);
      const wrap = svg('g', { class: 'icon-wrap', transform: 'scale(1.2)' }, g);
      window.ISO.draw(wrap, iconFor(n));
      const label = svg('text', { class: 'n-label', x: 0, y: 64, 'text-anchor': 'middle' }, g);
      label.textContent = n.label;
      const sub = svg('text', { class: 'n-sub', x: 0, y: 78, 'text-anchor': 'middle' }, g);
      sub.textContent = n.sub || '';
      fitText(label, 124);
      fitText(sub, 126);
      svg('title', {}, g).textContent = n.label + ' — ' + (n.sub || '');
    });
  }

  function buildLegend() {
    const types = [...new Set(state.events.map((e) => e.type))];
    el.legend.innerHTML = types.map((t) => '<span><i style="color:' + typeColor(t) + '"></i>' + TYPE_LABELS[t] + '</span>').join('');
  }

  // ---------- Vista de secuencia ----------

  function buildSequence() {
    const root = el.seq;
    const headSvg = document.getElementById('sequence-head');
    root.innerHTML = '';
    headSvg.innerHTML = '';
    const order = [];
    state.events.forEach((e) => [e.from, e.to].forEach((id) => { if (!order.includes(id)) order.push(id); }));

    const avail = Math.max(700, (el.sequenceWrap.clientWidth || el.networkWrap.clientWidth || 900) - 8);
    const left = 70;
    const colW = Math.max(88, Math.floor((avail - left - 10) / order.length));
    const W = left + colW * order.length + 10;
    const colX = {};
    order.forEach((id, i) => { colX[id] = left + colW * i + colW / 2; });

    const headH = 116;
    const lifeG = svg('g', {}, root);
    const rowsG = svg('g', {}, root);
    const headG = svg('g', {}, headSvg);
    svg('g', { id: 'seq-packet' }, root);

    // Cabeceras
    order.forEach((id) => {
      const n = state.nodes[id];
      const g = svg('g', { transform: 'translate(' + colX[id] + ',0)' }, headG);
      g.style.setProperty('--c', 'var(--g-' + n.group + ')');
      const ic = svg('g', { transform: 'translate(0,46) scale(0.62)' }, g);
      window.ISO.draw(ic, iconFor(n));
      const t = svg('text', { class: 'seq-head-label', x: 0, y: 95, 'text-anchor': 'middle' }, g);
      t.textContent = n.label;
      fitText(t, colW - 8);
      const s = svg('text', { class: 'seq-head-sub', x: 0, y: 108, 'text-anchor': 'middle' }, g);
      s.textContent = n.sub || '';
      fitText(s, colW - 8);
    });

    // Filas
    state.seqRows = [];
    let y = 8, prevStep = -1;
    state.events.forEach((ev, i) => {
      if (ev.stepIndex !== prevStep) {
        prevStep = ev.stepIndex;
        svg('rect', { class: 'seq-step-band', x: 0, y, width: W, height: 22, rx: 4 }, rowsG);
        const st = state.scenario.steps[ev.stepIndex];
        svg('text', { class: 'seq-step-text', x: 10, y: y + 15 }, rowsG).textContent =
          'PASO ' + (ev.stepIndex + 1) + ' · ' + st.title.toUpperCase();
        y += 28;
      }
      const rowH = 36, cy = y + 23;
      const g = svg('g', { class: 'seq-row' }, rowsG);
      svg('rect', { class: 'seq-hl', x: 0, y, width: W, height: rowH, rx: 4 }, g);
      svg('text', { class: 'seq-time', x: 8, y: cy + 3 }, g).textContent = fmtTime(ev.t);
      const xa = colX[ev.from], xb = colX[ev.to], dir = xb > xa ? 1 : -1;
      const line = svg('line', { class: 'seq-line', x1: xa, y1: cy, x2: xb - dir * 7, y2: cy }, g);
      line.style.stroke = typeColor(ev.type);
      if (ev.optional) line.setAttribute('stroke-dasharray', '4 4');
      const head = svg('polygon', { points: [xb, cy, xb - dir * 9, cy - 5, xb - dir * 9, cy + 5].join(' ') }, g);
      head.style.fill = typeColor(ev.type);
      const span = Math.abs(xb - xa);
      const label = svg('text', { class: 'seq-label', x: (xa + xb) / 2, y: cy - 6, 'text-anchor': 'middle' }, g);
      label.textContent = truncate(ev.label, Math.max(14, Math.floor(span / 6.6)));
      svg('rect', { class: 'seq-hit', x: 0, y, width: W, height: rowH }, g);
      svg('title', {}, g).textContent = (i + 1) + '. ' + ev.info;
      g.addEventListener('click', () => { stop(); goTo(i, true); });
      state.seqRows.push({ g, xa, xb, cy, y });
      y += rowH;
    });

    const H = y + 16;
    order.forEach((id) => {
      svg('line', { class: 'seq-life', x1: colX[id], y1: 0, x2: colX[id], y2: H }, lifeG);
      svg('line', { class: 'seq-life', x1: colX[id], y1: headH - 6, x2: colX[id], y2: headH }, headG);
    });
    headSvg.setAttribute('width', W);
    headSvg.setAttribute('height', headH);
    headSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + headH);
    root.setAttribute('width', W);
    root.setAttribute('height', H);
    root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  }

  // ---------- Tabla ----------

  function buildTable() {
    el.rows.innerHTML = '';
    state.events.forEach((ev, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="mono">' + (i + 1) + '</td>' +
        '<td class="mono">' + fmtTime(ev.t) + '</td>' +
        '<td>' + escapeHtml(state.nodes[ev.from].label) + '</td>' +
        '<td>' + escapeHtml(state.nodes[ev.to].label) + '</td>' +
        '<td><span class="dot" style="background:' + typeColor(ev.type) + '"></span>' + TYPE_LABELS[ev.type] + '</td>' +
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

    [...el.steps.querySelectorAll('.step')].forEach((b, i) => {
      b.classList.toggle('active', ev !== null && i === stepIndex);
      b.classList.toggle('done', ev !== null && i < stepIndex);
    });

    el.stepCounter.textContent = ev ? 'PASO ' + (stepIndex + 1) + ' DE ' + total : 'INICIO · ' + total + ' PASOS';
    el.stepTitle.textContent = step.title;
    el.stepSubtitle.textContent = step.subtitle;
    el.stepDescription.textContent = step.description;
    el.facts.innerHTML = (step.facts || []).map(([k, v]) => '<dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd>').join('');
    el.code.textContent = step.code || '';

    if (ev) {
      el.eventCard.classList.remove('empty');
      el.eventCard.style.setProperty('--ev', typeColor(ev.type));
      el.eventType.textContent = TYPE_LABELS[ev.type] + (ev.optional ? ' · alternativa' : '');
      el.eventType.style.background = typeColor(ev.type);
      el.eventRoute.textContent = state.nodes[ev.from].label + ' → ' + state.nodes[ev.to].label;
      el.eventInfo.textContent = ev.info;
      el.eventMeta.textContent = 'MENSAJE ' + (state.cursor + 1) + ' DE ' + state.events.length + ' · ' + fmtTime(ev.t) + (ev.size ? ' · ' + ev.size : '');
    } else {
      el.eventCard.classList.add('empty');
    }

    // Red
    el.svg.querySelectorAll('.node').forEach((g) => {
      const active = ev && (g.dataset.id === ev.from || g.dataset.id === ev.to);
      g.classList.toggle('active', !!active);
      g.classList.toggle('dim', !!ev && !active);
    });
    Object.keys(state.edges).forEach((key) => {
      const e = state.edges[key];
      const active = ev && key === edgeKey(ev.from, ev.to);
      e.path.classList.toggle('active', !!active);
      e.path.classList.toggle('rev', !!active && e.a !== ev.from);
      e.path.classList.toggle('dim', !!ev && !active);
      e.path.style.stroke = active ? typeColor(ev.type) : '';
    });

    // En pantallas angostas el diagrama se desplaza para seguir el mensaje.
    const nw = el.networkWrap;
    if (ev && state.view === 'network' && nw.scrollWidth > nw.clientWidth + 4) {
      const scale = el.svg.clientWidth / VIEW.w;
      const mid = ((state.nodes[ev.from].x + state.nodes[ev.to].x) / 2 - VIEW.x) * scale;
      nw.scrollTo({ left: Math.max(0, mid - nw.clientWidth / 2), behavior: reduceMotion() ? 'auto' : 'smooth' });
    }

    // Secuencia
    state.seqRows.forEach((r, i) => {
      r.g.classList.toggle('current', i === state.cursor);
      r.g.classList.toggle('future', i > state.cursor);
    });
    if (state.view === 'sequence') scrollSequenceToCurrent();

    // Tabla
    [...el.rows.children].forEach((tr, i) => {
      tr.classList.toggle('current', i === state.cursor);
      tr.classList.toggle('future', i > state.cursor);
    });

    // Controles
    el.progress.textContent = (state.cursor + 1) + ' / ' + state.events.length;
    el.btnPrev.disabled = state.cursor < 0;
    el.btnNext.disabled = state.cursor >= state.events.length - 1;
    el.btnPlay.classList.toggle('playing', state.playing);
    el.playLabel.textContent = state.playing ? 'Pausar' : (state.cursor >= state.events.length - 1 ? 'Repetir' : 'Reproducir');

    hooks.render.forEach((fn) => fn());
  }

  function scrollSequenceToCurrent() {
    const r = state.seqRows[state.cursor];
    const wrap = el.sequenceWrap;
    if (!r || wrap.hidden) { if (!r) wrap.scrollTop = 0; return; }
    const top = r.y - (wrap.clientHeight - 116) / 2;
    const minX = Math.min(r.xa, r.xb) - 80, maxX = Math.max(r.xa, r.xb) + 80;
    let leftPos = wrap.scrollLeft;
    if (minX < leftPos) leftPos = minX;
    else if (maxX > leftPos + wrap.clientWidth) leftPos = maxX - wrap.clientWidth;
    wrap.scrollTo({ top: Math.max(0, top), left: Math.max(0, leftPos), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  // ---------- Paquete animado ----------

  function packetCard(parent, ev, x, y, placement) {
    const g = svg('g', { class: 'packet' + (ev.optional ? ' optional' : '') }, parent);
    const head = (TYPE_LABELS[ev.type] || '').toUpperCase();
    const ht = svg('text', { class: 'p-head-text' }, g);
    ht.textContent = head;
    const bt = svg('text', { class: 'p-body-text' }, g);
    bt.textContent = ev.label;
    let w = 90;
    try { w = Math.max(ht.getComputedTextLength(), bt.getComputedTextLength()) + 18; } catch (e) { /* noop */ }
    const h = 38;
    let cx, top;
    if (placement === 'side') { cx = x + 18 + w / 2; top = y - h / 2; if (cx + w / 2 > VIEW.w - 4) cx = x - 18 - w / 2; }
    else { cx = x; top = y - 16 - h; }
    cx = Math.min(Math.max(cx, VIEW.x + w / 2 + 4), VIEW.x + VIEW.w - w / 2 - 4);
    top = Math.max(top, VIEW.y + 4);
    const left = cx - w / 2;
    const headRect = svg('rect', { class: 'p-head', x: left, y: top, width: w, height: 16, rx: 3 }, g);
    headRect.style.fill = typeColor(ev.type);
    const body = svg('rect', { class: 'p-body', x: left, y: top + 16, width: w, height: h - 16, rx: 3 }, g);
    body.style.stroke = typeColor(ev.type);
    g.insertBefore(headRect, ht);
    g.insertBefore(body, ht);
    ht.setAttribute('x', left + 9); ht.setAttribute('y', top + 11.5);
    bt.setAttribute('x', left + 9); bt.setAttribute('y', top + 32);
    return g;
  }

  function drawDot(parent, x, y, type) {
    const glow = svg('circle', { class: 'p-glow', cx: x, cy: y, r: 13 }, parent);
    glow.style.fill = typeColor(type);
    const dot = svg('circle', { class: 'p-dot', cx: x, cy: y, r: 6.5 }, parent);
    dot.style.fill = typeColor(type);
  }

  function drawPacket(ev, progress) {
    const layer = document.getElementById('packet-layer');
    const seqLayer = document.getElementById('seq-packet');
    if (layer) layer.innerHTML = '';
    if (seqLayer) seqLayer.innerHTML = '';
    if (!ev) return;

    // Red
    const edge = state.edges[edgeKey(ev.from, ev.to)];
    if (edge && layer) {
      const forward = edge.a === ev.from;
      const span = edge.endLen - edge.startLen;
      const pt = edge.path.getPointAtLength(edge.startLen + span * (forward ? progress : 1 - progress));
      const na = state.nodes[ev.from], nb = state.nodes[ev.to];
      const vertical = Math.abs(nb.y - na.y) > Math.abs(nb.x - na.x);
      packetCard(layer, ev, pt.x, pt.y, vertical ? 'side' : 'above');
      drawDot(layer, pt.x, pt.y, ev.type);
    }

    // Secuencia
    const r = state.seqRows[state.cursor];
    if (r && seqLayer) {
      const x = r.xa + (r.xb - r.xa) * progress;
      drawDot(seqLayer, x, r.cy, ev.type);
    }
  }

  function animatePacket(ev, done) {
    cancelAnimationFrame(state.rafId);
    if (reduceMotion()) { drawPacket(ev, 1); if (done) done(); return; }
    const duration = BASE_TRAVEL_MS / state.speed;
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
    goTo(state.cursor + 1, true, () => {
      if (!state.playing) return;
      const cur = state.events[state.cursor], nxt = state.events[state.cursor + 1];
      const pause = ((nxt && nxt.stepIndex !== cur.stepIndex) ? STEP_PAUSE_MS + BASE_PAUSE_MS : BASE_PAUSE_MS) / state.speed;
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

  // ---------- Vista y tema ----------

  function setView(view) {
    state.view = view;
    const seq = view === 'sequence';
    el.networkWrap.hidden = seq;
    el.sequenceWrap.hidden = !seq;
    el.viewNetwork.setAttribute('aria-selected', String(!seq));
    el.viewSequence.setAttribute('aria-selected', String(seq));
    if (seq) { buildSequence(); render(); drawPacket(state.events[state.cursor] || null, 1); }
  }

  function effectiveTheme() {
    const t = el.html.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function toggleTheme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    el.html.setAttribute('data-theme', next);
    try { localStorage.setItem('le-theme', next); } catch (e) { /* almacenamiento no disponible */ }
  }

  // ---------- Eventos de UI ----------

  el.btnPlay.addEventListener('click', togglePlay);
  el.btnNext.addEventListener('click', () => { stop(); goTo(state.cursor + 1, true); });
  el.btnPrev.addEventListener('click', () => { stop(); goTo(state.cursor - 1, false); });
  el.btnReset.addEventListener('click', () => { stop(); goTo(-1, false); });
  el.speed.addEventListener('change', () => { state.speed = parseFloat(el.speed.value) || 1; });
  el.viewNetwork.addEventListener('click', () => setView('network'));
  el.viewSequence.addEventListener('click', () => setView('sequence'));
  el.btnTheme.addEventListener('click', toggleTheme);
  el.btnMenu.addEventListener('click', openMenu);
  el.scrim.addEventListener('click', closeMenu);
  el.search.addEventListener('input', buildSidebar);

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'input' || tag === 'textarea') return;
    if (state.locked) { if (e.key === 'Escape') closeMenu(); return; }
    if (e.key === ' ' && tag !== 'button') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { stop(); goTo(state.cursor + 1, true); }
    else if (e.key === 'ArrowLeft') { stop(); goTo(state.cursor - 1, false); }
    else if (e.key === 'Home') { stop(); goTo(-1, false); }
    else if (e.key === 's' || e.key === 'S') { setView(state.view === 'network' ? 'sequence' : 'network'); }
    else if (e.key === 'Escape') { closeMenu(); }
  });

  // El hash puede traer un sufijo (#http/test); el proceso es la primera parte.
  const hashId = () => location.hash.slice(1).split('/')[0];
  window.addEventListener('hashchange', () => { if (!state.scenario || hashId() !== state.scenario.id) loadScenario(hashId()); });
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (state.view === 'sequence') { buildSequence(); render(); drawPacket(state.events[state.cursor] || null, 1); } }, 200);
  });

  // ---------- API para módulos externos ----------

  window.LaravelExplorer = {
    get scenario() { return state.scenario; },
    get events() { return state.events; },
    get cursor() { return state.cursor; },
    node: (id) => state.nodes[id],
    goTo,
    stop,
    setView,
    setSpeed(v) { state.speed = v; },
    restoreSpeed() { state.speed = parseFloat(el.speed.value) || 1; },
    lock(v) { state.locked = !!v; },
    // Resalta nodos sin depender del mensaje actual (p. ej. "¿quién envía el siguiente mensaje?").
    focus(ids) {
      const set = new Set(ids || []);
      el.svg.classList.toggle('has-focus', set.size > 0);
      el.svg.querySelectorAll('.node').forEach((g) => g.classList.toggle('asking', set.has(g.dataset.id)));
    },
    hint(id) {
      el.svg.querySelectorAll('.node').forEach((g) => g.classList.toggle('hint', !!id && g.dataset.id === id));
    },
    on(name, fn) { if (hooks[name]) hooks[name].push(fn); }
  };

  // ---------- Inicio ----------

  if (!scenarios.length) { el.stepTitle.textContent = 'No hay escenarios cargados'; return; }
  loadScenario(hashId() || scenarios[0].id);
})();
