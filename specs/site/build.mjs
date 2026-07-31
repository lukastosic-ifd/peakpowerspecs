#!/usr/bin/env node
/**
 * Builds the stakeholder site content bundle.
 *
 *   node specs/site/build.mjs
 *
 * Reads every Markdown file under specs/ (excluding site/ and pvned_docs/) plus the SVG mockups,
 * and writes specs/site/content.js as `window.SPEC_CONTENT = {...}`.
 *
 * Inlining rather than fetching keeps the site working from file:// with no server.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const specsRoot = dirname(here);

const SECTIONS = [
  { dir: '.',              key: 'home',         label: 'Start here',   icon: '◆' },
  { dir: '00-overview',    key: 'overview',     label: 'Overview',     icon: '◇' },
  { dir: '10-features',    key: 'features',     label: 'Features',     icon: '▣' },
  { dir: '20-architecture',key: 'architecture', label: 'Architecture', icon: '⬡' },
  { dir: '30-integrations',key: 'integrations', label: 'Integrations', icon: '⇄' },
  { dir: '40-processes',   key: 'processes',    label: 'Processes',    icon: '⟳' },
  { dir: '50-calculations',key: 'calculations', label: 'Calculations', icon: '∑' },
  { dir: '60-mockups',     key: 'mockups',      label: 'Mockups',      icon: '▢' },
  { dir: '70-delivery',    key: 'delivery',     label: 'Delivery',     icon: '▶' },
];

const SKIP_DIRS = new Set(['site', 'pvned_docs', 'node_modules', '.git']);

/* ───────────────────────────────────────────────────────────── collect md */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (extname(entry) === '.md') {
      out.push(full);
    }
  }
  return out;
}

const files = walk(specsRoot).sort();

const docs = files.map((full) => {
  const rel = relative(specsRoot, full).split('/').join('/');
  const md = readFileSync(full, 'utf8');
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
  const section = SECTIONS.find((s) => s.dir === dir) || { key: 'other', label: 'Other', icon: '·' };
  const h1 = md.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : basename(rel, '.md');
  // First non-heading, non-blockquote paragraph, as a summary
  const body = md.replace(/^#.*$/m, '').split('\n');
  let summary = '';
  for (const raw of body) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith('>') || l.startsWith('|') || l.startsWith('---')
      || l.startsWith('```') || l.startsWith('*') || l.startsWith('-')) continue;
    summary = l.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '');
    break;
  }
  return {
    id: rel.replace(/\.md$/, ''),
    path: rel,
    dir,
    section: section.key,
    sectionLabel: section.label,
    title,
    summary: summary.slice(0, 220),
    md,
    words: md.split(/\s+/).length,
  };
});

/* ─────────────────────────────────────────────────────── structured data */

// Features: parse the metadata line in each F*.md
const featureFiles = docs.filter((d) => /^10-features\/F\d\d/.test(d.id));
const features = featureFiles.map((d) => {
  const meta = d.md.match(/\*\*Portal:\*\*\s*([^·]+)·\s*\*\*Priority:\*\*\s*([^·]+)·\s*\*\*Phase:\*\*\s*([^·]+)·\s*\*\*Size:\*\*\s*(\S+)/);
  const code = d.title.match(/^(F\d\d)/);
  const reqs = [...d.md.matchAll(/\|\s*(F\d\d-R\d\d)\s*\|/g)].length;
  const oqs = [...new Set([...d.md.matchAll(/OQ-(\d\d)/g)].map((m) => `OQ-${m[1]}`))];
  return {
    code: code ? code[1] : d.id,
    id: d.id,
    title: d.title.replace(/^F\d\d\s*—\s*/, ''),
    portal: meta ? meta[1].trim() : '',
    priority: meta ? meta[2].trim() : '',
    phase: meta ? meta[3].trim() : '',
    size: meta ? meta[4].trim() : '',
    requirements: reqs,
    openQuestions: oqs.sort(),
  };
}).sort((a, b) => a.code.localeCompare(b.code));

