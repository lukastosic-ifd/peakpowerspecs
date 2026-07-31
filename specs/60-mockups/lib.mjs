// Wireframe primitives for the PeakPower mockups.
// Everything returns an SVG fragment string; screens compose them.

export const W = 1440;
export const H = 900;

export const C = {
  bg:      '#eef2f6',
  panel:   '#ffffff',
  panel2:  '#f8fafc',
  border:  '#dbe3ec',
  border2: '#c3cede',
  text:    '#0f172a',
  muted:   '#64748b',
  faint:   '#94a3b8',
  accent:  '#0d9488',
  accentBg:'#ccfbf1',
  amber:   '#d97706',
  amberBg: '#fef3c7',
  danger:  '#dc2626',
  dangerBg:'#fee2e2',
  green:   '#15803d',
  greenBg: '#dcfce7',
  indigo:  '#4f46e5',
  indigoBg:'#e0e7ff',
  navBg:   '#0f2b33',
  navText: '#cbd5e1',
  navActive:'#14b8a6',
  // chart series
  sConsume:'#0f766e',
  sProduce:'#ca8a04',
  sBlock:  '#4f46e5',
  sUncov:  '#ea580c',
  sSurplus:'#0891b2',
};

export const FONT = "Inter, 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function rect(x, y, w, h, o = {}) {
  const {
    fill = C.panel, stroke = C.border, sw = 1, r = 8, opacity = 1, dash = null,
  } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"`
    + (stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ' stroke="none"')
    + (dash ? ` stroke-dasharray="${dash}"` : '')
    + (opacity !== 1 ? ` opacity="${opacity}"` : '') + '/>';
}

export function text(x, y, s, o = {}) {
  const {
    size = 13, fill = C.text, weight = 400, anchor = 'start', mono = false, opacity = 1,
  } = o;
  return `<text x="${x}" y="${y}" font-family="${mono ? MONO : FONT}" font-size="${size}"`
    + ` fill="${fill}" font-weight="${weight}" text-anchor="${anchor}"`
    + (opacity !== 1 ? ` opacity="${opacity}"` : '')
    + `>${esc(s)}</text>`;
}

export function line(x1, y1, x2, y2, o = {}) {
  const { stroke = C.border, sw = 1, dash = null } = o;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"`
    + (dash ? ` stroke-dasharray="${dash}"` : '') + ' stroke-linecap="round"/>';
}

