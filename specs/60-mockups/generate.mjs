#!/usr/bin/env node
// Regenerates every mockup SVG in this folder.
//   node specs/60-mockups/generate.mjs
// Output is deterministic — rerunning produces byte-identical files.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as cust from './screens-customer.mjs';
import * as emp from './screens-employee.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const SCREENS = [
  ['customer-dashboard',        cust.customerDashboard,     'Customer portal — dashboard'],
  ['ean-list',                  cust.eanList,               'Customer portal — connections list'],
  ['ean-detail',                cust.eanDetail,             'Customer portal — connection detail'],
  ['chart-day-view',            cust.chartDayView,          'Customer portal — day chart with block overlay'],
  ['chart-month-view',          cust.chartMonthView,        'Customer portal — month chart'],
  ['price-indications',         cust.priceIndications,      'Customer portal — price indications'],
  ['trade-wizard',              cust.tradeWizard,           'Customer portal — trade request wizard'],
  ['trade-offer-countdown',     cust.tradeOfferCountdown,   'Customer portal — offer with countdown'],
  ['trade-history',             cust.tradeHistory,          'Customer portal — trade history'],
  ['wallet-ledger',             cust.walletLedger,          'Customer portal — wallet and ledger'],
  ['wallet-topup',              cust.walletTopup,           'Customer portal — wallet top-up'],
  ['invoice-detail',            cust.invoiceDetail,         'Customer portal — invoice detail'],
  ['employee-home',             emp.employeeHome,           'Employee portal — operations home'],
  ['employee-trade-desk',       emp.employeeTradeDesk,      'Employee portal — trade desk'],
  ['employee-trade-detail',     emp.employeeTradeDetail,    'Employee portal — trade detail and pricing'],
  ['employee-customer-admin',   emp.employeeCustomerAdmin,  'Employee portal — customer administration'],
  ['employee-wallet-admin',     emp.employeeWalletAdmin,    'Employee portal — wallet administration'],
  ['employee-invoice-run',      emp.employeeInvoiceRun,     'Employee portal — invoice run'],
  ['employee-ingestion-health', emp.employeeIngestionHealth,'Employee portal — ingestion health'],
];

let ok = 0;
for (const [name, fn, label] of SCREENS) {
  try {
    const svg = fn();
    writeFileSync(join(here, `${name}.svg`), svg + '\n', 'utf8');
    console.log(`  ✓ ${name}.svg  (${(svg.length / 1024).toFixed(1)} kB)  ${label}`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${name}.svg  ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${ok}/${SCREENS.length} mockups written to ${here}`);
