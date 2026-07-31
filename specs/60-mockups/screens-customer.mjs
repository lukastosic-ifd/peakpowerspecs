import {
  C, W, H, rect, text, line, path, circle, badge, button, panel, kpi, table, field,
  statLine, shell, svgDoc, loadShape, blockShape, polyline, areaFill, stepline,
  coverageBands, axis, legend, note,
} from './lib.mjs';

const NAV = ['Dashboard', 'Connections', 'Consumption', 'Prices', 'Trading', 'Wallet', 'Invoices'];
const USER = 'J. de Vries · Vandersteen Koeling';

const HOURS = ['00', '03', '06', '09', '12', '15', '18', '21', '24'];

/** Dutch number formatting: 1.234,56 */
const nl = (v, dec = 2) => {
  const [i, d] = Math.abs(v).toFixed(dec).split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '−' : '') + ii + (dec ? ',' + d : '');
};
const eur = (v, dec = 2) => `€ ${nl(v, dec)}`;
const sum = (a) => a.reduce((x, y) => x + y, 0);

/* ────────────────────────────────────────────────────────────── dashboard */
export function customerDashboard() {
  const s = shell({ portal: 'customer', title: 'Dashboard', crumb: 'Vandersteen Koeling B.V. · 6 connections', nav: NAV, active: 0, user: USER });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const kw = (cw - 3 * 16) / 4;
  b += kpi(cx, cy, kw, 'AVAILABLE BALANCE', eur(19722), 'settled € 29.122 · reserved € 9.400', { accent: C.text });
  b += kpi(cx + (kw + 16), cy, kw, 'COVERAGE — AUGUST', '78,4 %', 'of measured consumption', { accent: C.accent });
  b += kpi(cx + 2 * (kw + 16), cy, kw, 'UNCOVERED VOLUME', '214,4 MWh', '≈ € 18.953 at day-ahead', { accent: C.sUncov });
  b += kpi(cx + 3 * (kw + 16), cy, kw, 'OPEN TRADES', '2', '1 awaiting your response', { accent: C.amber });

  // urgent offer banner
  const by = cy + 102;
  b += rect(cx, by, cw, 60, { fill: C.amberBg, stroke: '#fcd34d', r: 10 });
  b += circle(cx + 30, by + 30, 11, { fill: C.amber });
  b += text(cx + 30, by + 34, '!', { size: 15, fill: '#fff', weight: 700, anchor: 'middle' });
  b += text(cx + 52, by + 26, 'Offer received — Base Nov-2026 · 0,2 MW · € 102,4000/MWh · € 14.745,60', { size: 13.5, weight: 700, fill: '#78350f' });
  b += text(cx + 52, by + 45, 'Respond before 15:01 — the price is firm until then.', { size: 11.5, fill: '#92400e' });
  b += text(cx + cw - 200, by + 38, '24:47', { size: 24, weight: 700, fill: C.amber, anchor: 'end', mono: true });
  b += button(cx + cw - 176, by + 13, 158, 'View offer', 'amber');

  // price strip
  const py = by + 76;
  b += panel(cx, py, cw, 132, 'Price indications', { subtitle: 'Indicative only — not an offer', right: 'updated 14:22' });
  const tiles = [
    ['Base — Sep 26', '€ 78,45', '+1,25', true], ['Peak — Sep 26', '€ 96,15', '+2,10', true],
    ['Base — Q4 26', '€ 84,20', '−0,45', false], ['Peak — Q4 26', '€ 103,70', '−1,05', false],
    ['Base — Cal 27', '€ 79,90', '+0,35', true], ['Peak — Cal 27', '€ 98,25', '+0,80', true],
  ];
  const tw = (cw - 36 - 5 * 12) / 6;
  tiles.forEach((t, i) => {
    const tx = cx + 18 + i * (tw + 12);
    b += rect(tx, py + 68, tw, 50, { fill: C.panel2, stroke: C.border, r: 8 });
    b += text(tx + 12, py + 86, t[0], { size: 10.5, fill: C.muted, weight: 600 });
    b += text(tx + 12, py + 107, t[1], { size: 15, fill: C.text, weight: 700 });
    b += text(tx + tw - 12, py + 107, t[2], { size: 11, fill: t[3] ? C.green : C.danger, weight: 600, anchor: 'end' });
  });

  // chart + activity
  const ry = py + 148;
  const chartW = Math.round(cw * 0.615);
  b += panel(cx, ry, chartW, 320, 'Consumption — Wednesday 12 August 2026', { subtitle: 'Rotterdam DC · provisional data', right: 'Day ▾' });
  const gx = cx + 60; const gy = ry + 84; const gw = chartW - 90; const gh = 178;
  const cons = loadShape(11, 380, 640);
  const blk = blockShape(1.0, 1.0).map((mw) => mw * 250);
  const maxV = 780;
  b += axis(gx, gy, gw, gh, HOURS, { yLabels: ['780', '585', '390', '195', '0'] });
  b += coverageBands(cons, blk, gx, gy, gw, gh, maxV);
  b += areaFill(cons, gx, gy, gw, gh, maxV, { fill: C.sConsume, opacity: 0.1 });
  b += polyline(cons, gx, gy, gw, gh, maxV, { stroke: C.sConsume, sw: 2 });
  b += stepline(blk, gx, gy, gw, gh, maxV, { stroke: C.sBlock, sw: 2.2 });
  b += legend(gx, ry + 296, [
    { color: C.sConsume, label: 'Consumption' },
    { color: C.sBlock, label: 'Block cover', dash: true },
    { color: C.sUncov, label: 'Uncovered', opacity: 0.55 },
    { color: C.sSurplus, label: 'Surplus', opacity: 0.3 },
  ]);

  const aw = cw - chartW - 16;
  const ax0 = cx + chartW + 16;
  b += panel(ax0, ry, aw, 320, 'Recent activity');
  const acts = [
    ['13 Aug 10:15', 'Funds reserved', '€ 9.400,00 · TRD-1072 · Base Oct-26', 'indigo'],
    ['12 Aug 09:14', 'Wallet top-up', '€ 25.000,00 via iDEAL', 'green'],
    ['05 Aug 16:03', 'Trade failed', 'TRD-1048 · counterparty withdrew', 'danger'],
    ['01 Aug 00:04', 'Invoice issued', 'INV-2026-07-0042 · € 18.110,00', 'muted'],
    ['01 Aug 08:00', 'Data corrected', '31 Jul · Venlo cold store', 'amber'],
    ['30 Jul 14:52', 'Trade confirmed', 'TRD-1051 · Peak Q1-27 · 1,0 MW', 'green'],
  ];
  acts.forEach((a, i) => {
    const y = ry + 58 + i * 43;
    b += line(ax0, y, ax0 + aw, y, { stroke: C.border });
    b += text(ax0 + 18, y + 20, a[1], { size: 12.5, weight: 600 });
    b += text(ax0 + 18, y + 35, a[2], { size: 10.5, fill: C.muted });
    b += text(ax0 + aw - 18, y + 20, a[0], { size: 10, fill: C.faint, anchor: 'end' });
    b += circle(ax0 + 8, y + 21, 3, { fill: a[3] === 'green' ? C.green : a[3] === 'danger' ? C.danger : a[3] === 'amber' ? C.amber : a[3] === 'indigo' ? C.indigo : C.faint });
  });

  return svgDoc(b, { label: 'Customer portal — dashboard' });
}

