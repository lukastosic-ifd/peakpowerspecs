import {
  C, rect, text, line, circle, badge, button, panel, kpi, table, field,
  statLine, shell, svgDoc, loadShape, blockShape, polyline, areaFill, stepline,
  coverageBands, axis, legend, note, path,
} from './lib.mjs';

const NAV = ['Home', 'Trade desk', 'Customers', 'Wallets', 'Invoicing', 'Data & feeds', 'Reference data', 'Audit'];
const USER = 'M. Bakker · Trading';

const nl = (v, dec = 2) => {
  const [i, d] = Math.abs(v).toFixed(dec).split('.');
  return (v < 0 ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + d : '');
};
const eur = (v, dec = 2) => `€ ${nl(v, dec)}`;

/* ─────────────────────────────────────────────────────── operations home */
export function employeeHome() {
  const s = shell({ portal: 'employee', title: 'Operations', crumb: 'Thursday 30 July 2026, 14:28', nav: NAV, active: 0, user: USER });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const counters = [
    ['TO PRICE', '3', 'oldest 6 min', C.amber, C.amberBg],
    ['AWAITING CUSTOMER', '5', 'next expiry 04:12', C.indigo, C.indigoBg],
    ['TO CONFIRM', '2', 'oldest 22 min', C.danger, C.dangerBg],
    ['WALLETS BELOW MIN', '4', 'of 47 customers', C.amber, C.panel],
    ['INVOICE DRAFTS', '0', 'next run 5 Sep', C.muted, C.panel],
    ['FEED ISSUES', '1', 'Montel stale 1h42', C.danger, C.panel],
  ];
  const kw = (cw - 5 * 12) / 6;
  counters.forEach((k, i) => {
    b += kpi(cx + i * (kw + 12), cy, kw, k[0], k[1], k[2], { accent: k[3], fill: k[4], h: 92 });
  });

  const ly = cy + 110;
  const leftW = Math.round(cw * 0.63);
  b += panel(cx, ly, leftW, 300, 'Needs attention now', { subtitle: 'ranked by urgency, not by age' });
  const urgent = [
    ['04:12', 'Offer expiring', 'Vandersteen Koeling · TRD-1051 · Peak Q1-27 · € 72.768', 'danger'],
    ['22 min', 'Accepted, not confirmed', 'Kramer Logistics · TRD-1049 · € 41.200', 'danger'],
    ['06 min', 'New request', 'Van Dijk Glastuinbouw · Base Cal-27 · 2,0 MW', 'amber'],
    ['1h 42', 'Montel feed stale', 'NL_POWER_PEAK_Y1 · last observed 12:40', 'amber'],
    ['2 days', 'No metering data', 'Vandersteen Koeling · Almere office (…0059)', 'amber'],
  ];
  urgent.forEach((u, i) => {
    const y = ly + 60 + i * 46;
    b += line(cx, y, cx + leftW, y, { stroke: C.border });
    b += rect(cx + 16, y + 12, 62, 22, { fill: u[3] === 'danger' ? C.dangerBg : C.amberBg, stroke: u[3] === 'danger' ? '#fca5a5' : '#fcd34d', r: 5 });
    b += text(cx + 47, y + 27, u[0], { size: 11, weight: 700, anchor: 'middle', fill: u[3] === 'danger' ? '#991b1b' : '#92400e', mono: true });
    b += text(cx + 90, y + 20, u[1], { size: 12.5, weight: 600 });
    b += text(cx + 90, y + 35, u[2], { size: 10.5, fill: C.muted });
    b += text(cx + leftW - 18, y + 28, '→', { size: 14, fill: C.accent, anchor: 'end' });
  });

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;
  b += panel(rx, ly, rw, 300, 'Exposure', { subtitle: 'value at risk right now' });
  b += statLine(rx + 18, ly + 80, rw - 36, 'Open offers (5)', eur(184300), { weight: 700 });
  b += statLine(rx + 18, ly + 106, rw - 36, 'Accepted, unconfirmed (2)', eur(113968), { weight: 700, fill: C.danger });
  b += line(rx + 18, ly + 122, rx + rw - 18, ly + 122, { stroke: C.border });
  b += statLine(rx + 18, ly + 146, rw - 36, 'Total at risk', eur(298268), { weight: 700 });
  b += text(rx + 18, ly + 178, 'THIS MONTH', { size: 10, fill: C.muted, weight: 700 });
  b += statLine(rx + 18, ly + 202, rw - 36, 'Requests received', '38');
  b += statLine(rx + 18, ly + 226, rw - 36, 'Offers made', '35');
  b += statLine(rx + 18, ly + 250, rw - 36, 'Accepted', '27 (77 %)', { fill: C.green });
  b += statLine(rx + 18, ly + 274, rw - 36, 'Median request → offer', '18 min', { fill: C.green });

  const by = ly + 316;
  b += panel(cx, by, cw, 214, 'Integration health');
  const feeds = [
    ['PVNed timeseries', 'Inbound push', '30 Jul 06:12', '412 documents today', 'Healthy', 'green'],
    ['Montel — indications', 'Poll · 5 min', '30 Jul 14:22', '5 of 6 products fresh', 'Degraded', 'amber'],
    ['Montel — day-ahead', 'Poll · daily', '30 Jul 13:04', '31 Jul complete (96/96)', 'Healthy', 'green'],
    ['CM.com payments', 'Webhook', '30 Jul 09:14', '3 payments today', 'Healthy', 'green'],
    ['Odoo', 'Push', '05 Jul 02:41', 'last run: 47 invoices', 'Healthy', 'green'],
  ];
  b += table(cx + 18, by + 56, cw - 36, [
    { label: 'INTEGRATION', w: 232 }, { label: 'MODE', w: 146 }, { label: 'LAST SUCCESS', w: 172 },
    { label: 'DETAIL', w: 326 }, { label: 'STATUS', w: 148 }, { label: '', w: 106, align: 'end' },
  ], feeds.map((f) => [
    { t: f[0], weight: 600 }, { t: f[1], fill: C.muted }, { t: f[2], mono: true },
    { t: f[3], fill: C.muted }, { t: f[4], badge: f[5] }, { t: 'retry', fill: C.accent, align: 'end' },
  ]), { rowH: 30 });

  return svgDoc(b, { label: 'Employee portal — operations home' });
}

