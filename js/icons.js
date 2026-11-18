/*
 * Íconos isométricos en SVG, dibujados por código (sin imágenes).
 * ISO.draw(parent, { kind, glyph, group }) dibuja un ícono centrado en (0,0).
 *
 * kind:  laptop | phone | server | block | stack | cylinder | db | cloud
 * glyph: nombre de un símbolo de GLYPHS que se "pinta" sobre la cara superior.
 */
window.ISO = (function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const C = 0.866;  // cos 30°
  const S = 0.5;    // sin 30°

  // Símbolos 2D (24×24) que se proyectan sobre la cara superior.
  const GLYPHS = {
    file:     'M6 3h8l4 4v14H6z M14 3v4h4 M9 13h6 M9 17h6',
    box:      'M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10',
    plug:     'M9 2v6 M15 2v6 M6 8h12v3a6 6 0 0 1-12 0z M12 17v5',
    gear:     'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M12 2v4 M12 18v4 M2 12h4 M18 12h4 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3',
    route:    'M6 3v12 M21 6a3 3 0 1 1-6 0a3 3 0 1 1 6 0 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0 M18 9a9 9 0 0 1-9 9',
    layers:   'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
    code:     'M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
    table:    'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14',
    layout:   'M3 4h18v16H3z M3 9h18 M9 9v11',
    flag:     'M5 21V4 M5 4h12l-2 4 2 4H5',
    send:     'M3 12h14 M12 6l6 6-6 6',
    briefcase:'M3 8h18v12H3z M8 8V5h8v3 M3 13h18',
    eye:      'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
    key:      'M20 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M13 11l-9 9 M6 18l2 2 M9 15l2 2',
    user:     'M16 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M4 21a8 8 0 0 1 16 0',
    hash:     'M4 9h16 M4 15h16 M10 3L8 21 M16 3l-2 18',
    shield:   'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
    bell:     'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
    form:     'M4 4h16v16H4z M7 8h10 M7 12h10 M7 16h6',
    bolt:     'M13 2L4 14h7l-1 8 9-12h-7z',
    x:        'M6 6l12 12 M18 6L6 18',
    globe:    'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0 M3 12h18 M12 3c3.5 3.5 3.5 14.5 0 18 M12 3c-3.5 3.5-3.5 14.5 0 18',
    mail:     'M3 6h18v12H3z M3 6l9 7 9-7',
    clock:    'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0 M12 7v5l3 2',
    calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
    terminal: 'M3 5h18v14H3z M7 9l3 3-3 3 M12 15h5',
    lock:     'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
    chart:    'M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6',
    braces:   'M8 4c-2 0-3 1-3 3v2c0 1.5-1 2-2 3 1 1 2 1.5 2 3v2c0 2 1 3 3 3 M16 4c2 0 3 1 3 3v2c0 1.5 1 2 2 3-1 1-2 1.5-2 3v2c0 2-1 3-3 3',
    broadcast:'M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M7.8 16.2a6 6 0 0 1 0-8.4 M16.2 7.8a6 6 0 0 1 0 8.4 M5 19a10 10 0 0 1 0-14 M19 5a10 10 0 0 1 0 14'
  };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // Proyección isométrica: (x, y, z) del mundo → (sx, sy) en pantalla.
  function P(x, y, z) { return [(x - y) * C, (x + y) * S - z]; }
  function pts(list) { return list.map((p) => P(p[0], p[1], p[2]).map((v) => v.toFixed(2)).join(',')).join(' '); }

  function face(parent, points, shade) {
    return el('polygon', { points: pts(points), class: 'iso-face ' + shade }, parent);
  }

  // Caja con su esquina (x0,y0,z0) y tamaño w×d×h. Devuelve el centro de la cara superior.
  function box(parent, x0, y0, z0, w, d, h) {
    const x1 = x0 + w, y1 = y0 + d, z1 = z0 + h;
    face(parent, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 'shade-left');
    face(parent, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 'shade-right');
    face(parent, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 'shade-top');
    return { c: P(x0 + w / 2, y0 + d / 2, z1), w, d };
  }

  // Pinta un glifo 2D sobre una cara superior isométrica.
  function glyphOnTop(parent, name, top, size) {
    const d = GLYPHS[name];
    if (!d) return;
    const k = (Math.min(top.w, top.d) * (size || 0.62)) / 24;
    const a = C * k, b = S * k, c = -C * k, dd = S * k;
    const e = top.c[0] - 12 * a - 12 * c;
    const f = top.c[1] - 12 * b - 12 * dd;
    el('path', {
      d, class: 'iso-glyph',
      transform: 'matrix(' + [a, b, c, dd, e, f].map((v) => v.toFixed(3)).join(' ') + ')',
      'vector-effect': 'non-scaling-stroke'
    }, parent);
  }

  // Cilindro vertical de radio r entre z0 y z0+h.
  function cylinder(parent, z0, h, r) {
    const rx = r * 1.2247, ry = r * 0.7071;
    const yb = -z0, yt = -(z0 + h);
    el('path', {
      d: 'M' + (-rx) + ',' + yb + ' A' + rx + ',' + ry + ' 0 0 0 ' + rx + ',' + yb +
         ' L' + rx + ',' + yt + ' A' + rx + ',' + ry + ' 0 0 1 ' + (-rx) + ',' + yt + ' Z',
      class: 'iso-face shade-left'
    }, parent);
    el('ellipse', { cx: 0, cy: yt, rx, ry, class: 'iso-face shade-top' }, parent);
    return { c: [0, yt], w: r * 2, d: r * 2, rx, ry };
  }

  const KINDS = {
    laptop(g, o) {
      const top = box(g, -30, -20, 0, 60, 40, 4);
      // teclado
      const k = el('g', { class: 'iso-detail' }, g);
      for (let i = 0; i < 3; i++) {
        el('polyline', { points: pts([[-24, -14 + i * 7, 4], [14, -14 + i * 7, 4]]) }, k);
      }
      // pantalla (plano y = -20, de pie)
      face(g, [[-30, -20, 4], [30, -20, 4], [30, -20, 46], [-30, -20, 46]], 'shade-left');
      face(g, [[-26, -20, 8], [26, -20, 8], [26, -20, 42], [-26, -20, 42]], 'shade-screen');
      const lines = el('g', { class: 'iso-detail' }, g);
      [34, 28, 22].forEach((z, i) => {
        el('polyline', { points: pts([[-20, -20, z], [i === 2 ? 4 : 18, -20, z]]) }, lines);
      });
      return top;
    },
    phone(g, o) {
      const top = box(g, -17, -30, 0, 34, 60, 6);
      face(g, [[-13, -24, 6], [13, -24, 6], [13, 20, 6], [-13, 20, 6]], 'shade-screen');
      const d = el('g', { class: 'iso-detail' }, g);
      el('polyline', { points: pts([[-5, 25, 6], [5, 25, 6]]) }, d);
      [-16, -8, 0].forEach((y, i) => {
        el('polyline', { points: pts([[-8, y, 6], [i === 2 ? 2 : 8, y, 6]]) }, d);
      });
      return top;
    },
    server(g, o) {
      let top;
      for (let i = 0; i < 3; i++) {
        top = box(g, -24, -24, i * 15, 48, 48, 12);
        const leds = el('g', { class: 'iso-led' }, g);
        el('polyline', { points: pts([[24, -16, i * 15 + 6], [24, 2, i * 15 + 6]]) }, leds);
        el('circle', { cx: P(24, 12, i * 15 + 6)[0], cy: P(24, 12, i * 15 + 6)[1], r: 1.8 }, leds);
      }
      glyphOnTop(g, o.glyph, top, 0.55);
      return top;
    },
    block(g, o) {
      const top = box(g, -27, -27, 0, 54, 54, 20);
      glyphOnTop(g, o.glyph, top, 0.62);
      return top;
    },
    stack(g, o) {
      let top;
      for (let i = 0; i < 3; i++) top = box(g, -27, -27, i * 11, 54, 54, 6);
      glyphOnTop(g, o.glyph, top, 0.5);
      return top;
    },
    cylinder(g, o) {
      const top = cylinder(g, 0, 30, 24);
      glyphOnTop(g, o.glyph, { c: top.c, w: 34, d: 34 }, 0.6);
      return top;
    },
    db(g, o) {
      let top;
      for (let i = 0; i < 3; i++) top = cylinder(g, i * 14, 11, 24);
      if (o.glyph) glyphOnTop(g, o.glyph, { c: top.c, w: 34, d: 34 }, 0.6);
      return top;
    },
    cloud(g, o) {
      const shapes = [
        ['circle', { cx: -20, cy: 4, r: 14 }],
        ['circle', { cx: 0, cy: -8, r: 19 }],
        ['circle', { cx: 21, cy: 3, r: 15 }],
        ['rect', { x: -20, y: 4, width: 41, height: 14 }]
      ];
      // sombra (profundidad)
      const back = el('g', { class: 'iso-cloud-back', transform: 'translate(0,7)' }, g);
      shapes.forEach(([t, a]) => el(t, a, back));
      // contorno y relleno
      const outline = el('g', { class: 'iso-cloud-outline' }, g);
      shapes.forEach(([t, a]) => el(t, a, outline));
      const fill = el('g', { class: 'iso-cloud-fill' }, g);
      shapes.forEach(([t, a]) => el(t, a, fill));
      if (o.glyph && GLYPHS[o.glyph]) {
        el('path', { d: GLYPHS[o.glyph], class: 'iso-glyph', transform: 'translate(-9,-3) scale(0.75)' }, g);
      }
      return null;
    }
  };

  function draw(parent, opts) {
    const g = el('g', { class: 'iso iso-' + opts.kind, style: '--c: var(--g-' + opts.group + ')' }, parent);
    (KINDS[opts.kind] || KINDS.block)(g, opts);
    // Centrar el ícono en (0,0) según su caja real.
    try {
      const bb = g.getBBox();
      if (bb.width) {
        const dx = -(bb.x + bb.width / 2), dy = -(bb.y + bb.height / 2);
        g.setAttribute('transform', 'translate(' + dx.toFixed(1) + ',' + dy.toFixed(1) + ')');
      }
    } catch (e) { /* SVG oculto: se queda sin centrar */ }
    return g;
  }

  return { draw, GLYPHS };
})();