export function path(d, o = {}) {
  const { fill = 'none', stroke = 'none', sw = 2, opacity = 1, dash = null, cap = 'round' } = o;
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`
    + ` stroke-linejoin="round" stroke-linecap="${cap}"`
    + (dash ? ` stroke-dasharray="${dash}"` : '')
    + (opacity !== 1 ? ` opacity="${opacity}"` : '') + '/>';
}

export function circle(cx, cy, r, o = {}) {
  const { fill = C.accent, stroke = 'none', sw = 1 } = o;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

/** Rounded pill label. */
export function badge(x, y, label, variant = 'muted', o = {}) {
  const map = {
    muted:  [C.panel2,   C.muted,  C.border2],
    accent: [C.accentBg, '#0f766e', '#5eead4'],
    amber:  [C.amberBg,  '#92400e', '#fcd34d'],
    danger: [C.dangerBg, '#991b1b', '#fca5a5'],
    green:  [C.greenBg,  '#166534', '#86efac'],
    indigo: [C.indigoBg, '#3730a3', '#a5b4fc'],
  };
  const [bg, fg, br] = map[variant] || map.muted;
  const size = o.size || 11;
  const w = o.w || Math.max(38, label.length * (size * 0.58) + 18);
  const h = o.h || 20;
  return rect(x, y, w, h, { fill: bg, stroke: br, r: h / 2 })
    + text(x + w / 2, y + h / 2 + size * 0.36, label, { size, fill: fg, weight: 600, anchor: 'middle' });
}

export function button(x, y, w, label, variant = 'primary', o = {}) {
  const h = o.h || 34;
  const map = {
    primary:   [C.accent,  '#ffffff', C.accent],
    secondary: [C.panel,   C.text,    C.border2],
    danger:    [C.danger,  '#ffffff', C.danger],
    amber:     [C.amber,   '#ffffff', C.amber],
    ghost:     ['none',    C.accent,  'none'],
    disabled:  [C.panel2,  C.faint,   C.border],
  };
  const [bg, fg, br] = map[variant] || map.primary;
  return rect(x, y, w, h, { fill: bg, stroke: br === 'none' ? null : br, r: 7 })
    + text(x + w / 2, y + h / 2 + 4.5, label, { size: 13, fill: fg, weight: 600, anchor: 'middle' });
}

export function panel(x, y, w, h, title, o = {}) {
  let s = rect(x, y, w, h, { fill: C.panel, stroke: C.border, r: 10 });
  if (title) {
    s += text(x + 18, y + 26, title, { size: 13.5, weight: 700, fill: C.text });
    if (o.subtitle) s += text(x + 18, y + 44, o.subtitle, { size: 11.5, fill: C.muted });
    if (o.right) s += text(x + w - 18, y + 26, o.right, { size: 11.5, fill: C.muted, anchor: 'end' });
    if (o.rule !== false) s += line(x, y + (o.subtitle ? 58 : 40), x + w, y + (o.subtitle ? 58 : 40), { stroke: C.border });
  }
  return s;
}

export function kpi(x, y, w, label, value, sub, o = {}) {
  const h = o.h || 86;
  const accent = o.accent || C.text;
  return rect(x, y, w, h, { fill: o.fill || C.panel, stroke: C.border, r: 10 })
    + text(x + 16, y + 24, label, { size: 11, fill: C.muted, weight: 600 })
    + text(x + 16, y + 52, value, { size: 23, fill: accent, weight: 700 })
    + (sub ? text(x + 16, y + 71, sub, { size: 11, fill: o.subFill || C.faint }) : '');
}

/** Simple data table. cols: [{label,w,align}], rows: [[cell,...]] where cell = string | {t,fill,weight,badge,mono} */
export function table(x, y, w, cols, rows, o = {}) {
  const rowH = o.rowH || 34;
  const headH = o.headH || 30;
  // Guard: column widths must fit the table, or cells silently overflow the canvas.
  const total = cols.reduce((a, c) => a + c.w, 0);
  if (total > w + 0.5) {
    throw new Error(`table columns sum to ${total} but width is ${w} (overflow ${total - w}px): `
      + cols.map((c) => `${c.label || '·'}=${c.w}`).join(' '));
  }
  let s = '';
  let cx = x;
  s += rect(x, y, w, headH, { fill: C.panel2, stroke: null, r: 6 });
  cols.forEach((c) => {
    const tx = c.align === 'end' ? cx + c.w - 12 : cx + 12;
    s += text(tx, y + headH / 2 + 4, c.label, {
      size: 10.5, fill: C.muted, weight: 700, anchor: c.align === 'end' ? 'end' : 'start',
    });
    cx += c.w;
  });
  rows.forEach((row, ri) => {
    const ry = y + headH + ri * rowH;
    if (o.zebra !== false && ri % 2 === 1) s += rect(x, ry, w, rowH, { fill: '#fbfdff', stroke: null, r: 0 });
    s += line(x, ry, x + w, ry, { stroke: C.border });
    let ccx = x;
    row.forEach((cell, ci) => {
      const c = cols[ci];
      if (!c) return;
      const obj = typeof cell === 'object' && cell !== null ? cell : { t: cell };
      if (obj.badge) {
        s += badge(ccx + 12, ry + (rowH - 20) / 2, obj.t, obj.badge);
      } else if (obj.bar !== undefined) {
        const bw = c.w - 24;
        s += rect(ccx + 12, ry + rowH / 2 - 4, bw, 8, { fill: C.panel2, stroke: null, r: 4 });
        s += rect(ccx + 12, ry + rowH / 2 - 4, bw * obj.bar, 8, { fill: obj.fill || C.accent, stroke: null, r: 4 });
      } else {
        const tx = c.align === 'end' ? ccx + c.w - 12 : ccx + 12;
        s += text(tx, ry + rowH / 2 + 4.5, obj.t, {
          size: obj.size || 12,
          fill: obj.fill || C.text,
          weight: obj.weight || 400,
          mono: !!obj.mono,
          anchor: c.align === 'end' ? 'end' : 'start',
        });
        if (obj.sub) {
          s += text(tx, ry + rowH / 2 + 17, obj.sub, {
            size: 10, fill: C.faint, anchor: c.align === 'end' ? 'end' : 'start',
          });
        }
      }
      ccx += c.w;
    });
  });
  s += line(x, y + headH + rows.length * rowH, x + w, y + headH + rows.length * rowH, { stroke: C.border });
  return s;
}

export function field(x, y, w, label, value, o = {}) {
  const h = o.h || 38;
  return text(x, y - 6, label, { size: 10.5, fill: C.muted, weight: 600 })
    + rect(x, y, w, h, { fill: o.readonly ? C.panel2 : C.panel, stroke: o.focus ? C.accent : C.border2, sw: o.focus ? 2 : 1, r: 7 })
    + text(x + 12, y + h / 2 + 4.5, value, { size: 13, fill: o.valueFill || (value ? C.text : C.faint), mono: !!o.mono, weight: o.weight || 400 })
    + (o.suffix ? text(x + w - 12, y + h / 2 + 4.5, o.suffix, { size: 12, fill: C.muted, anchor: 'end' }) : '');
}

export function statLine(x, y, w, label, value, o = {}) {
  return text(x, y, label, { size: 12, fill: C.muted })
    + text(x + w, y, value, { size: 12, fill: o.fill || C.text, weight: o.weight || 600, anchor: 'end', mono: !!o.mono });
}

/** Browser chrome + app shell with left nav. Returns {svg, cx, cy, cw, ch} content box. */
export function shell(opts) {
  const {
    portal = 'customer', title = '', crumb = '', nav = [], active = 0,
    user = 'J. de Vries · Vandersteen Koeling B.V.', actions = [],
  } = opts;
  const navW = 218;
  const topH = 56;
  let s = rect(0, 0, W, H, { fill: C.bg, stroke: null, r: 0 });

  // left nav
  s += rect(0, 0, navW, H, { fill: C.navBg, stroke: null, r: 0 });
  s += `<g>${circle(30, 34, 11, { fill: C.navActive })}`
    + path('M 26 34 L 30 27 L 30 33 L 34 33 L 30 41 L 30 35 Z', { fill: C.navBg })
    + '</g>';
  s += text(50, 33, 'PeakPower', { size: 15, fill: '#ffffff', weight: 700 });
  s += text(50, 47, portal === 'employee' ? 'Back office' : 'Customer portal', { size: 10, fill: '#5eead4', weight: 600 });

  nav.forEach((n, i) => {
    const y = 84 + i * 38;
    const isActive = i === active;
    if (isActive) s += rect(10, y, navW - 20, 32, { fill: 'rgba(20,184,166,0.16)', stroke: null, r: 7 });
    if (isActive) s += rect(10, y, 3, 32, { fill: C.navActive, stroke: null, r: 2 });
    s += text(26, y + 21, n, { size: 12.5, fill: isActive ? '#ffffff' : C.navText, weight: isActive ? 600 : 400 });
  });

  s += text(26, H - 30, user.length > 30 ? user.slice(0, 29) + '…' : user, { size: 10.5, fill: C.faint });

  // top bar
  s += rect(navW, 0, W - navW, topH, { fill: C.panel, stroke: null, r: 0 });
  s += line(navW, topH, W, topH, { stroke: C.border });
  s += text(navW + 28, 28, title, { size: 17, weight: 700, fill: C.text });
  if (crumb) s += text(navW + 28, 44, crumb, { size: 11, fill: C.muted });

  let ax = W - 28;
  [...actions].reverse().forEach((a) => {
    const bw = a.w || Math.max(90, a.label.length * 7.4 + 28);
    ax -= bw;
    s += button(ax, 11, bw, a.label, a.variant || 'primary');
    ax -= 10;
  });

  return { svg: s, cx: navW + 28, cy: topH + 24, cw: W - navW - 56, ch: H - topH - 48, navW, topH };
}

export function svgDoc(body, o = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label || 'Mockup')}">`
    + `<title>${esc(o.label || 'Mockup')}</title>`
    + body
    + '</svg>';
}