/* ─────────────────────────────────────────────────────────── trade desk */
export function employeeTradeDesk() {
  const s = shell({
    portal: 'employee', title: 'Trade desk', crumb: '10 open items · value at risk € 298.268',
    nav: NAV, active: 1, user: USER, actions: [{ label: 'New request for a customer', variant: 'secondary', w: 200 }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const colW = (cw - 2 * 16) / 3;
  const queues = [
    {
      title: 'To price', sub: '3 requests', accent: C.amber, x: cx,
      items: [
        ['TRD-1058', 'Van Dijk Glastuinbouw', 'Base · Cal-27 · 2,000 MW', '6 min', '17.520 MWh', 'amber'],
        ['TRD-1057', 'Kramer Logistics', 'Peak · Q4-26 · 0,500 MW', '14 min', '396 MWh', 'amber'],
        ['TRD-1056', 'Meijer Koelhuizen', 'Base · Sep-26 · 0,250 MW', '31 min', '180 MWh', 'danger'],
      ],
    },
    {
      title: 'Awaiting customer', sub: '5 offers counting down', accent: C.indigo, x: cx + colW + 16,
      items: [
        ['TRD-1051', 'Vandersteen Koeling', 'Peak · Q1-27 · 1,000 MW', '04:12', '€ 72.768', 'danger'],
        ['TRD-1053', 'Hoekstra Staal', 'Base · Q4-26 · 0,750 MW', '11:48', '€ 61.220', 'amber'],
        ['TRD-1054', 'De Groot Papier', 'Peak · Nov-26 · 0,300 MW', '19:05', '€ 22.150', 'muted'],
        ['TRD-1055', 'Nolte Chemie', 'Base · Cal-27 · 1,500 MW', '24:33', '€ 21.045', 'muted'],
        ['TRD-1050', 'Bosman Tuinbouw', 'Peak · Dec-26 · 0,100 MW', '27:51', '€ 7.117', 'muted'],
      ],
    },
    {
      title: 'To confirm', sub: '2 accepted, awaiting execution', accent: C.danger, x: cx + 2 * (colW + 16),
      items: [
        ['TRD-1049', 'Kramer Logistics', 'Base · Q4-26 · 0,500 MW', '22 min', '€ 41.200', 'danger'],
        ['TRD-1052', 'Hoekstra Staal', 'Peak · Sep-26 · 0,800 MW', '8 min', '€ 72.768', 'amber'],
      ],
    },
  ];

  queues.forEach((q) => {
    b += rect(q.x, cy, colW, 640, { fill: C.panel, stroke: C.border, r: 10 });
    b += rect(q.x, cy, colW, 4, { fill: q.accent, stroke: null, r: 2 });
    b += text(q.x + 18, cy + 32, q.title, { size: 14, weight: 700 });
    b += badge(q.x + colW - 48, cy + 18, String(q.items.length), q.title === 'To price' ? 'amber' : q.title === 'To confirm' ? 'danger' : 'indigo', { w: 30 });
    b += text(q.x + 18, cy + 50, q.sub, { size: 11, fill: C.muted });
    b += line(q.x, cy + 64, q.x + colW, cy + 64, { stroke: C.border });

    q.items.forEach((it, i) => {
      const y = cy + 78 + i * 100;
      const urg = it[5];
      b += rect(q.x + 12, y, colW - 24, 88, { fill: urg === 'danger' ? '#fff7f7' : C.panel2, stroke: urg === 'danger' ? '#fca5a5' : C.border, r: 8 });
      b += text(q.x + 26, y + 22, it[0], { size: 11.5, weight: 700, fill: C.accent, mono: true });
      b += rect(q.x + colW - 96, y + 10, 70, 20, {
        fill: urg === 'danger' ? C.dangerBg : urg === 'amber' ? C.amberBg : C.panel,
        stroke: urg === 'danger' ? '#fca5a5' : urg === 'amber' ? '#fcd34d' : C.border2, r: 5,
      });
      b += text(q.x + colW - 61, y + 24, it[3], {
        size: 10.5, weight: 700, anchor: 'middle', mono: true,
        fill: urg === 'danger' ? '#991b1b' : urg === 'amber' ? '#92400e' : C.muted,
      });
      b += text(q.x + 26, y + 44, it[1], { size: 12.5, weight: 600 });
      b += text(q.x + 26, y + 62, it[2], { size: 11, fill: C.muted });
      b += text(q.x + colW - 26, y + 62, it[4], { size: 12, weight: 700, anchor: 'end' });
      b += text(q.x + 26, y + 79, q.title === 'To price' ? 'open to price →' : q.title === 'To confirm' ? 'confirm or fail →' : 'view offer →', { size: 10, fill: C.accent, weight: 600 });
    });
  });

  b += note(cx, cy + 656, cw, 'Offers under 5 minutes are highlighted. Expiry is decided server-side — an expired offer cannot be accepted even if a customer’s screen still shows a timer.', 'muted');

  return svgDoc(b, { label: 'Employee portal — trade desk' });
}

/* ──────────────────────────────────────────────── trade detail / pricing */
export function employeeTradeDetail() {
  const s = shell({
    portal: 'employee', title: 'TRD-1058 · Van Dijk Glastuinbouw', crumb: 'Trade desk › To price · received 14:22 (6 min ago)',
    nav: NAV, active: 1, user: USER, actions: [{ label: 'Decline', variant: 'secondary', w: 94 }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const leftW = Math.round(cw * 0.60);

  b += panel(cx, cy, leftW, 250, 'The request', { subtitle: 'Buy · Base · Cal 2027 · submitted by K. van Dijk' });
  b += table(cx + 18, cy + 74, leftW - 36, [
    { label: 'CONNECTION', w: 176 }, { label: 'EAN', w: 108 },
    { label: 'CAL-27 FORECAST', w: 142, align: 'end' }, { label: 'EXISTING COVER', w: 130, align: 'end' },
    { label: 'REQUESTED', w: 108, align: 'end' },
  ], [
    [{ t: 'Kas Noord 1', weight: 600 }, { t: '…0114', mono: true }, { t: '6.820 MWh', align: 'end' }, { t: '0,20 MW', align: 'end' }, { t: '0,800', align: 'end', weight: 700, mono: true }],
    [{ t: 'Kas Noord 2', weight: 600 }, { t: '…0122', mono: true }, { t: '5.410 MWh', align: 'end' }, { t: '0,20 MW', align: 'end' }, { t: '0,700', align: 'end', weight: 700, mono: true }],
    [{ t: 'WKK-installatie', weight: 600 }, { t: '…0139', mono: true }, { t: '4.180 MWh', align: 'end' }, { t: '—', align: 'end', fill: C.faint }, { t: '0,500', align: 'end', weight: 700, mono: true }],
  ], { rowH: 38 });
  b += line(cx + 18, cy + 190, cx + leftW - 18, cy + 190, { stroke: C.border2 });
  b += text(cx + 18, cy + 212, 'Total requested', { size: 12.5, weight: 700 });
  b += text(cx + leftW - 18, cy + 212, '2,000 MW · 17.520,00 MWh', { size: 14, weight: 700, anchor: 'end' });
  b += badge(cx + 150, cy + 199, 'WHOLE MW', 'green', { w: 86, h: 18 });
  b += text(cx + 18, cy + 234, 'Customer note: “Locking in most of next year before the winter curve moves.”', { size: 11, fill: C.muted });
  b += rect(cx + leftW - 292, cy + 8, 274, 46, { fill: C.panel2, stroke: C.border, r: 7 });
  b += text(cx + leftW - 278, cy + 26, 'REQUESTED BY', { size: 9.5, fill: C.muted, weight: 700 });
  b += text(cx + leftW - 278, cy + 44, 'K. van Dijk · Energy Manager · +31 77 396 2210', { size: 11, weight: 600 });

  b += panel(cx, cy + 266, leftW, 300, 'Customer position — Cal 2027', { subtitle: 'existing cover vs. forecast consumption', right: 'Van Dijk Glastuinbouw' });
  const gx = cx + 62; const gy = cy + 336; const gw = leftW - 96; const gh = 168;
  const cons = loadShape(23, 340, 610);
  const blk = blockShape(0.4, 0.0).map((mw) => mw * 250);
  b += axis(gx, gy, gw, gh, ['00', '04', '08', '12', '16', '20', '24'], { yLabels: ['700', '525', '350', '175', '0'] });
  b += coverageBands(cons, blk, gx, gy, gw, gh, 700);
  b += areaFill(cons, gx, gy, gw, gh, 700, { fill: C.sConsume, opacity: 0.1 });
  b += polyline(cons, gx, gy, gw, gh, 700, { stroke: C.sConsume, sw: 2 });
  b += stepline(blk, gx, gy, gw, gh, 700, { stroke: C.sBlock, sw: 2 });
  b += stepline(blk.map((v) => v + 500), gx, gy, gw, gh, 700, { stroke: C.accent, sw: 2, dash: '5 3' });
  b += legend(gx, cy + 546, [
    { color: C.sConsume, label: 'Typical day' },
    { color: C.sBlock, label: 'Existing cover 0,4 MW', dash: true },
    { color: C.accent, label: 'After this trade 2,4 MW', dash: true },
  ]);

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;

  b += panel(rx, cy, rw, 176, 'Market reference');
  b += statLine(rx + 18, cy + 66, rw - 36, 'Indication at submission (14:22)', '€ 79,9000');
  b += statLine(rx + 18, cy + 92, rw - 36, 'Indication now (14:28)', '€ 80,1500', { fill: C.amber });
  b += statLine(rx + 18, cy + 118, rw - 36, 'Cal-27 base, 30-day range', '€ 76,20 – € 82,40');
  b += statLine(rx + 18, cy + 144, rw - 36, 'Last traded with this customer', '€ 78,4000 (12 Jun)');

  b += panel(rx, cy + 192, rw, 168, 'Wallet check');
  b += statLine(rx + 18, cy + 250, rw - 36, 'Settled balance', eur(1650000));
  b += statLine(rx + 18, cy + 276, rw - 36, 'Reserved', eur(0));
  b += statLine(rx + 18, cy + 302, rw - 36, 'Available', eur(1650000), { weight: 700 });
  b += badge(rx + 18, cy + 318, 'SUFFICIENT FOR ~ € 1,65 M', 'green', { w: 196, h: 20 });

  b += rect(rx, cy + 376, rw, 264, { fill: C.panel, stroke: C.accent, r: 10, sw: 2 });
  b += text(rx + 18, cy + 404, 'Make an offer', { size: 14, weight: 700 });
  b += field(rx + 18, cy + 436, (rw - 48) / 2, 'PRICE (€/MWh)', '80,4500', { focus: true, mono: true, weight: 700 });
  b += field(rx + 30 + (rw - 48) / 2, cy + 436, (rw - 48) / 2, 'WINDOW (MIN)', '30', { mono: true, weight: 700 });
  b += rect(rx + 18, cy + 494, rw - 36, 70, { fill: C.panel2, stroke: C.border, r: 8 });
  b += statLine(rx + 32, cy + 518, rw - 64, 'Offer value', eur(1409484), { weight: 700 });
  b += statLine(rx + 32, cy + 542, rw - 64, 'Will be reserved on acceptance', eur(1409484), { fill: C.amber });
  b += text(rx + 32, cy + 558, 'expires 14:58 · spread vs. indication + € 0,30', { size: 10, fill: C.faint });
  b += button(rx + 18, cy + 578, rw - 36, 'Publish offer', 'primary', { h: 42 });
  b += text(rx + rw / 2, cy + 636, 'Internal note (not visible to the customer)', { size: 10.5, fill: C.faint, anchor: 'middle' });

  return svgDoc(b, { label: 'Employee portal — trade detail and pricing' });
}

/* ────────────────────────────────────────────────── customer administration */
export function employeeCustomerAdmin() {
  const s = shell({
    portal: 'employee', title: 'Vandersteen Koeling B.V.', crumb: 'Customers › KvK 34215678 · active since 1 Jan 2024',
    nav: NAV, active: 2, user: USER,
    actions: [{ label: 'Add connection' }, { label: 'View as customer', variant: 'secondary', w: 138 }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const kw = (cw - 4 * 12) / 5;
  b += kpi(cx, cy, kw, 'STATUS', 'Active', 'since 1 Jan 2024', { accent: C.green, h: 82 });
  b += kpi(cx + kw + 12, cy, kw, 'CONNECTIONS', '7', '6 electricity · 1 gas', { h: 82 });
  b += kpi(cx + 2 * (kw + 12), cy, kw, 'AVAILABLE BALANCE', eur(19722), 'below € 25.000 minimum', { accent: C.amber, h: 82 });
  b += kpi(cx + 3 * (kw + 12), cy, kw, 'OPEN TRADES', '2', '1 offer, 1 reserved', { h: 82 });
  b += kpi(cx + 4 * (kw + 12), cy, kw, 'LAST INVOICE', eur(18110), 'INV-2026-07-0042', { h: 82 });

  const leftW = Math.round(cw * 0.36);
  b += panel(cx, cy + 98, leftW, 344, 'Company', { subtitle: 'the customer is a legal entity' });
  const md = [
    ['Legal name', 'Vandersteen Koeling B.V.'], ['Trade name', 'Vandersteen Cooling'],
    ['KvK', '34215678'], ['VAT', 'NL812345678B01'],
    ['IBAN', 'NL18 INGB 0002 4455 66'], ['BIC', 'INGBNL2A'],
    ['Account holder', 'Vandersteen Koeling B.V.'],
    ['Billing address', 'Havenweg 22, Rotterdam'],
    ['Primary contact', 'J. de Vries · +31 10 240 1188'],
  ];
  md.forEach((m, i) => {
    b += statLine(cx + 18, cy + 184 + i * 24, leftW - 36, m[0], m[1], { mono: m[0] === 'IBAN' || m[0] === 'BIC' });
  });
  b += badge(cx + 18, cy + 402, 'BANK DETAILS VERIFIED', 'green', { w: 158, h: 20 });
  b += button(cx + leftW - 100, cy + 397, 82, 'Edit', 'secondary', { h: 30 });

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;
  b += panel(rx, cy + 98, rw, 344, 'Metering points', { right: '7 · 1 ending 31 Dec 2026' });
  b += table(rx + 18, cy + 150, rw - 36, [
    { label: 'EAN', w: 100 }, { label: 'CUSTOMER NAME', w: 180 }, { label: 'COMMODITY', w: 90 },
    { label: 'VALID FROM', w: 92 }, { label: 'VALID TO', w: 92 },
    { label: 'DATA', w: 90 }, { label: '', w: 50, align: 'end' },
  ], [
    [{ t: '…0011', mono: true }, { t: 'Rotterdam DC' }, { t: 'Electricity' }, { t: '01-01-2024' }, { t: '—', fill: C.faint }, { t: 'OK', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: '…0027', mono: true }, { t: 'Venlo cold store' }, { t: 'Electricity' }, { t: '01-01-2024' }, { t: '—', fill: C.faint }, { t: 'OK', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: '…0043', mono: true }, { t: 'Tilburg plant' }, { t: 'Electricity' }, { t: '01-04-2024' }, { t: '—', fill: C.faint }, { t: 'OK', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: '…0059', mono: true }, { t: 'Almere office' }, { t: 'Electricity' }, { t: '01-01-2025' }, { t: '—', fill: C.faint }, { t: '2d silent', badge: 'danger' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: '…0061', mono: true }, { t: '— none set —', fill: C.faint }, { t: 'Electricity' }, { t: '01-06-2026' }, { t: '—', fill: C.faint }, { t: 'OK', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: '…0078', mono: true }, { t: 'Breda warehouse' }, { t: 'Electricity' }, { t: '01-01-2024' }, { t: '31-12-2026', fill: C.amber }, { t: 'OK', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: '…0092', mono: true }, { t: 'Tilburg plant — gas' }, { t: 'Gas', fill: C.muted }, { t: '01-04-2024' }, { t: '—', fill: C.faint }, { t: 'Not tradeable', badge: 'muted' }, { t: 'edit', fill: C.accent, align: 'end' }],
  ], { rowH: 30 });

  const by = cy + 462;
  const halfW = (cw - 16) / 2;
  b += panel(cx, by, halfW, 250, 'Commercial settings');
  b += statLine(cx + 18, by + 76, halfW - 36, 'Surcharge (from 1 Jan 2026)', '€ 4,5000 / MWh', { weight: 700 });
  b += statLine(cx + 18, by + 102, halfW - 36, 'Previous (2025)', '€ 5,2000 / MWh');
  b += statLine(cx + 18, by + 128, halfW - 36, 'Wallet minimum — warning', eur(25000));
  b += statLine(cx + 18, by + 154, halfW - 36, 'Wallet minimum — critical', eur(10000));
  b += statLine(cx + 18, by + 180, halfW - 36, 'Surplus settlement policy', 'Day-ahead');
  b += statLine(cx + 18, by + 206, halfW - 36, 'Short selling', 'Not permitted', { fill: C.danger });

  const ax = cx + halfW + 16;
  b += panel(ax, by, halfW, 250, 'Customer accounts', {
    subtitle: 'all accounts have identical privileges', right: '4 · 3 active',
  });
  b += button(ax + halfW - 128, by + 14, 110, 'Add account', 'primary', { h: 26 });
  b += table(ax + 18, by + 68, halfW - 36, [
    { label: 'NAME', w: 116 }, { label: 'ROLE IN COMPANY', w: 124 },
    { label: 'USERNAME', w: 96 }, { label: 'LAST SIGN-IN', w: 82 },
    { label: 'STATUS', w: 78 }, { label: '', w: 43, align: 'end' },
  ], [
    [{ t: 'J. de Vries', weight: 600 }, { t: 'Energy Manager', fill: C.muted }, { t: 'jdevries', mono: true, size: 11 }, { t: '30 Jul 14:25' }, { t: 'Active', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: 'M. Vandersteen', weight: 600 }, { t: 'Finance Director', fill: C.muted }, { t: 'mvandersteen', mono: true, size: 10 }, { t: '30 Jul 14:44' }, { t: 'Active', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: 'P. Aksoy', weight: 600 }, { t: 'Operations', fill: C.muted }, { t: 'paksoy', mono: true, size: 11 }, { t: '12 Jul 09:02' }, { t: 'Active', badge: 'green' }, { t: 'edit', fill: C.accent, align: 'end' }],
    [{ t: 'R. Smit', weight: 600, fill: C.faint }, { t: 'Controller', fill: C.faint }, { t: 'rsmit', mono: true, size: 11, fill: C.faint }, { t: '—', fill: C.faint }, { t: 'Invited 6d', badge: 'amber' }, { t: 'resend', fill: C.accent, align: 'end' }],
  ], { rowH: 30 });
  b += text(ax + 18, by + 238, 'Deactivated accounts stay on record so past trades still name a person.', { size: 10.5, fill: C.faint });

  return svgDoc(b, { label: 'Employee portal — customer administration' });
}

/* ─────────────────────────────────────────────────── wallet administration */
export function employeeWalletAdmin() {
  const s = shell({
    portal: 'employee', title: 'Wallets', crumb: '47 customers · 4 below their minimum · total held € 8,42 M',
    nav: NAV, active: 3, user: USER, actions: [{ label: 'Register bank deposit' }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const kw = (cw - 3 * 14) / 4;
  b += kpi(cx, cy, kw, 'TOTAL SETTLED', '€ 8.418.220', 'across 47 wallets', { h: 84 });
  b += kpi(cx + kw + 14, cy, kw, 'TOTAL RESERVED', '€ 298.268', '7 open reservations', { accent: C.amber, h: 84 });
  b += kpi(cx + 2 * (kw + 14), cy, kw, 'BELOW MINIMUM', '4', '1 negative', { accent: C.danger, h: 84 });
  b += kpi(cx + 3 * (kw + 14), cy, kw, 'RECONCILIATION', 'OK', 'last check 03:00 · 0 mismatches', { accent: C.green, h: 84 });

  b += panel(cx, cy + 100, cw, 330, 'Wallets', { subtitle: 'sorted by available balance, lowest first', right: 'Below minimum ▾' });
  b += table(cx + 18, cy + 158, cw - 36, [
    { label: 'CUSTOMER', w: 216 }, { label: 'SETTLED', w: 140, align: 'end' },
    { label: 'RESERVED', w: 128, align: 'end' }, { label: 'AVAILABLE', w: 140, align: 'end' },
    { label: 'MINIMUM', w: 128, align: 'end' }, { label: 'STATUS', w: 134 },
    { label: 'LAST MOVEMENT', w: 152 }, { label: '', w: 92, align: 'end' },
  ], [
    [{ t: 'Meijer Koelhuizen', weight: 600 }, { t: eur(-4210), align: 'end', fill: C.danger }, { t: eur(0), align: 'end' }, { t: eur(-4210), align: 'end', weight: 700, fill: C.danger }, { t: eur(15000), align: 'end' }, { t: 'Negative', badge: 'danger' }, { t: '01-08 invoice' }, { t: 'open', fill: C.accent, align: 'end' }],
    [{ t: 'Bosman Tuinbouw', weight: 600 }, { t: eur(8940), align: 'end' }, { t: eur(7117), align: 'end' }, { t: eur(1823), align: 'end', weight: 700, fill: C.danger }, { t: eur(10000), align: 'end' }, { t: 'Critical', badge: 'danger' }, { t: '29-07 reserved' }, { t: 'open', fill: C.accent, align: 'end' }],
    [{ t: 'Vandersteen Koeling', weight: 600 }, { t: eur(29122), align: 'end' }, { t: eur(9400), align: 'end' }, { t: eur(19722), align: 'end', weight: 700, fill: C.amber }, { t: eur(25000), align: 'end' }, { t: 'Warning', badge: 'amber' }, { t: '13-08 reserved' }, { t: 'open', fill: C.accent, align: 'end' }],
    [{ t: 'De Groot Papier', weight: 600 }, { t: eur(41800), align: 'end' }, { t: eur(22150), align: 'end' }, { t: eur(19650), align: 'end', weight: 700, fill: C.amber }, { t: eur(20000), align: 'end' }, { t: 'Warning', badge: 'amber' }, { t: '30-07 reserved' }, { t: 'open', fill: C.accent, align: 'end' }],
    [{ t: 'Kramer Logistics', weight: 600 }, { t: eur(220400), align: 'end' }, { t: eur(41200), align: 'end' }, { t: eur(179200), align: 'end', weight: 700 }, { t: eur(50000), align: 'end' }, { t: 'Healthy', badge: 'green' }, { t: '30-07 reserved' }, { t: 'open', fill: C.accent, align: 'end' }],
    [{ t: 'Van Dijk Glastuinbouw', weight: 600 }, { t: eur(1650000), align: 'end' }, { t: eur(0), align: 'end' }, { t: eur(1650000), align: 'end', weight: 700 }, { t: eur(200000), align: 'end' }, { t: 'Healthy', badge: 'green' }, { t: '18-07 deposit' }, { t: 'open', fill: C.accent, align: 'end' }],
  ], { rowH: 38 });

  const by = cy + 448;
  const halfW = (cw - 16) / 2;
  b += rect(cx, by, halfW, 204, { fill: C.panel, stroke: C.border, r: 10 });
  b += text(cx + 18, by + 28, 'Register a bank deposit', { size: 13.5, weight: 700 });
  b += line(cx, by + 42, cx + halfW, by + 42, { stroke: C.border });
  b += field(cx + 18, by + 72, (halfW - 48) / 2, 'CUSTOMER', 'Meijer Koelhuizen', {});
  b += field(cx + 30 + (halfW - 48) / 2, by + 72, (halfW - 48) / 2, 'AMOUNT', '€ 20.000,00', { focus: true, weight: 600 });
  b += field(cx + 18, by + 132, (halfW - 48) / 2, 'VALUE DATE', '13-08-2026', {});
  b += field(cx + 30 + (halfW - 48) / 2, by + 132, (halfW - 48) / 2, 'BANK REFERENCE', 'PP-9014-TR', { mono: true });
  b += button(cx + halfW - 148, by + 168, 130, 'Register deposit', 'primary', { h: 30 });

  b += rect(cx + halfW + 16, by, halfW, 204, { fill: C.panel, stroke: C.border, r: 10 });
  b += text(cx + halfW + 34, by + 28, 'Manual adjustment', { size: 13.5, weight: 700 });
  b += badge(cx + 2 * halfW - 116, by + 16, 'REASON REQUIRED', 'danger', { w: 116 });
  b += line(cx + halfW + 16, by + 42, cx + 2 * halfW + 16, by + 42, { stroke: C.border });
  b += field(cx + halfW + 34, by + 72, (halfW - 48) / 2, 'DIRECTION', 'Credit', {});
  b += field(cx + halfW + 46 + (halfW - 48) / 2, by + 72, (halfW - 48) / 2, 'AMOUNT', '€ 0,00', {});
  b += field(cx + halfW + 34, by + 132, halfW - 52, 'REASON — SHOWN TO THE CUSTOMER', '', { });
  b += text(cx + halfW + 46, by + 156, 'e.g. “Goodwill credit agreed with J. de Vries on 12 Aug”', { size: 11.5, fill: C.faint });
  b += button(cx + 2 * halfW - 132, by + 168, 116, 'Post adjustment', 'disabled', { h: 30 });

  return svgDoc(b, { label: 'Employee portal — wallet administration' });
}

/* ─────────────────────────────────────────────────────── invoice run */
export function employeeInvoiceRun() {
  const s = shell({
    portal: 'employee', title: 'Invoice run — August 2026', crumb: 'Started 5 Sep 02:00 · completed 02:26 · 47 customers in scope',
    nav: NAV, active: 4, user: USER,
    actions: [{ label: 'Finalise 41 drafts' }, { label: 'Re-run skipped', variant: 'secondary', w: 130 }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const kw = (cw - 4 * 12) / 5;
  b += kpi(cx, cy, kw, 'DRAFTED', '41', 'ready for review', { accent: C.green, h: 84 });
  b += kpi(cx + kw + 12, cy, kw, 'SKIPPED', '5', 'pre-flight gate', { accent: C.amber, h: 84 });
  b += kpi(cx + 2 * (kw + 12), cy, kw, 'FAILED', '1', 'volume identity', { accent: C.danger, h: 84 });
  b += kpi(cx + 3 * (kw + 12), cy, kw, 'TOTAL VALUE', '€ 1,84 M', 'excluding VAT', { h: 84 });
  b += kpi(cx + 4 * (kw + 12), cy, kw, 'DURATION', '26 min', 'target < 30 min', { accent: C.green, h: 84 });

  b += rect(cx, cy + 100, cw, 56, { fill: '#fff7f7', stroke: '#fca5a5', r: 10 });
  b += circle(cx + 30, cy + 128, 11, { fill: C.danger });
  b += text(cx + 30, cy + 132, '!', { size: 15, fill: '#fff', weight: 700, anchor: 'middle' });
  b += text(cx + 52, cy + 124, 'Hoekstra Staal — calculation halted: volume identity did not reconcile on EAN …0233 (difference 4,182 MWh)', { size: 12.5, weight: 700, fill: '#991b1b' });
  b += text(cx + 52, cy + 142, 'This indicates a coverage or calendar defect, not a data gap. No draft was produced. Engineering has been alerted.', { size: 11, fill: '#b91c1c' });
  b += button(cx + cw - 150, cy + 113, 132, 'Investigate', 'danger', { h: 30 });

  b += panel(cx, cy + 172, cw, 232, 'Skipped customers', { subtitle: 'each skip names its cause — the run continued for everyone else' });
  b += table(cx + 18, cy + 230, cw - 36, [
    { label: 'CUSTOMER', w: 220 }, { label: 'REASON', w: 250 }, { label: 'DETAIL', w: 404 },
    { label: 'FIX OWNER', w: 150 }, { label: '', w: 106, align: 'end' },
  ], [
    [{ t: 'Nolte Chemie', weight: 600 }, { t: 'MISSING_METERING_DATA', mono: true, size: 11, fill: C.amber }, { t: '3 delivery dates without data · EAN …0417' }, { t: 'Data team' }, { t: 're-run', fill: C.accent, align: 'end' }],
    [{ t: 'Bosman Tuinbouw', weight: 600 }, { t: 'INCOMPLETE_METERING_DATA', mono: true, size: 11, fill: C.amber }, { t: '29 Aug is PARTIAL (72 of 96 intervals)' }, { t: 'Data team' }, { t: 're-run', fill: C.accent, align: 'end' }],
    [{ t: 'Meijer Koelhuizen', weight: 600 }, { t: 'MISSING_DAY_AHEAD_PRICE', mono: true, size: 11, fill: C.amber }, { t: '31 Aug 22:00–24:00 missing from the curve' }, { t: 'Platform' }, { t: 're-run', fill: C.accent, align: 'end' }],
    [{ t: 'Dekker Betonwaren', weight: 600 }, { t: 'MISSING_IMBALANCE_DATA', mono: true, size: 11, fill: C.amber }, { t: 'No imbalance report received for August' }, { t: 'PVNed' }, { t: 're-run', fill: C.accent, align: 'end' }],
    [{ t: 'Van Loon Transport', weight: 600 }, { t: 'MISSING_METERING_DATA', mono: true, size: 11, fill: C.amber }, { t: 'Quarantined series — EAN not registered' }, { t: 'Account manager' }, { t: 're-run', fill: C.accent, align: 'end' }],
  ], { rowH: 32 });

  b += panel(cx, cy + 420, cw, 232, 'Drafts ready for review', { right: '41 · showing 5' });
  b += table(cx + 18, cy + 478, cw - 36, [
    { label: 'CUSTOMER', w: 220 }, { label: 'CONNECTIONS', w: 110, align: 'end' },
    { label: 'VOLUME', w: 140, align: 'end' }, { label: 'SUBTOTAL', w: 150, align: 'end' },
    { label: 'VAT', w: 130, align: 'end' }, { label: 'TOTAL', w: 164, align: 'end' },
    { label: 'DATA', w: 170 }, { label: '', w: 46, align: 'end' },
  ], [
    [{ t: 'Van Dijk Glastuinbouw', weight: 600 }, { t: '3', align: 'end' }, { t: '1.418,2 MWh', align: 'end' }, { t: eur(142880.14), align: 'end' }, { t: eur(30004.83), align: 'end' }, { t: eur(172884.97), align: 'end', weight: 700 }, { t: 'Final', badge: 'green' }, { t: '→', fill: C.accent, align: 'end' }],
    [{ t: 'Kramer Logistics', weight: 600 }, { t: '9', align: 'end' }, { t: '904,7 MWh', align: 'end' }, { t: eur(91218.40), align: 'end' }, { t: eur(19155.86), align: 'end' }, { t: eur(110374.26), align: 'end', weight: 700 }, { t: 'Final', badge: 'green' }, { t: '→', fill: C.accent, align: 'end' }],
    [{ t: 'Vandersteen Koeling', weight: 600 }, { t: '6', align: 'end' }, { t: '1.291,4 MWh', align: 'end' }, { t: eur(34397.48), align: 'end' }, { t: eur(7223.47), align: 'end' }, { t: eur(41620.95), align: 'end', weight: 700 }, { t: '4 provisional', badge: 'amber' }, { t: '→', fill: C.accent, align: 'end' }],
    [{ t: 'De Groot Papier', weight: 600 }, { t: '4', align: 'end' }, { t: '612,9 MWh', align: 'end' }, { t: eur(58204.11), align: 'end' }, { t: eur(12222.86), align: 'end' }, { t: eur(70426.97), align: 'end', weight: 700 }, { t: 'Final', badge: 'green' }, { t: '→', fill: C.accent, align: 'end' }],
    [{ t: 'Hendriks Vlees', weight: 600 }, { t: '2', align: 'end' }, { t: '188,4 MWh', align: 'end' }, { t: eur(19044.02), align: 'end' }, { t: eur(3999.24), align: 'end' }, { t: eur(23043.26), align: 'end', weight: 700 }, { t: '1 provisional', badge: 'amber' }, { t: '→', fill: C.accent, align: 'end' }],
  ], { rowH: 32 });

  return svgDoc(b, { label: 'Employee portal — invoice run dashboard' });
}

/* ──────────────────────────────────────────────────── ingestion health */
export function employeeIngestionHealth() {
  const s = shell({
    portal: 'employee', title: 'Data & feeds', crumb: 'PVNed ingestion · 412 documents today · 1 quarantined',
    nav: NAV, active: 5, user: USER, actions: [{ label: 'Replay message', variant: 'secondary', w: 130 }],
  });
  let b = s.svg;
  const { cx, cy, cw } = s;

  const kw = (cw - 4 * 12) / 5;
  b += kpi(cx, cy, kw, 'DOCUMENTS TODAY', '412', 'all acknowledged < 1 s', { accent: C.green, h: 84 });
  b += kpi(cx + kw + 12, cy, kw, 'PROCESSING LAG', '42 s', 'p95 · target < 5 min', { accent: C.green, h: 84 });
  b += kpi(cx + 2 * (kw + 12), cy, kw, 'FAILED', '2', 'both validation errors', { accent: C.amber, h: 84 });
  b += kpi(cx + 3 * (kw + 12), cy, kw, 'QUARANTINED', '1', 'EAN not registered', { accent: C.amber, h: 84 });
  b += kpi(cx + 4 * (kw + 12), cy, kw, 'SILENT CONNECTIONS', '3', 'no data for 3+ days', { accent: C.danger, h: 84 });

  // heat map
  b += panel(cx, cy + 100, cw, 268, 'Data state per connection', { subtitle: 'last 21 delivery dates · all customers', right: 'Silent first ▾' });
  const conns = [
    ['Vandersteen · Almere office', '…0059', ['F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'N', 'N', 'N']],
    ['Nolte Chemie · Reactor 2', '…0417', ['F', 'F', 'F', 'N', 'N', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'N', 'F', 'F', 'F', 'F', 'F', 'F', 'P', 'P']],
    ['Bosman · Kas 4', '…0308', ['F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'A', 'P', 'P', 'P']],
    ['Vandersteen · Rotterdam DC', '…0011', ['F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'C', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'P', 'P', 'P', 'P']],
    ['Kramer · Hub Venlo', '…0512', ['F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'P', 'P', 'P', 'P']],
  ];
  const cellW = (cw - 400) / 21;
  conns.forEach((c, ri) => {
    const y = cy + 164 + ri * 38;
    b += text(cx + 18, y + 16, c[0], { size: 12, weight: 600 });
    b += text(cx + 18, y + 30, c[1], { size: 10, fill: C.faint, mono: true });
    c[2].forEach((st, i) => {
      const x = cx + 330 + i * cellW;
      const map = { F: [C.greenBg, '#86efac'], P: [C.amberBg, '#fcd34d'], C: [C.indigoBg, '#a5b4fc'], N: [C.dangerBg, '#fca5a5'], A: ['#f3e8ff', '#d8b4fe'] };
      const [fill, stroke] = map[st];
      b += rect(x, y + 4, cellW - 4, 26, { fill, stroke, r: 4 });
      b += text(x + (cellW - 4) / 2, y + 21, st, { size: 9.5, weight: 700, anchor: 'middle', fill: C.muted });
    });
  });
  b += legend(cx + 330, cy + 354, [
    { color: '#86efac', label: 'F final' }, { color: '#fcd34d', label: 'P provisional' },
    { color: '#a5b4fc', label: 'C corrected' }, { color: '#fca5a5', label: 'N no data' },
    { color: '#d8b4fe', label: 'A partial' },
  ]);

  const my = cy + 384;
  const leftW = Math.round(cw * 0.66);
  b += panel(cx, my, leftW, 268, 'Inbound messages', { right: 'last 24 h' });
  b += table(cx + 18, my + 56, leftW - 36, [
    { label: 'RECEIVED', w: 100 }, { label: 'TYPE', w: 112 }, { label: 'DOCUMENT ID', w: 150 },
    { label: 'SERIES', w: 62, align: 'end' }, { label: 'STATUS', w: 118 }, { label: 'DETAIL', w: 192 },
  ], [
    [{ t: '06:12:04', mono: true }, { t: 'A23 allocation' }, { t: '8ff18bca…c6c8', mono: true, size: 11 }, { t: '84', align: 'end' }, { t: 'Processed', badge: 'green' }, { t: '42 EANs · 12 Aug', fill: C.muted }],
    [{ t: '06:11:47', mono: true }, { t: 'A12 imbalance' }, { t: '3e09aa9e…0614', mono: true, size: 11 }, { t: '10', align: 'end' }, { t: 'Processed', badge: 'green' }, { t: 'portfolio · 12 Aug', fill: C.muted }],
    [{ t: '06:11:20', mono: true }, { t: 'A23 allocation' }, { t: 'c7e23533…2f93', mono: true, size: 11 }, { t: '2', align: 'end' }, { t: 'Quarantined', badge: 'amber' }, { t: 'EAN …0644 not registered', fill: C.amber }],
    [{ t: '06:10:58', mono: true }, { t: 'A23 allocation' }, { t: '4cd0eb39…555f', mono: true, size: 11 }, { t: '2', align: 'end' }, { t: 'Failed', badge: 'danger' }, { t: 'INCOMPLETE_PERIOD 94/96', fill: C.danger }],
    [{ t: '06:10:31', mono: true }, { t: 'A23 allocation' }, { t: '855b6a61…e834', mono: true, size: 11 }, { t: '2', align: 'end' }, { t: 'Duplicate', badge: 'muted' }, { t: 'identical payload 06:09', fill: C.muted }],
    [{ t: '05:58:02', mono: true }, { t: 'A23 allocation' }, { t: '59d79ae3…74b7', mono: true, size: 11 }, { t: '96', align: 'end' }, { t: 'Processed', badge: 'green' }, { t: 'correction · 31 Jul', fill: C.indigo }],
  ], { rowH: 32 });

  const rx = cx + leftW + 16;
  const rw = cw - leftW - 16;
  b += panel(rx, my, rw, 268, 'Quarantine', { subtitle: 'never discarded' });
  b += rect(rx + 18, my + 70, rw - 36, 100, { fill: C.amberBg, stroke: '#fcd34d', r: 8 });
  b += text(rx + 32, my + 94, 'EAN 8716 8710 0000 0006 44', { size: 12.5, weight: 700, fill: '#92400e', mono: true });
  b += text(rx + 32, my + 114, 'Consumption + production, 12 Aug 2026', { size: 11, fill: '#92400e' });
  b += text(rx + 32, my + 132, '192 points held · first seen 3 days ago', { size: 11, fill: '#92400e' });
  b += text(rx + 32, my + 152, 'Sender GLN matches PVNed. Likely a new connection.', { size: 10.5, fill: '#b45309' });
  b += button(rx + 18, my + 186, (rw - 48) / 2, 'Register EAN', 'primary', { h: 34 });
  b += button(rx + 30 + (rw - 48) / 2, my + 186, (rw - 48) / 2, 'Assign to customer', 'secondary', { h: 34 });
  b += text(rx + 18, my + 244, 'Resolving the EAN replays the held series automatically.', { size: 10.5, fill: C.faint });

  return svgDoc(b, { label: 'Employee portal — ingestion health' });
}
