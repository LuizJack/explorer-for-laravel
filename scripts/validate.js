#!/usr/bin/env node
/*
 * Revisa que los procesos de js/scenarios/ estén bien formados.
 * No necesita dependencias:   node scripts/validate.js
 * Termina con código 1 si encuentra errores, para poder usarlo en un chequeo automático.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'js', 'scenarios');
const GROUPS = ['client', 'server', 'laravel', 'data', 'external'];
const TYPES = ['request', 'response', 'sql', 'cache', 'queue', 'internal', 'error'];

const errors = [];
const warnings = [];
const text = (v) => typeof v === 'string' && v.trim().length > 0;

global.window = { SCENARIOS: [] };
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

files.forEach((file) => {
  const before = window.SCENARIOS.length;
  try {
    require(path.join(dir, file));
  } catch (e) {
    errors.push(file + ': no se pudo cargar (' + e.message + ')');
    return;
  }
  if (window.SCENARIOS.length !== before + 1) errors.push(file + ': debe registrar exactamente un proceso con window.SCENARIOS.push()');
  if (!index.includes('js/scenarios/' + file)) errors.push(file + ': falta su <script> en index.html');
});

const seen = new Set();
window.SCENARIOS.forEach((s) => {
  const at = '[' + (s.id || '¿sin id?') + '] ';
  const err = (m) => errors.push(at + m);
  const warn = (m) => warnings.push(at + m);

  if (!/^[a-z][a-z0-9-]*$/.test(s.id || '')) err('id inválido: usa minúsculas, números y guiones');
  if (seen.has(s.id)) err('id repetido');
  seen.add(s.id);
  ['name', 'category', 'tagline'].forEach((k) => { if (!text(s[k])) err('falta "' + k + '"'); });

  // Nodos
  const ids = new Set();
  (s.nodes || []).forEach((n) => {
    if (!text(n.id) || ids.has(n.id)) err('nodo sin id o con id repetido: ' + n.id);
    ids.add(n.id);
    if (!text(n.label)) err('nodo ' + n.id + ': falta label');
    if (!GROUPS.includes(n.group)) err('nodo ' + n.id + ': group debe ser uno de ' + GROUPS.join(', '));
    if (!(n.x >= 60 && n.x <= 940 && n.y >= 100 && n.y <= 500)) err('nodo ' + n.id + ': fuera del lienzo (x 60–940, y 100–500)');
    if ((n.label || '').length > 18) warn('nodo ' + n.id + ': el label supera 18 caracteres y se verá comprimido');
  });
  (s.nodes || []).forEach((a, i) => s.nodes.slice(i + 1).forEach((b) => {
    if (Math.abs(a.x - b.x) < 130 && Math.abs(a.y - b.y) < 150) warn('los nodos ' + a.id + ' y ' + b.id + ' quedan muy juntos');
  }));
  if (!ids.size) err('no tiene nodos');

  // Pasos y mensajes
  const used = new Set();
  let last = -Infinity, count = 0, asks = 0;
  if (!(s.steps || []).length) err('no tiene pasos');
  (s.steps || []).forEach((st, si) => {
    const where = 'paso ' + (si + 1) + ': ';
    ['title', 'subtitle', 'description'].forEach((k) => { if (!text(st[k])) err(where + 'falta "' + k + '"'); });
    if (!(st.events || []).length) err(where + 'no tiene mensajes');
    (st.events || []).forEach((ev) => {
      count++;
      const w = where + 'mensaje ' + ev.from + ' → ' + ev.to + ' (t=' + ev.t + '): ';
      if (!ids.has(ev.from)) err(w + 'el origen no es un nodo');
      if (!ids.has(ev.to)) err(w + 'el destino no es un nodo');
      if (ev.from === ev.to) err(w + 'origen y destino son el mismo nodo');
      if (!TYPES.includes(ev.type)) err(w + 'type debe ser uno de ' + TYPES.join(', '));
      if (typeof ev.t !== 'number' || ev.t < last) err(w + 'el tiempo debe ser un número y no retroceder');
      else last = ev.t;
      if (!text(ev.label) || !text(ev.info)) err(w + 'faltan label o info');
      if ((ev.label || '').length > 20) warn(w + 'el label supera 20 caracteres');
      if (ev.ask !== undefined) {
        asks++;
        if (!text(ev.ask) || !ev.ask.trim().endsWith('?')) err(w + '"ask" debe ser una pregunta que termine en ?');
      }
      used.add(ev.from);
      used.add(ev.to);
    });
  });
  [...ids].filter((id) => !used.has(id)).forEach((id) => warn('el nodo ' + id + ' no participa en ningún mensaje'));
  if (!asks) warn('no tiene retos ("ask"): el test «Predice el siguiente paso» elegirá mensajes por su cuenta');

  // Preguntas
  if (!(s.quiz || []).length) warn('no tiene preguntas ("quiz")');
  (s.quiz || []).forEach((q, qi) => {
    const w = 'pregunta ' + (qi + 1) + ': ';
    if (!text(q.q) || !text(q.explain)) err(w + 'faltan "q" o "explain"');
    if (!Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(text)) err(w + 'debe tener 4 opciones con texto');
    else if (new Set(q.options).size !== 4) err(w + 'tiene opciones repetidas');
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) err(w + '"answer" debe ser la posición (0–3) de la opción correcta');
    (q.nodes || []).forEach((n) => { if (!ids.has(n)) err(w + 'el nodo "' + n + '" no existe'); });
  });

  console.log('✓ ' + s.id.padEnd(12) + (s.steps || []).length + ' pasos · ' + count + ' mensajes · ' + asks + ' retos · ' + (s.quiz || []).length + ' preguntas');
});

if (warnings.length) console.log('\nAvisos:\n' + warnings.map((w) => '  - ' + w).join('\n'));
if (errors.length) {
  console.error('\nErrores:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log('\nTodo en orden: ' + window.SCENARIOS.length + ' procesos.');