/** Deterministic pseudo-random, so regenerating produces identical files. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Load-shape curve for a working day, 96 points, kWh per interval.
 * Night base, morning ramp, midday plateau, evening decline.
 */
export function loadShape(seed = 7, base = 380, peak = 640) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < 96; i++) {
    const hour = i / 4;
    let v;
    if (hour < 5.5) v = base * (0.94 + 0.05 * Math.sin(hour));
    else if (hour < 8) v = base + (peak - base) * ((hour - 5.5) / 2.5) * 0.55;
    else if (hour < 12) v = base + (peak - base) * (0.55 + 0.45 * ((hour - 8) / 4));
    else if (hour < 13) v = peak * 0.93;
    else if (hour < 18) v = base + (peak - base) * (0.92 - 0.08 * ((hour - 13) / 5));
    else if (hour < 20.5) v = base + (peak - base) * (0.84 - 0.62 * ((hour - 18) / 2.5));
    else v = base * (1.06 - 0.09 * ((hour - 20.5) / 3.5));
    pts.push(Math.round(v * (0.965 + r() * 0.07)));
  }
  return pts;
}

/** Block power in MW per interval for a base+peak position. */
export function blockShape(baseMw, peakMw) {
  const pts = [];
  for (let i = 0; i < 96; i++) {
    const hour = i / 4;
    pts.push(baseMw + (hour >= 8 && hour < 20 ? peakMw : 0));
  }
  return pts;
}