/* ─────────────────────────────────────────────────────── connections list */
export function eanList() {
  const s = shell({
    portal: 'customer', title: 'Connections', crumb: '6 electricity connections · 1 gas (not tradeable)',
    nav: NAV, active: 1, user: USER, actions: [{ label: 'Export CSV', variant: 'secondary' }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  b += rect(cx, cy, 380, 38, { fill: C.panel, stroke: C.border2, r: 7 });
  b += text(cx + 14, cy + 24, 'Search name, description or EAN…', { size: 12.5, fill: C.faint });
  b += badge(cx + 396, cy + 9, 'Electricity', 'accent', { w: 92 });
  b += badge(cx + 496, cy + 9, 'All statuses', 'muted', { w: 96 });
  b += badge(cx + 600, cy + 9, 'Data OK', 'muted', { w: 76 });

  const rows = [
    [{ t: 'Rotterdam DC', weight: 600, sub: '8716871000000000 11' }, { t: 'Electricity' }, { t: 'Active', badge: 'green' }, { t: '12 Aug 2026', sub: 'provisional' }, { t: '385,4 MWh', align: 'end' }, { bar: 0.94, fill: C.accent }, { t: '94 %', align: 'end' }],
    [{ t: 'Venlo cold store', weight: 600, sub: '8716871000000000 27' }, { t: 'Electricity' }, { t: 'Active', badge: 'green' }, { t: '12 Aug 2026', sub: 'provisional' }, { t: '291,7 MWh', align: 'end' }, { bar: 0.71, fill: C.accent }, { t: '71 %', align: 'end' }],
    [{ t: 'Tilburg plant', weight: 600, sub: '8716871000000000 43' }, { t: 'Electricity' }, { t: 'Active', badge: 'green' }, { t: '12 Aug 2026', sub: 'provisional' }, { t: '612,0 MWh', align: 'end' }, { bar: 0.83, fill: C.accent }, { t: '83 %', align: 'end' }],
    [{ t: 'Almere office', weight: 600, sub: '8716871000000000 59' }, { t: 'Electricity' }, { t: 'Active', badge: 'green' }, { t: '10 Aug 2026', sub: 'no data 2 days' }, { t: '18,2 MWh', align: 'end' }, { bar: 0.0, fill: C.faint }, { t: '0 %', align: 'end' }],
    [{ t: '— no name set —', fill: C.faint, sub: '8716871000000000 61' }, { t: 'Electricity' }, { t: 'Active', badge: 'green' }, { t: '12 Aug 2026' }, { t: '44,9 MWh', align: 'end' }, { bar: 0.35, fill: C.accent }, { t: '35 %', align: 'end' }],
    [{ t: 'Breda warehouse', weight: 600, sub: '8716871000000000 78' }, { t: 'Electricity' }, { t: 'Ending 31 Dec', badge: 'amber' }, { t: '12 Aug 2026' }, { t: '102,3 MWh', align: 'end' }, { bar: 0.6, fill: C.accent }, { t: '60 %', align: 'end' }],
    [{ t: 'Tilburg plant — gas', weight: 600, sub: '8716871000000000 92' }, { t: 'Gas', fill: C.muted }, { t: 'Not tradeable', badge: 'muted' }, { t: '—', fill: C.faint }, { t: '—', align: 'end', fill: C.faint }, { bar: 0, fill: C.faint }, { t: '—', align: 'end', fill: C.faint }],
  ];
  const cols = [
    { label: 'CONNECTION', w: 300 }, { label: 'COMMODITY', w: 110 }, { label: 'STATUS', w: 130 },
    { label: 'LATEST DATA', w: 150 }, { label: 'AUGUST VOLUME', w: 150, align: 'end' },
    { label: 'BLOCK COVERAGE', w: 200 }, { label: '', w: 116, align: 'end' },
  ];
  b += panel(cx, cy + 56, cw, 460, null);
  b += table(cx + 1, cy + 57, cw - 2, cols, rows, { rowH: 46 });

  b += note(cx, cy + 534, cw, 'Almere office has reported no data since 10 August. PeakPower has been notified automatically.', 'amber');
  b += text(cx, cy + 600, 'Give a connection a name and description to use it everywhere — charts, trade requests, invoices and alerts.', { size: 12, fill: C.muted });

  return svgDoc(b, { label: 'Customer portal — connections list' });
}

/* ───────────────────────────────────────────────────── connection detail */
export function eanDetail() {
  const s = shell({
    portal: 'customer', title: 'Venlo cold store', crumb: 'Connections › EAN 8716 8710 0000 0000 27',
    nav: NAV, active: 1, user: USER, actions: [{ label: 'Request a trade' }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const leftW = 400;
  b += panel(cx, cy, leftW, 268, 'Your labels', { subtitle: 'Visible only to your organisation' });
  b += field(cx + 18, cy + 84, leftW - 36, 'NAME', 'Venlo cold store', { focus: true });
  b += field(cx + 18, cy + 154, leftW - 36, 'DESCRIPTION', 'Freezer hall + dock 3 compressors', {});
  b += text(cx + 18, cy + 214, 'Last changed by you on 14 Mar 2026', { size: 10.5, fill: C.faint });
  b += button(cx + 18, cy + 226, 96, 'Save', 'primary');
  b += button(cx + 122, cy + 226, 80, 'Cancel', 'secondary');

  b += panel(cx, cy + 284, leftW, 250, 'Connection details');
  const details = [
    ['EAN', '8716 8710 0000 0000 27'], ['Commodity', 'Electricity'],
    ['Grid operator', 'Enexis'], ['Connection capacity', '2.500 kW'],
    ['Address', 'Ceresstraat 14, Venlo'], ['Active since', '1 January 2024'],
    ['Contract until', 'open-ended'],
  ];
  details.forEach((d, i) => {
    b += statLine(cx + 18, cy + 330 + i * 27, leftW - 36, d[0], d[1], { mono: i === 0 });
  });

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;
  b += panel(rx, cy, rw, 268, 'Data quality', { subtitle: 'Last 14 delivery dates', right: 'PVNed · updated 13 Aug 06:12' });
  const states = ['F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'C', 'F', 'P', 'P', 'P', 'N'];
  const cellW = (rw - 36 - 13 * 6) / 14;
  states.forEach((st, i) => {
    const x = rx + 18 + i * (cellW + 6);
    const fill = st === 'F' ? C.greenBg : st === 'P' ? C.amberBg : st === 'C' ? C.indigoBg : C.dangerBg;
    const stroke = st === 'F' ? '#86efac' : st === 'P' ? '#fcd34d' : st === 'C' ? '#a5b4fc' : '#fca5a5';
    b += rect(x, cy + 76, cellW, 44, { fill, stroke, r: 6 });
    b += text(x + cellW / 2, cy + 96, String(31 - 13 + i), { size: 11, weight: 700, anchor: 'middle', fill: C.text });
    b += text(x + cellW / 2, cy + 111, st === 'F' ? 'final' : st === 'P' ? 'prov.' : st === 'C' ? 'corr.' : 'none', { size: 8.5, anchor: 'middle', fill: C.muted });
  });
  b += legend(rx + 18, cy + 146, [
    { color: '#86efac', label: 'Final' }, { color: '#fcd34d', label: 'Provisional' },
    { color: '#a5b4fc', label: 'Corrected' }, { color: '#fca5a5', label: 'No data' },
  ]);
  b += note(rx + 18, cy + 168, rw - 36, 'Data for 12 August is provisional. PVNed may still correct it until 27 August.', 'amber');
  b += text(rx + 18, cy + 236, 'Intervals received today: 96 of 96 · consumption and production', { size: 11.5, fill: C.muted });
  b += text(rx + 18, cy + 254, 'Corrections received this month: 1 (31 July, received 1 August 08:00)', { size: 11.5, fill: C.muted });

  b += panel(rx, cy + 284, rw, 250, 'Block positions on this connection', { right: '3 active' });
  b += table(rx + 18, cy + 336, rw - 36, [
    { label: 'TRADE', w: 92 }, { label: 'SHAPE', w: 76 }, { label: 'PERIOD', w: 104 },
    { label: 'ALLOCATED', w: 100, align: 'end' }, { label: 'PRICE', w: 108, align: 'end' },
    { label: 'VOLUME (AUG)', w: 128, align: 'end' }, { label: 'STATUS', w: 106 },
  ], [
    [{ t: 'TRD-1042', mono: true, fill: C.indigo }, { t: 'Base' }, { t: 'Aug 2026' }, { t: '0,300 MW', align: 'end' }, { t: '€ 72,4000', align: 'end' }, { t: '223,20 MWh', align: 'end' }, { t: 'Confirmed', badge: 'green' }],
    [{ t: 'TRD-1051', mono: true, fill: C.indigo }, { t: 'Peak' }, { t: 'Q3 2026' }, { t: '0,200 MW', align: 'end' }, { t: '€ 96,1500', align: 'end' }, { t: '50,40 MWh', align: 'end' }, { t: 'Confirmed', badge: 'green' }],
    [{ t: 'TRD-1067', mono: true, fill: C.indigo }, { t: 'Base (sell)' }, { t: 'Aug 2026' }, { t: '−0,040 MW', align: 'end', fill: C.danger }, { t: '€ 78,2000', align: 'end' }, { t: '−29,76 MWh', align: 'end', fill: C.danger }, { t: 'Confirmed', badge: 'green' }],
  ], { rowH: 38 });

  return svgDoc(b, { label: 'Customer portal — connection detail' });
}

/* ─────────────────────────────────────────────────────────── day chart */
export function chartDayView() {
  const s = shell({
    portal: 'customer', title: 'Consumption', crumb: 'Rotterdam DC · Wednesday 12 August 2026',
    nav: NAV, active: 2, user: USER,
    actions: [{ label: 'Hedge this exposure' }, { label: 'Export', variant: 'secondary', w: 92 }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  // controls
  b += rect(cx, cy, cw, 48, { fill: C.panel, stroke: C.border, r: 9 });
  b += badge(cx + 14, cy + 14, 'Day', 'accent', { w: 62, h: 22 });
  b += badge(cx + 82, cy + 14, 'Month', 'muted', { w: 70, h: 22 });
  b += badge(cx + 158, cy + 14, 'Quarter', 'muted', { w: 76, h: 22 });
  b += line(cx + 250, cy + 12, cx + 250, cy + 36, { stroke: C.border });
  b += text(cx + 268, cy + 29, '‹', { size: 18, fill: C.muted });
  b += rect(cx + 286, cy + 11, 168, 26, { fill: C.panel2, stroke: C.border2, r: 6 });
  b += text(cx + 370, cy + 29, '12 August 2026', { size: 12.5, weight: 600, anchor: 'middle' });
  b += text(cx + 466, cy + 29, '›', { size: 18, fill: C.muted });
  b += line(cx + 494, cy + 12, cx + 494, cy + 36, { stroke: C.border });
  b += rect(cx + 512, cy + 11, 250, 26, { fill: C.panel2, stroke: C.border2, r: 6 });
  b += text(cx + 526, cy + 29, 'Rotterdam DC', { size: 12.5 });
  b += text(cx + 748, cy + 29, '▾', { size: 11, fill: C.muted, anchor: 'end' });
  b += badge(cx + cw - 178, cy + 14, 'PROVISIONAL DATA', 'amber', { w: 164, h: 22 });

  // series — KPIs below are derived from these, so the numbers always match the picture
  const cons = loadShape(11, 380, 640);
  const blk = blockShape(1.0, 1.0).map((mw) => mw * 250);
  const maxV = 780;
  const totCons = sum(cons) / 1000;
  const totBlock = sum(blk) / 1000;
  const covered = sum(cons.map((c, i) => Math.min(c, blk[i]))) / 1000;
  const uncovered = sum(cons.map((c, i) => Math.max(c - blk[i], 0))) / 1000;
  const surplus = sum(blk.map((v, i) => Math.max(v - cons[i], 0))) / 1000;
  const spot = uncovered * 88.4 - surplus * 47.1;

  // KPIs
  const ky = cy + 62;
  const kw = (cw - 5 * 12) / 6;
  const kpis = [
    ['CONSUMPTION', `${nl(totCons)} MWh`, '96 intervals', C.sConsume],
    ['PRODUCTION', '0,00 MWh', 'no generation here', C.sProduce],
    ['BLOCK COVER', `${nl(totBlock)} MWh`, '1,0 base + 1,0 peak', C.sBlock],
    ['COVERED', `${nl((covered / totCons) * 100, 1)} %`, `${nl(covered)} MWh`, C.green],
    ['UNCOVERED', `${nl(uncovered)} MWh`, `surplus ${nl(surplus)} MWh`, C.sUncov],
    ['SPOT RESULT', `+ ${eur(spot, 0)}`, 'indicative, provisional', C.sUncov],
  ];
  kpis.forEach((k, i) => {
    b += kpi(cx + i * (kw + 12), ky, kw, k[0], k[1], k[2], { accent: k[3], h: 76 });
  });

  // main chart
  const py = ky + 92;
  const ph = 400;
  b += panel(cx, py, cw, ph, 'Consumption vs. block cover — 15-minute intervals', { subtitle: '96 intervals · Europe/Amsterdam', right: 'kWh per interval ▾' });
  const gx = cx + 68; const gy = py + 84; const gw = cw - 110; const gh = ph - 150;

  // peak-window shading
  const stepX = gw / 96;
  b += rect(gx + 32 * stepX, gy, 48 * stepX, gh, { fill: '#eef2ff', stroke: null, r: 0 });
  b += text(gx + 56 * stepX, gy + 16, 'PEAK WINDOW 08:00 – 20:00', { size: 10, fill: '#818cf8', weight: 700, anchor: 'middle' });

  b += axis(gx, gy, gw, gh, HOURS, { yLabels: ['780', '585', '390', '195', '0'] });
  b += coverageBands(cons, blk, gx, gy, gw, gh, maxV);
  b += areaFill(cons, gx, gy, gw, gh, maxV, { fill: C.sConsume, opacity: 0.12 });
  b += polyline(cons, gx, gy, gw, gh, maxV, { stroke: C.sConsume, sw: 2.2 });
  b += stepline(blk, gx, gy, gw, gh, maxV, { stroke: C.sBlock, sw: 2.4 });
  b += text(gx - 52, gy - 8, 'kWh', { size: 10, fill: C.faint });

  // tooltip
  const tipX = gx + 42 * stepX;
  b += line(tipX, gy, tipX, gy + gh, { stroke: C.indigo, sw: 1, dash: '3 3' });
  b += circle(tipX, gy + gh - (cons[42] / maxV) * gh, 4, { fill: C.sConsume, stroke: '#fff', sw: 2 });
  b += rect(tipX + 12, gy + 30, 226, 128, { fill: '#0f172a', stroke: null, r: 8 });
  b += text(tipX + 26, gy + 52, '10:30 – 10:45', { size: 12, fill: '#fff', weight: 700 });
  const net = cons[42] - blk[42];
  const tips = [
    ['Consumption', `${cons[42]} kWh`],
    ['Block cover', `${blk[42]} kWh`],
    ['Net position', `${net >= 0 ? '+' : '−'}${Math.abs(net)} kWh`],
    ['Day-ahead', '€ 96,50/MWh'],
    ['Spot cost', `${net >= 0 ? '+ ' : '− '}${eur(Math.abs(net) / 1000 * 96.5)}`],
  ];
  tips.forEach((t, i) => {
    b += text(tipX + 26, gy + 72 + i * 17, t[0], { size: 10.5, fill: '#94a3b8' });
    b += text(tipX + 224, gy + 72 + i * 17, t[1], { size: 10.5, fill: '#e2e8f0', weight: 600, anchor: 'end' });
  });

  b += legend(gx, py + ph - 22, [
    { color: C.sConsume, label: 'Consumption' },
    { color: C.sBlock, label: 'Block cover (base + peak)', dash: true },
    { color: C.sUncov, label: 'Uncovered — bought at day-ahead', opacity: 0.55 },
    { color: C.sSurplus, label: 'Surplus — sold at day-ahead', opacity: 0.3 },
  ]);

  b += note(cx, py + ph + 14, cw, 'The block line steps at 08:00 and 20:00 — that is peak cover starting and stopping. Surplus is priced back at the day-ahead price for each interval.', 'muted');

  return svgDoc(b, { label: 'Customer portal — day chart with block overlay' });
}

/* ───────────────────────────────────────────────────────── month chart */
export function chartMonthView() {
  const s = shell({
    portal: 'customer', title: 'Consumption', crumb: 'Rotterdam DC · August 2026',
    nav: NAV, active: 2, user: USER, actions: [{ label: 'Hedge this exposure' }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  b += rect(cx, cy, cw, 48, { fill: C.panel, stroke: C.border, r: 9 });
  b += badge(cx + 14, cy + 14, 'Day', 'muted', { w: 62, h: 22 });
  b += badge(cx + 82, cy + 14, 'Month', 'accent', { w: 70, h: 22 });
  b += badge(cx + 158, cy + 14, 'Quarter', 'muted', { w: 76, h: 22 });
  b += text(cx + 268, cy + 29, '‹', { size: 18, fill: C.muted });
  b += rect(cx + 286, cy + 11, 168, 26, { fill: C.panel2, stroke: C.border2, r: 6 });
  b += text(cx + 370, cy + 29, 'August 2026', { size: 12.5, weight: 600, anchor: 'middle' });
  b += text(cx + 466, cy + 29, '›', { size: 18, fill: C.muted });
  b += badge(cx + cw - 300, cy + 14, 'COMPARE: JULY 2026', 'indigo', { w: 158, h: 22 });
  b += badge(cx + cw - 132, cy + 14, '2 DAYS MISSING', 'danger', { w: 118, h: 22 });

  const py = cy + 62;
  const ph = 420;
  b += panel(cx, py, cw, ph, 'Daily consumption and block cover — August 2026', { subtitle: 'click a day for 15-minute detail' });
  const gx = cx + 68; const gy = py + 84; const gw = cw - 110; const gh = ph - 150;
  const maxV = 16;

  const daily = [];
  for (let d = 1; d <= 31; d++) {
    const dow = (d + 4) % 7; // 1 Aug 2026 = Saturday
    const weekend = dow === 0 || dow === 1;
    let v = weekend ? 6.4 + (d % 3) * 0.35 : 11.2 + ((d * 7) % 5) * 0.42;
    if (d === 10 || d === 11) v = 0; // missing
    daily.push(v);
  }
  const blockDaily = daily.map((_, i) => {
    const d = i + 1;
    const dow = (d + 4) % 7;
    const weekend = dow === 0 || dow === 1;
    return 24 * 1.0 + (weekend ? 0 : 12 * 1.0); // MWh: base 24 + peak 12
  });

  b += axis(gx, gy, gw, gh, ['1', '5', '10', '15', '20', '25', '31'], { yLabels: ['16', '12', '8', '4', '0'] });
  b += text(gx - 52, gy - 8, 'MWh', { size: 10, fill: C.faint });

  const bw = gw / 31;
  daily.forEach((v, i) => {
    const d = i + 1;
    const dow = (d + 4) % 7;
    const weekend = dow === 0 || dow === 1;
    const x = gx + i * bw;
    if (weekend) b += rect(x, gy, bw, gh, { fill: '#f1f5f9', stroke: null, r: 0 });
    if (v === 0) {
      b += rect(x + 3, gy + gh - 14, bw - 6, 12, { fill: C.dangerBg, stroke: '#fca5a5', r: 3, dash: '3 2' });
      b += text(x + bw / 2, gy + gh - 22, '?', { size: 10, fill: C.danger, weight: 700, anchor: 'middle' });
    } else {
      b += rect(x + 3, gy + gh - (v / maxV) * gh, bw - 6, (v / maxV) * gh, { fill: C.sConsume, stroke: null, r: 3, opacity: 0.85 });
    }
    b += text(x + bw / 2, gy + gh + 16, String(d), { size: 8, fill: C.faint, anchor: 'middle' });
  });
  // block cover line — scale MWh/day onto the same axis
  b += stepline(blockDaily.map((v) => v / 3), gx, gy, gw, gh, maxV, { stroke: C.sBlock, sw: 2.2, dash: '5 3' });

  b += legend(gx, py + ph - 22, [
    { color: C.sConsume, label: 'Daily consumption', opacity: 0.85 },
    { color: C.sBlock, label: 'Block cover (÷3 for scale)', dash: true },
    { color: '#f1f5f9', label: 'Weekend — no peak cover' },
    { color: '#fca5a5', label: 'Missing data' },
  ]);

  const sy = py + ph + 16;
  const kw = (cw - 3 * 12) / 4;
  b += kpi(cx, sy, kw, 'MEASURED (29 of 31 DAYS)', '285,4 MWh', '2 days awaiting data', { accent: C.sConsume });
  b += kpi(cx + kw + 12, sy, kw, 'BLOCK VOLUME', '996,0 MWh', '744 base + 252 peak', { accent: C.sBlock });
  b += kpi(cx + 2 * (kw + 12), sy, kw, 'SURPLUS', '710,6 MWh', 'sold back at day-ahead', { accent: C.sSurplus });
  b += kpi(cx + 3 * (kw + 12), sy, kw, 'vs. JULY 2026', '+ 4,1 %', 'same-weekday basis', { accent: C.text });

  return svgDoc(b, { label: 'Customer portal — month chart' });
}

/* ──────────────────────────────────────────────────── price indications */
export function priceIndications() {
  const s = shell({ portal: 'customer', title: 'Price indications', crumb: 'Dutch power · indicative only', nav: NAV, active: 3, user: USER });
  let b = s.svg;
  const { cx, cy, cw } = s;

  b += note(cx, cy, cw, 'These are indicative market prices, not offers. A firm, time-limited price is issued only in response to a trade request.', 'accent');

  const cardW = (cw - 2 * 16) / 3;
  const cards = [
    ['Base', 'Next month', 'Sep 2026', '€ 78,45', '+1,25', true, '14:22', false],
    ['Base', 'Next quarter', 'Q4 2026', '€ 84,20', '−0,45', false, '14:22', false],
    ['Base', 'Next calendar year', 'Cal 2027', '€ 79,90', '+0,35', true, '14:22', false],
    ['Peak', 'Next month', 'Sep 2026', '€ 96,15', '+2,10', true, '14:22', false],
    ['Peak', 'Next quarter', 'Q4 2026', '€ 103,70', '−1,05', false, '14:22', false],
    ['Peak', 'Next calendar year', 'Cal 2027', '€ 98,25', '+0,80', true, '12:40', true],
  ];
  cards.forEach((c, i) => {
    const col = i % 3; const row = Math.floor(i / 3);
    const x = cx + col * (cardW + 16);
    const y = cy + 56 + row * 190;
    b += rect(x, y, cardW, 174, { fill: C.panel, stroke: c[7] ? '#fcd34d' : C.border, r: 10, sw: c[7] ? 1.5 : 1 });
    b += badge(x + 18, y + 18, c[0].toUpperCase(), c[0] === 'Peak' ? 'indigo' : 'accent', { w: 56 });
    if (c[7]) b += badge(x + cardW - 96, y + 18, 'STALE 1h42', 'amber', { w: 78 });
    b += text(x + 18, y + 62, c[1], { size: 11.5, fill: C.muted, weight: 600 });
    b += text(x + 18, y + 84, c[2], { size: 13, fill: C.text, weight: 600 });
    b += text(x + 18, y + 122, c[3], { size: 30, fill: c[7] ? C.faint : C.text, weight: 700 });
    b += text(x + 18, y + 142, '€ / MWh', { size: 10.5, fill: C.faint });
    b += text(x + cardW - 18, y + 122, c[4], { size: 14, fill: c[5] ? C.green : C.danger, weight: 700, anchor: 'end' });
    b += text(x + cardW - 18, y + 142, `observed ${c[6]}`, { size: 10, fill: C.faint, anchor: 'end' });
    b += line(x, y + 154, x + cardW, y + 154, { stroke: C.border });
    b += text(x + 18, y + 168, 'Indication — not an offer', { size: 10, fill: C.faint });
    b += text(x + cardW - 18, y + 168, 'Request a price →', { size: 11, fill: C.accent, weight: 600, anchor: 'end' });
  });

  const ty = cy + 56 + 2 * 190;
  b += panel(cx, ty, cw, 240, 'Base — next month · 90-day trend', { right: 'Montel · NL power' });
  const gx = cx + 62; const gy = ty + 78; const gw = cw - 100; const gh = 116;
  const pts = [];
  let v = 71;
  for (let i = 0; i < 90; i++) { v += Math.sin(i / 6.5) * 1.15 + (i % 11 === 0 ? 1.4 : -0.12); pts.push(v); }
  b += axis(gx, gy, gw, gh, ['1 May', '20 May', '8 Jun', '27 Jun', '16 Jul', '30 Jul'], { yLabels: ['86', '82', '78', '74', '70'], gridLines: 4 });
  b += areaFill(pts.map((p) => p - 68), gx, gy, gw, gh, 20, { fill: C.accent, opacity: 0.12 });
  b += polyline(pts.map((p) => p - 68), gx, gy, gw, gh, 20, { stroke: C.accent, sw: 2 });
  b += circle(gx + gw, gy + gh - ((pts[89] - 68) / 20) * gh, 4, { fill: C.accent, stroke: '#fff', sw: 2 });
  b += text(gx - 46, gy - 8, '€/MWh', { size: 10, fill: C.faint });

  return svgDoc(b, { label: 'Customer portal — price indications' });
}

/* ───────────────────────────────────────────────────────── trade wizard */
export function tradeWizard() {
  const s = shell({ portal: 'customer', title: 'Request a trade', crumb: 'Step 2 of 3 · volume per connection', nav: NAV, active: 4, user: USER });
  let b = s.svg;
  const { cx, cy, cw } = s;

  // stepper
  b += rect(cx, cy, cw, 56, { fill: C.panel, stroke: C.border, r: 9 });
  const steps = ['Product & period', 'Volume per connection', 'Review & submit'];
  steps.forEach((st, i) => {
    const x = cx + 28 + i * 300;
    const done = i === 0; const cur = i === 1;
    b += circle(x + 12, cy + 28, 12, { fill: done ? C.accent : cur ? C.accent : C.panel2, stroke: cur || done ? C.accent : C.border2, sw: 1.5 });
    b += text(x + 12, cy + 32, done ? '✓' : String(i + 1), { size: 11, fill: done || cur ? '#fff' : C.faint, weight: 700, anchor: 'middle' });
    b += text(x + 34, cy + 32, st, { size: 12.5, fill: cur ? C.text : done ? C.muted : C.faint, weight: cur ? 700 : 500 });
    if (i < 2) b += line(x + 200, cy + 28, x + 288, cy + 28, { stroke: C.border2 });
  });

  const leftW = Math.round(cw * 0.62);
  b += panel(cx, cy + 72, leftW, 470, 'Volume per connection', { subtitle: 'Split the block across the sites it should cover' });

  b += table(cx + 18, cy + 132, leftW - 36, [
    { label: 'CONNECTION', w: 270 }, { label: 'AUG CONSUMPTION', w: 150, align: 'end' },
    { label: 'CURRENT COVER', w: 130, align: 'end' }, { label: 'VOLUME (MW)', w: 137, align: 'end' },
  ], [
    [{ t: 'Rotterdam DC', weight: 600, sub: '…0011' }, { t: '385,4 MWh', align: 'end' }, { t: '0,40 MW', align: 'end' }, { t: '0,200', align: 'end', weight: 700, mono: true }],
    [{ t: 'Venlo cold store', weight: 600, sub: '…0027' }, { t: '291,7 MWh', align: 'end' }, { t: '0,30 MW', align: 'end' }, { t: '0,300', align: 'end', weight: 700, mono: true }],
    [{ t: 'Tilburg plant', weight: 600, sub: '…0043' }, { t: '612,0 MWh', align: 'end' }, { t: '0,50 MW', align: 'end' }, { t: '0,400', align: 'end', weight: 700, mono: true }],
    [{ t: 'Almere office', weight: 600, sub: '…0059' }, { t: '18,2 MWh', align: 'end' }, { t: '—', align: 'end', fill: C.faint }, { t: '0,100', align: 'end', weight: 700, mono: true }],
    [{ t: 'Breda warehouse', fill: C.faint, sub: '…0078 · ends 31 Dec 2026' }, { t: '102,3 MWh', align: 'end', fill: C.faint }, { t: '0,10 MW', align: 'end', fill: C.faint }, { t: 'not eligible', align: 'end', fill: C.faint, size: 11 }],
  ], { rowH: 46 });

  b += line(cx + 18, cy + 420, cx + leftW - 18, cy + 420, { stroke: C.border2 });
  b += text(cx + 18, cy + 444, 'Requested total', { size: 13, weight: 700 });
  b += text(cx + leftW - 18, cy + 444, '1,000 MW', { size: 18, weight: 700, anchor: 'end', fill: C.accent, mono: true });
  b += badge(cx + leftW - 240, cy + 430, 'WHOLE MW — CLEAN CLIP', 'green', { w: 178, h: 20 });

  b += note(cx + 18, cy + 462, leftW - 36, 'A non-round total is allowed. PeakPower rounds to a whole MW on the market side.', 'muted');

  b += text(cx + 18, cy + 528, 'Note for the trader (optional)', { size: 10.5, fill: C.muted, weight: 600 });

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;
  b += panel(rx, cy + 72, rw, 470, 'Summary');

  const rows = [
    ['Direction', 'Buy'], ['Shape', 'Peak'], ['Delivery period', 'Q1 2027'],
    ['Peak days in period', '64 days'], ['Peak hours', 'Mon–Fri 08:00–20:00'],
    ['Total power', '1,000 MW'], ['Total volume', '768,00 MWh'],
  ];
  rows.forEach((r, i) => { b += statLine(rx + 18, cy + 138 + i * 26, rw - 36, r[0], r[1]); });

  b += line(rx + 18, cy + 322, rx + rw - 18, cy + 322, { stroke: C.border });
  b += text(rx + 18, cy + 344, 'Indicative price', { size: 12, fill: C.muted });
  b += text(rx + rw - 18, cy + 344, '€ 96,1500 / MWh', { size: 12, weight: 600, anchor: 'end' });
  b += text(rx + 18, cy + 366, 'Estimated value', { size: 13, weight: 700 });
  b += text(rx + rw - 18, cy + 368, '€ 73.843,20', { size: 19, weight: 700, anchor: 'end' });
  b += text(rx + 18, cy + 386, 'based on the indication of 14:22 — the actual price will differ', { size: 10, fill: C.faint });

  b += rect(rx + 18, cy + 400, rw - 36, 74, { fill: C.panel2, stroke: C.border, r: 8 });
  b += statLine(rx + 32, cy + 424, rw - 64, 'Available balance', '€ 95.000,00');
  b += statLine(rx + 32, cy + 446, rw - 64, 'After reservation', '€ 21.156,80', { fill: C.green });
  b += badge(rx + 32, cy + 456, 'SUFFICIENT FUNDS', 'green', { w: 140, h: 18 });

  b += button(rx + 18, cy + 494, rw - 36, 'Continue to review', 'primary', { h: 40 });
  b += button(rx + 18, cy + 542, rw - 36, 'Back', 'secondary', { h: 36 });

  return svgDoc(b, { label: 'Customer portal — trade request wizard' });
}

/* ────────────────────────────────────────────────────── offer countdown */
export function tradeOfferCountdown() {
  const s = shell({ portal: 'customer', title: 'Offer · TRD-1051', crumb: 'Trading › Peak Q1 2027 · 1,0 MW', nav: NAV, active: 4, user: USER });
  let b = s.svg;
  const { cx, cy, cw } = s;

  // countdown hero
  b += rect(cx, cy, cw, 150, { fill: '#0f2b33', stroke: null, r: 12 });
  b += text(cx + 36, cy + 40, 'FIRM OFFER — RESPOND BEFORE 15:01', { size: 11.5, fill: '#5eead4', weight: 700 });
  b += text(cx + 36, cy + 90, '€ 94,7500', { size: 44, fill: '#ffffff', weight: 700 });
  b += text(cx + 250, cy + 90, '/ MWh', { size: 16, fill: '#94a3b8' });
  b += text(cx + 36, cy + 118, '768,00 MWh  ·  total € 72.768,00  ·  VAT excluded', { size: 13, fill: '#cbd5e1' });

  const ring = cx + cw - 130;
  b += circle(ring, cy + 75, 52, { fill: 'none', stroke: '#1e3a44', sw: 8 });
  b += path(`M ${ring} ${cy + 23} A 52 52 0 1 1 ${ring - 44} ${cy + 103}`, { stroke: C.amber, sw: 8, cap: 'round' });
  b += text(ring, cy + 72, '24:47', { size: 24, fill: '#ffffff', weight: 700, anchor: 'middle', mono: true });
  b += text(ring, cy + 92, 'remaining', { size: 10, fill: '#94a3b8', anchor: 'middle' });

  const leftW = Math.round(cw * 0.6);
  b += panel(cx, cy + 166, leftW, 300, 'What you are buying');
  b += table(cx + 18, cy + 218, leftW - 36, [
    { label: 'CONNECTION', w: 254 }, { label: 'ALLOCATED', w: 120, align: 'end' },
    { label: 'VOLUME', w: 140, align: 'end' }, { label: 'VALUE', w: 150, align: 'end' },
  ], [
    [{ t: 'Rotterdam DC', weight: 600 }, { t: '0,200 MW', align: 'end' }, { t: '153,60 MWh', align: 'end' }, { t: '€ 14.553,60', align: 'end' }],
    [{ t: 'Venlo cold store', weight: 600 }, { t: '0,300 MW', align: 'end' }, { t: '230,40 MWh', align: 'end' }, { t: '€ 21.830,40', align: 'end' }],
    [{ t: 'Tilburg plant', weight: 600 }, { t: '0,400 MW', align: 'end' }, { t: '307,20 MWh', align: 'end' }, { t: '€ 29.107,20', align: 'end' }],
    [{ t: 'Almere office', weight: 600 }, { t: '0,100 MW', align: 'end' }, { t: '76,80 MWh', align: 'end' }, { t: '€ 7.276,80', align: 'end' }],
  ], { rowH: 38 });
  b += line(cx + 18, cy + 400, cx + leftW - 18, cy + 400, { stroke: C.border2 });
  b += text(cx + 18, cy + 424, 'Total', { size: 13, weight: 700 });
  b += text(cx + leftW - 18, cy + 424, '€ 72.768,00', { size: 17, weight: 700, anchor: 'end' });
  b += text(cx + 18, cy + 448, 'Peak Q1 2027 · Mon–Fri 08:00–20:00 · 64 peak days · calendar NL-POWER-PEAK v2027.1', { size: 10.5, fill: C.faint });

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;
  b += panel(rx, cy + 166, rw, 300, 'Wallet impact');
  b += statLine(rx + 18, cy + 224, rw - 36, 'Settled balance', '€ 95.000,00');
  b += statLine(rx + 18, cy + 250, rw - 36, 'Currently reserved', '€ 0,00');
  b += statLine(rx + 18, cy + 276, rw - 36, 'Available now', '€ 95.000,00', { weight: 700 });
  b += line(rx + 18, cy + 292, rx + rw - 18, cy + 292, { stroke: C.border });
  b += statLine(rx + 18, cy + 318, rw - 36, 'To be reserved', '− € 72.768,00', { fill: C.amber, weight: 700 });
  b += statLine(rx + 18, cy + 344, rw - 36, 'Available after', '€ 22.232,00', { fill: C.green, weight: 700 });
  b += note(rx + 18, cy + 362, rw - 36, 'Reserved, not charged. Settled on confirmation.', 'muted');

  b += button(rx + 18, cy + 416, rw - 36, 'Accept this offer', 'primary', { h: 42 });
  b += button(rx + 18, cy + 466, (rw - 46) / 2, 'Reject', 'secondary', { h: 36 });
  b += button(rx + 28 + (rw - 46) / 2, cy + 466, (rw - 46) / 2, 'Ask a question', 'secondary', { h: 36 });

  b += note(cx, cy + 520, cw, 'If you accept, € 72.768,00 is reserved immediately. PeakPower then executes on the market and confirms — usually within 30 minutes. If execution fails, the full amount is released and you are told why.', 'accent');

  return svgDoc(b, { label: 'Customer portal — offer with countdown' });
}

/* ────────────────────────────────────────────────────────── trade history */
export function tradeHistory() {
  const s = shell({ portal: 'customer', title: 'Trade TRD-1051', crumb: 'Peak Q1 2027 · 1,0 MW · Confirmed', nav: NAV, active: 4, user: USER, actions: [{ label: 'Export history', variant: 'secondary', w: 128 }] });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const leftW = Math.round(cw * 0.58);
  b += panel(cx, cy, leftW, 620, 'History', { subtitle: 'The same timeline PeakPower sees' });

  const events = [
    ['30 Jul 2026, 14:25:02', 'Request submitted', 'J. de Vries · Energy Manager (you)', 'Peak Q1-2027 · 1,000 MW across 4 connections. Comment: “Hedging Q1 baseload growth.” Indication at submission: € 96,1500/MWh.', 'accent'],
    ['30 Jul 2026, 14:31:00', 'Offer published', 'PeakPower Trading', 'Price € 94,7500/MWh · total € 72.768,00 · reaction window 30 minutes, expiring 15:01:00. All 3 active accounts notified.', 'indigo'],
    ['30 Jul 2026, 14:44:18', 'Offer accepted', 'M. Vandersteen · Finance Director', '€ 72.768,00 reserved on the company wallet. Reservation RES-0912. Accepted by a different colleague than the requester.', 'amber'],
    ['30 Jul 2026, 14:52:41', 'Trade confirmed', 'PeakPower Trading', 'Executed on the market, reference ICE-88213-A. Reservation settled — wallet debited € 72.768,00. Block BLK-0431 created with 4 allocations.', 'green'],
  ];
  events.forEach((e, i) => {
    const y = cy + 74 + i * 130;
    const col = e[4] === 'green' ? C.green : e[4] === 'amber' ? C.amber : e[4] === 'indigo' ? C.indigo : C.accent;
    if (i < events.length - 1) b += line(cx + 40, y + 18, cx + 40, y + 122, { stroke: C.border2, dash: '3 4' });
    b += circle(cx + 40, y + 8, 9, { fill: '#fff', stroke: col, sw: 2.5 });
    b += circle(cx + 40, y + 8, 4, { fill: col });
    b += text(cx + 64, y + 6, e[1], { size: 13.5, weight: 700 });
    b += text(cx + leftW - 18, y + 6, e[0], { size: 10.5, fill: C.faint, anchor: 'end' });
    b += text(cx + 64, y + 24, e[2], { size: 11, fill: col, weight: 600 });
    const words = e[3].split(' ');
    const lines = []; let cur = '';
    words.forEach((w) => { if ((cur + ' ' + w).length > 74) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
    lines.push(cur);
    lines.slice(0, 3).forEach((ln, li) => { b += text(cx + 64, y + 44 + li * 16, ln, { size: 11.5, fill: C.muted }); });
  });

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;
  b += panel(rx, cy, rw, 300, 'Trade');
  const facts = [
    ['Reference', 'TRD-1051'], ['Requested by', 'J. de Vries'], ['Accepted by', 'M. Vandersteen'],
    ['State', 'Confirmed'], ['Direction', 'Buy'], ['Shape', 'Peak'],
    ['Delivery period', 'Q1 2027'], ['Peak calendar', 'NL-POWER-PEAK v2027.1'],
    ['Total power', '1,000 MW'], ['Total volume', '768,00 MWh'], ['Agreed price', '€ 94,7500 / MWh'],
  ];
  facts.forEach((f, i) => { b += statLine(rx + 18, cy + 62 + i * 26, rw - 36, f[0], f[1], { mono: i === 0 }); });
  b += line(rx + 18, cy + 300 - 44, rx + rw - 18, cy + 300 - 44, { stroke: C.border });
  b += text(rx + 18, cy + 282, 'Total value', { size: 12.5, weight: 700 });
  b += text(rx + rw - 18, cy + 282, '€ 72.768,00', { size: 15, weight: 700, anchor: 'end' });

  b += panel(rx, cy + 316, rw, 304, 'Linked records');
  const links = [
    ['Block', 'BLK-0431', 'now visible on your charts'],
    ['Reservation', 'RES-0912', 'settled 30 Jul 14:52'],
    ['Ledger entry #4471', 'Funds reserved', '− € 72.768,00 available'],
    ['Ledger entry #4472', 'Trade settled', '− € 72.768,00 settled'],
    ['Invoice', 'from Jan 2027', 'block energy lines'],
  ];
  links.forEach((l, i) => {
    const y = cy + 372 + i * 50;
    b += rect(rx + 18, y, rw - 36, 42, { fill: C.panel2, stroke: C.border, r: 7 });
    b += text(rx + 32, y + 18, l[0], { size: 11, fill: C.muted, weight: 600 });
    b += text(rx + 32, y + 34, l[1], { size: 12.5, fill: C.accent, weight: 600 });
    b += text(rx + rw - 32, y + 26, l[2], { size: 10.5, fill: C.faint, anchor: 'end' });
  });

  return svgDoc(b, { label: 'Customer portal — trade history and audit timeline' });
}

/* ─────────────────────────────────────────────────────── wallet & ledger */
export function walletLedger() {
  const s = shell({ portal: 'customer', title: 'Wallet', crumb: 'Vandersteen Koeling B.V. · EUR', nav: NAV, active: 5, user: USER, actions: [{ label: 'Top up' }, { label: 'Statement', variant: 'secondary', w: 106 }] });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const kw = (cw - 2 * 16) / 3;
  b += kpi(cx, cy, kw, 'AVAILABLE BALANCE', eur(19722), 'what you can commit right now', { accent: C.accent, h: 100 });
  b += kpi(cx + kw + 16, cy, kw, 'SETTLED BALANCE', eur(29122), 'money in the wallet', { h: 100 });
  b += kpi(cx + 2 * (kw + 16), cy, kw, 'RESERVED', eur(9400), '1 accepted trade awaiting confirmation', { accent: C.amber, h: 100 });

  b += note(cx, cy + 116, cw, 'Your minimum balance alert is set at € 25.000 — you are currently below it. Top up to keep trading.', 'amber');

  b += panel(cx, cy + 172, cw, 480, 'Ledger', { subtitle: 'Every movement, newest first', right: 'Aug 2026 ▾   ·   All types ▾' });

  const cols = [
    { label: 'DATE & TIME', w: 112 }, { label: 'TYPE', w: 146 }, { label: 'DESCRIPTION', w: 236 },
    { label: 'BY', w: 130 }, { label: 'REFERENCE', w: 150 }, { label: 'DEBIT', w: 110, align: 'end' },
    { label: 'CREDIT', w: 110, align: 'end' }, { label: 'AVAILABLE AFTER', w: 136, align: 'end' },
  ];
  // Chronological, then displayed newest-first. Balances are computed, so they reconcile.
  const hist = [
    ['24-07 16:11', 'Adjustment', 'indigo', 'Correction — duplicate deposit reversed', 'S. Willems ⬥', 'ADJ-0031', -1500, 0],
    ['28-07 08:30', 'Deposit (bank)', 'green', 'Transfer · ref PP-4821-QK', 'S. Willems ⬥', 'DEP-0118', 76500, 0],
    ['30-07 14:44', 'Funds reserved', 'amber', 'Peak Q1-27 · 1,0 MW', 'M. Vandersteen', 'TRD-1051', 0, 72768],
    ['30-07 14:52', 'Trade confirmed', 'green', 'Peak Q1-27 · reservation settled', 'M. Bakker ⬥', 'TRD-1051', -72768, -72768],
    ['01-08 00:04', 'Invoice', 'muted', 'July 2026 · 6 connections', 'System', 'INV-2026-07-0042', -18110, 0],
    ['05-08 15:22', 'Funds reserved', 'amber', 'Base Sep-26 · 0,05 MW', 'J. de Vries', 'TRD-1048', 0, 3900],
    ['05-08 16:03', 'Reservation released', 'indigo', 'TRD-1048 failed — counterparty withdrew', 'M. Bakker ⬥', 'TRD-1048', 0, -3900],
    ['12-08 09:14', 'Deposit (iDEAL)', 'green', 'Top-up via iDEAL', 'J. de Vries', 'PAY-2291', 25000, 0],
    ['13-08 10:15', 'Funds reserved', 'amber', 'Base Oct-26 · 0,12 MW', 'P. Aksoy', 'TRD-1072', 0, 9400],
  ];
  let settled = 20000; let reserved = 0;
  const built = hist.map(([d, type, variant, desc, by, ref, dSet, dRes]) => {
    settled += dSet; reserved += dRes;
    return { d, type, variant, desc, by, ref, dSet, dRes, avail: settled - reserved };
  });
  const rows = built.slice().reverse().map((e) => {
    const debit = e.dSet < 0 ? -e.dSet : (e.dRes > 0 ? e.dRes : 0);
    const credit = e.dSet > 0 ? e.dSet : (e.dRes < 0 ? -e.dRes : 0);
    const peakpower = e.by.endsWith('⬥');
    return [
      { t: e.d, size: 11 },
      { t: e.type, badge: e.variant },
      { t: e.desc, size: 11.5 },
      { t: e.by.replace(' ⬥', ''), size: 11.5, fill: peakpower || e.by === 'System' ? C.faint : C.text,
        weight: peakpower || e.by === 'System' ? 400 : 600,
        sub: peakpower ? 'PeakPower' : e.by === 'System' ? 'automatic' : '' },
      { t: e.ref, mono: true, fill: C.accent, weight: 600, size: e.ref.length > 10 ? 10 : 11.5 },
      { t: debit ? eur(debit) : '', align: 'end', size: 11.5 },
      { t: credit ? eur(credit) : '', align: 'end', fill: C.green, size: 11.5 },
      { t: eur(e.avail), align: 'end', weight: 600, size: 11.5, fill: e.avail < 0 ? C.danger : C.text },
    ];
  });
  b += table(cx + 18, cy + 232, cw - 36, cols, rows, { rowH: 40 });

  b += text(cx + 18, cy + 638, 'Every movement names the colleague who caused it. Reference links open the trade, invoice or payment.', { size: 11, fill: C.faint });
  b += text(cx + cw - 18, cy + 638, `Showing ${rows.length} of 143 entries`, { size: 11, fill: C.faint, anchor: 'end' });

  return svgDoc(b, { label: 'Customer portal — wallet and ledger' });
}

/* ───────────────────────────────────────────────────────── wallet top-up */
export function walletTopup() {
  const s = shell({ portal: 'customer', title: 'Top up your wallet', crumb: 'Wallet › Add funds', nav: NAV, active: 5, user: USER });
  let b = s.svg;
  const { cx, cy, cw } = s;

  b += note(cx, cy, cw, 'You are € 12.400,00 short for the trade you were composing (Peak Q1-2027 · 1,0 MW). Top up and you will be returned to it.', 'amber');

  const colW = (cw - 24) / 2;

  // iDEAL
  b += rect(cx, cy + 56, colW, 430, { fill: C.panel, stroke: C.accent, r: 10, sw: 2 });
  b += badge(cx + 18, cy + 74, 'RECOMMENDED', 'accent', { w: 106 });
  b += text(cx + 18, cy + 126, 'iDEAL', { size: 22, weight: 700 });
  b += text(cx + 18, cy + 148, 'Funds available within seconds', { size: 12.5, fill: C.muted });
  b += field(cx + 18, cy + 186, colW - 36, 'AMOUNT', '€ 12.400,00', { focus: true, weight: 600 });
  b += text(cx + 18, cy + 240, 'Suggested — the shortfall, rounded up. You can change it.', { size: 10.5, fill: C.faint });
  const quick = ['€ 10.000', '€ 25.000', '€ 50.000', '€ 100.000'];
  quick.forEach((q, i) => { b += badge(cx + 18 + i * 100, cy + 254, q, 'muted', { w: 90, h: 26, size: 12 }); });
  b += field(cx + 18, cy + 316, colW - 36, 'YOUR BANK', 'ING', { });
  b += button(cx + 18, cy + 384, colW - 36, 'Pay € 12.400,00 with iDEAL', 'primary', { h: 44 });
  b += text(cx + colW / 2, cy + 448, 'You will be redirected to your bank and returned here.', { size: 11, fill: C.faint, anchor: 'middle' });
  b += text(cx + colW / 2, cy + 466, 'PeakPower never sees your bank credentials.', { size: 11, fill: C.faint, anchor: 'middle' });

  // Bank transfer
  const bx = cx + colW + 24;
  b += rect(bx, cy + 56, colW, 430, { fill: C.panel, stroke: C.border, r: 10 });
  b += badge(bx + 18, cy + 74, '1–2 BUSINESS DAYS', 'muted', { w: 138 });
  b += text(bx + 18, cy + 126, 'Bank transfer', { size: 22, weight: 700 });
  b += text(bx + 18, cy + 148, 'Transfer from your own bank using the reference below', { size: 12.5, fill: C.muted });

  const bank = [
    ['Account holder', 'PeakPower Trading B.V.'],
    ['IBAN', 'NL18 INGB 0007 2519 44'],
    ['BIC', 'INGBNL2A'],
  ];
  bank.forEach((r, i) => {
    const y = cy + 182 + i * 54;
    b += rect(bx + 18, y, colW - 36, 44, { fill: C.panel2, stroke: C.border, r: 7 });
    b += text(bx + 32, y + 17, r[0].toUpperCase(), { size: 9.5, fill: C.muted, weight: 700 });
    b += text(bx + 32, y + 34, r[1], { size: 13, weight: 600, mono: i > 0 });
    b += text(bx + colW - 32, y + 27, 'copy', { size: 11, fill: C.accent, weight: 600, anchor: 'end' });
  });

  const ry = cy + 344;
  b += rect(bx + 18, ry, colW - 36, 62, { fill: C.accentBg, stroke: '#5eead4', r: 8 });
  b += text(bx + 32, ry + 20, 'PAYMENT REFERENCE — ALWAYS INCLUDE THIS', { size: 9.5, fill: '#0f766e', weight: 700 });
  b += text(bx + 32, ry + 46, 'PP-4821-QK', { size: 22, weight: 700, fill: '#0f766e', mono: true });
  b += text(bx + colW - 32, ry + 44, 'copy', { size: 11, fill: '#0f766e', weight: 600, anchor: 'end' });

  b += note(bx + 18, cy + 420, colW - 36, 'Without the reference we cannot match your transfer automatically.', 'muted');
  b += text(bx + colW / 2, cy + 500, 'Download instructions as PDF', { size: 11.5, fill: C.accent, weight: 600, anchor: 'middle' });

  b += panel(cx, cy + 512, cw, 140, 'Recent top-ups');
  b += table(cx + 18, cy + 566, cw - 36, [
    { label: 'DATE', w: 160 }, { label: 'METHOD', w: 180 }, { label: 'REFERENCE', w: 200 },
    { label: 'STATUS', w: 160 }, { label: 'AMOUNT', w: 220, align: 'end' },
  ], [
    [{ t: '12 Aug 2026, 09:14' }, { t: 'iDEAL · ING' }, { t: 'PAY-2291', mono: true }, { t: 'Succeeded', badge: 'green' }, { t: '€ 25.000,00', align: 'end', weight: 600 }],
    [{ t: '28 Jul 2026, 08:30' }, { t: 'Bank transfer' }, { t: 'DEP-0118', mono: true }, { t: 'Credited', badge: 'green' }, { t: '€ 40.000,00', align: 'end', weight: 600 }],
  ], { rowH: 34 });

  return svgDoc(b, { label: 'Customer portal — wallet top-up' });
}

/* ───────────────────────────────────────────────────────── invoice detail */
export function invoiceDetail() {
  const s = shell({
    portal: 'customer', title: 'Invoice INV-2026-08-0042', crumb: 'August 2026 · settled from wallet on 7 September',
    nav: NAV, active: 6, user: USER, actions: [{ label: 'Download PDF' }, { label: 'Export CSV', variant: 'secondary', w: 106 }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const kw = (cw - 3 * 14) / 4;
  b += kpi(cx, cy, kw, 'INVOICE TOTAL', '€ 41.620,95', 'including VAT', { h: 80 });
  b += kpi(cx + kw + 14, cy, kw, 'BILLED VOLUME', '1.291,4 MWh', 'across 6 connections', { h: 80 });
  b += kpi(cx + 2 * (kw + 14), cy, kw, 'BLOCK COVERAGE', '78,4 %', 'rest settled at day-ahead', { accent: C.accent, h: 80 });
  b += kpi(cx + 3 * (kw + 14), cy, kw, 'SETTLED', '7 Sep 2026', 'wallet debit · ledger #4488', { accent: C.green, h: 80 });

  b += note(cx, cy + 96, cw, '4 of 31 delivery dates were still provisional when this invoice was calculated. Any correction is settled in the January annual true-up.', 'amber');

  b += panel(cx, cy + 152, cw, 470, 'Rotterdam DC — EAN 8716 8710 0000 0000 11', { subtitle: 'Section 1 of 6 · measured consumption 385,42 MWh', right: 'expand all sections' });

  const cols = [
    { label: '#', w: 44 }, { label: 'DESCRIPTION', w: 466 }, { label: 'REFERENCE', w: 140 },
    { label: 'VOLUME', w: 150, align: 'end' }, { label: 'UNIT PRICE', w: 150, align: 'end' },
    { label: 'AMOUNT', w: 180, align: 'end' },
  ];
  const rows = [
    [{ t: '1' }, { t: 'Base block Aug-26', weight: 600, sub: 'block energy at the agreed price' }, { t: 'TRD-1042', mono: true, fill: C.accent }, { t: '297,60 MWh', align: 'end' }, { t: '€ 72,4000', align: 'end' }, { t: '€ 21.546,24', align: 'end', weight: 600 }],
    [{ t: '2' }, { t: 'Peak block Q3-26 — August portion', weight: 600, sub: 'block energy at the agreed price' }, { t: 'TRD-1051', mono: true, fill: C.accent }, { t: '50,40 MWh', align: 'end' }, { t: '€ 96,1500', align: 'end' }, { t: '€ 4.845,96', align: 'end', weight: 600 }],
    [{ t: '3' }, { t: 'Day-ahead purchase — uncovered volume', weight: 600, sub: 'volume-weighted average price' }, { t: 'intervals', fill: C.faint }, { t: '84,12 MWh', align: 'end' }, { t: '€ 91,2400', align: 'end' }, { t: '€ 7.675,11', align: 'end', weight: 600 }],
    [{ t: '4' }, { t: 'Day-ahead sale — surplus volume', weight: 600, sub: 'block volume above consumption' }, { t: 'intervals', fill: C.faint }, { t: '−46,70 MWh', align: 'end', fill: C.green }, { t: '€ 38,9100', align: 'end' }, { t: '− € 1.817,10', align: 'end', weight: 600, fill: C.green }],
    [{ t: '5' }, { t: 'Imbalance — pro-rata allocation', weight: 600, sub: 'portfolio imbalance allocated on consumption' }, { t: 'PVNed', fill: C.faint }, { t: '—', align: 'end', fill: C.faint }, { t: '—', align: 'end', fill: C.faint }, { t: '€ 412,88', align: 'end', weight: 600 }],
    [{ t: '6' }, { t: 'Surcharge', weight: 600, sub: 'contractual adder, valid from 1 Jan 2026' }, { t: 'SUR-0007', mono: true, fill: C.accent }, { t: '385,42 MWh', align: 'end' }, { t: '€ 4,5000', align: 'end' }, { t: '€ 1.734,39', align: 'end', weight: 600 }],
    [{ t: '7' }, { t: 'Energiebelasting — tier 3', weight: 600, sub: 'cumulative year-to-date basis · tariff 2026 v1' }, { t: 'tariff 2026', fill: C.faint }, { t: '385.420 kWh', align: 'end' }, { t: 'tier rate', align: 'end', fill: C.faint }, { t: '€ 0,00', align: 'end', weight: 600, fill: C.faint }],
  ];
  b += table(cx + 18, cy + 212, cw - 36, cols, rows, { rowH: 44 });

  const ty = cy + 546;
  b += line(cx + 18, ty, cx + cw - 18, ty, { stroke: C.border2 });
  b += text(cx + 18, ty + 22, 'Volume check', { size: 11.5, fill: C.muted, weight: 600 });
  b += text(cx + 130, ty + 22, '297,60 + 50,40 + 84,12 − 46,70 = 385,42 MWh — reconciles to measured consumption', { size: 11.5, fill: C.green });
  b += badge(cx + 18, ty + 34, '✓ RECONCILED', 'green', { w: 108, h: 20 });
  b += text(cx + cw - 18, ty + 26, 'Section subtotal', { size: 12, fill: C.muted, anchor: 'end' });
  b += text(cx + cw - 18, ty + 52, '€ 34.397,48', { size: 19, weight: 700, anchor: 'end' });

  return svgDoc(b, { label: 'Customer portal — invoice detail' });
}