// Open questions: parse the 5-column tables in 80-open-questions.md
const oqDoc = docs.find((d) => d.id === '80-open-questions');
const questions = [];
if (oqDoc) {
  let group = '';
  for (const line of oqDoc.md.split('\n')) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { group = h[1].replace(/[🔴🟠🟡🟢]/g, '').trim(); continue; }
    const m = line.match(/^\|\s*\*\*(OQ-\d\d)\*\*\s*\|\s*(🔴|🟠|🟡|🟢)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/u);
    if (!m) continue;
    const [, ref, emoji, question, impact, owner] = m;
    questions.push({
      ref,
      priority: emoji === '🔴' ? 'P1' : emoji === '🟠' ? 'P2' : 'P3',
      emoji,
      group,
      question: question.trim(),
      impact: impact.trim(),
      owner: owner.trim(),
    });
  }
}
questions.sort((a, b) => a.ref.localeCompare(b.ref));

// Decisions & assumptions from 00-overview/04
const adDoc = docs.find((d) => d.id === '00-overview/04-assumptions-and-decisions');
const assumptions = [];
const decisions = [];
if (adDoc) {
  for (const line of adDoc.md.split('\n')) {
    const a = line.match(/^\|\s*\*\*(AS-\d\d)\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (a) assumptions.push({ ref: a[1], text: a[2], because: a[3], ifWrong: a[4] });
    const d = line.match(/^\|\s*\*\*(DEC-\d\d)\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (d) decisions.push({ ref: d[1], text: d[2], alternatives: d[3], rationale: d[4] });
  }
}

// Risks from 70-delivery/02-risks.md full register
const riskDoc = docs.find((d) => d.id === '70-delivery/02-risks');
const risks = [];
if (riskDoc) {
  for (const line of riskDoc.md.split('\n')) {
    const m = line.match(/^\|\s*\*{0,2}(R-\d\d)\*{0,2}\s*\|\s*(.+?)\s*\|\s*(\d)\s*\|\s*(\d)\s*\|\s*(🔴|🟠|🟡|🟢)\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/u);
    if (m) {
      risks.push({
        ref: m[1], title: m[2], likelihood: +m[3], impact: +m[4],
        emoji: m[5], score: +m[6], mitigation: m[7], owner: m[8],
      });
    }
  }
}

/* ───────────────────────────────────────────────────────────── mockups */

const mockDir = join(specsRoot, '60-mockups');
const mockups = readdirSync(mockDir)
  .filter((f) => f.endsWith('.svg'))
  .sort()
  .map((f) => {
    const svg = readFileSync(join(mockDir, f), 'utf8');
    const t = svg.match(/<title>([^<]*)<\/title>/);
    const name = basename(f, '.svg');
    return {
      name,
      file: f,
      title: t ? t[1] : name,
      portal: name.startsWith('employee-') ? 'Employee portal' : 'Customer portal',
      svg: svg.replace(/\swidth="1440"\sheight="900"/, ''),
    };
  });

/* ─────────────────────────────────────────────────────────────── write */

const bundle = {
  generatedFrom: 'specs/',
  sections: SECTIONS.filter((s) => docs.some((d) => d.section === s.key)),
  docs,
  features,
  questions,
  assumptions,
  decisions,
  risks,
  mockups,
  stats: {
    documents: docs.length,
    words: docs.reduce((a, d) => a + d.words, 0),
    features: features.length,
    requirements: features.reduce((a, f) => a + f.requirements, 0),
    questions: questions.length,
    p1: questions.filter((q) => q.priority === 'P1').length,
    decisions: decisions.length,
    assumptions: assumptions.length,
    risks: risks.length,
    mockups: mockups.length,
    diagrams: docs.reduce((a, d) => a + (d.md.match(/```mermaid/g) || []).length, 0),
  },
};

writeFileSync(
  join(here, 'content.js'),
  `/* Generated by specs/site/build.mjs — do not edit. */\nwindow.SPEC_CONTENT = ${JSON.stringify(bundle)};\n`,
  'utf8',
);

const s = bundle.stats;
console.log(`content.js written
  ${s.documents} documents · ${s.words.toLocaleString('en-GB')} words
  ${s.features} features · ${s.requirements} numbered requirements
  ${s.diagrams} diagrams · ${s.mockups} mockups
  ${s.questions} open questions (${s.p1} blocking) · ${s.decisions} decisions · ${s.assumptions} assumptions · ${s.risks} risks`);