export function polyline(pts, x, y, w, h, maxV, o = {}) {
  const step = w / (pts.length - 1);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(x + i * step).toFixed(1)} ${(y + h - (v / maxV) * h).toFixed(1)}`).join(' ');
  return path(d, { stroke: o.stroke || C.sConsume, sw: o.sw || 2, opacity: o.opacity });
}

export function areaFill(pts, x, y, w, h, maxV, o = {}) {
  const step = w / (pts.length - 1);
  const top = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(x + i * step).toFixed(1)} ${(y + h - (v / maxV) * h).toFixed(1)}`).join(' ');
  const d = `${top} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  return path(d, { fill: o.fill || C.sConsume, opacity: o.opacity ?? 0.14, stroke: 'none' });
}

/** Step line (blocks hold a constant value across each interval). */
export function stepline(pts, x, y, w, h, maxV, o = {}) {
  const step = w / pts.length;
  let d = '';
  pts.forEach((v, i) => {
    const px = x + i * step;
    const py = y + h - (v / maxV) * h;
    d += (i === 0 ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`);
    d += ` L ${(px + step).toFixed(1)} ${py.toFixed(1)}`;
  });
  return path(d, { stroke: o.stroke || C.sBlock, sw: o.sw || 2, dash: o.dash, cap: 'butt' });
}

/** Band between the block line and the consumption line, split into covered / uncovered. */
export function coverageBands(cons, blockKwh, x, y, w, h, maxV) {
  const step = w / cons.length;
  let over = '';
  let under = '';
  for (let i = 0; i < cons.length; i++) {
    const px = x + i * step;
    const c = cons[i];
    const b = blockKwh[i];
    const yc = y + h - (c / maxV) * h;
    const yb = y + h - (b / maxV) * h;
    if (c > b) over += `<rect x="${px.toFixed(1)}" y="${yc.toFixed(1)}" width="${(step + 0.6).toFixed(1)}" height="${(yb - yc).toFixed(1)}" fill="${C.sUncov}" opacity="0.55"/>`;
    else if (b > c) under += `<rect x="${px.toFixed(1)}" y="${yb.toFixed(1)}" width="${(step + 0.6).toFixed(1)}" height="${(yc - yb).toFixed(1)}" fill="${C.sSurplus}" opacity="0.3"/>`;
  }
  return under + over;
}

export function axis(x, y, w, h, labels, o = {}) {
  let s = '';
  const gl = o.gridLines ?? 4;
  for (let i = 0; i <= gl; i++) {
    const gy = y + (h / gl) * i;
    s += line(x, gy, x + w, gy, { stroke: i === gl ? C.border2 : C.border, dash: i === gl ? null : '3 4' });
    if (o.yLabels) {
      s += text(x - 10, gy + 4, o.yLabels[i], { size: 10, fill: C.faint, anchor: 'end' });
    }
  }
  labels.forEach((l, i) => {
    const lx = x + (w / (labels.length - 1)) * i;
    s += text(lx, y + h + 18, l, { size: 10, fill: C.faint, anchor: i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle' });
  });
  return s;
}

export function legend(x, y, items, o = {}) {
  let s = '';
  let lx = x;
  items.forEach((it) => {
    if (it.dash) {
      s += line(lx, y, lx + 16, y, { stroke: it.color, sw: 2.5, dash: '4 3' });
    } else {
      s += rect(lx, y - 5, 12, 10, { fill: it.color, stroke: null, r: 2, opacity: it.opacity ?? 1 });
    }
    s += text(lx + (it.dash ? 22 : 18), y + 4, it.label, { size: 11, fill: C.muted });
    lx += (it.dash ? 22 : 18) + it.label.length * 5.9 + (o.gap ?? 22);
  });
  return s;
}

export function note(x, y, w, body, variant = 'amber') {
  const map = { amber: [C.amberBg, '#fcd34d', '#92400e'], danger: [C.dangerBg, '#fca5a5', '#991b1b'], accent: [C.accentBg, '#5eead4', '#0f766e'], muted: [C.panel2, C.border2, C.muted] };
  const [bg, br, fg] = map[variant];
  const h = 40;
  return rect(x, y, w, h, { fill: bg, stroke: br, r: 8 })
    + text(x + 14, y + h / 2 + 4.5, body, { size: 12, fill: fg, weight: 500 });
}
