// WCAG 2.x contrast gate for the warm glass theme.
// Reads the :root tokens from apps/web/src/index.css, composites every glass tint
// over the page background and its glow peaks, and fails when text drops below 4.5:1.
import { readFileSync } from 'node:fs';

const MIN = 4.5;
const css = readFileSync(new URL('../apps/web/src/index.css', import.meta.url), 'utf8');
const root = css.match(/:root\s*{([^}]*)}/)?.[1];
if (!root) throw new Error('No :root block found in index.css');
const tokens = Object.fromEntries([...root.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

function color(value) {
  const hex = value.match(/^#([\da-f]{6})([\da-f]{2})?$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: hex[2] ? parseInt(hex[2], 16) / 255 : 1 };
  }
  const rgb = value.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
  throw new Error(`Unsupported colour: ${value}`);
}
const token = (name) => {
  const value = tokens[name];
  if (value === undefined) throw new Error(`Missing token --${name}`);
  return color(value);
};
const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
const channel = (value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const bg = token('bg');
const glows = ['glow-1', 'glow-2', 'glow-3'].map((name) => [name, token(name)]);
// Backdrops a glass panel can sit on: plain page, each glow at its peak, and all glows stacked (worst case).
const backdrops = [['page', bg], ...glows.map(([name, glow]) => [name, over(glow, bg)]), ['all glows', glows.reduce((acc, [, glow]) => over(glow, acc), bg)]];
const [gr, gg, gb] = tokens.glass.split(/\s+/).map(Number);
const tints = ['tint-1', 'tint-2', 'tint-3'].map((name) => [name, Number(tokens[name])]);
for (const [name, alpha] of tints) if (!(alpha >= 0.08 && alpha <= 0.16)) throw new Error(`--${name} must stay within 8–16%, got ${alpha}`);

const surfaces = [
  ...backdrops.map(([name, value]) => [`${name}`, value]),
  ...backdrops.flatMap(([name, value]) => tints.map(([tint, alpha]) => [`${name} + glass ${Math.round(alpha * 100)}%`, over({ r: gr, g: gg, b: gb, a: alpha }, value)])),
  ['solid surface', token('surface-solid')],
];
// Coloured fills under text inside a base panel (selected chips, award glows, drop zone) add at most 8%,
// so the total tint under text never exceeds 16%.
const OVERLAY = 0.08;
const basePanels = surfaces.filter(([name]) => name.endsWith(`glass ${Math.round(Number(tokens['tint-1']) * 100)}%`));
for (const tone of ['accent', 'danger', 'warning', 'positive']) {
  const fill = { ...token(tone), a: OVERLAY };
  for (const [name, value] of basePanels) surfaces.push([`${name} + ${tone} ${OVERLAY * 100}%`, over(fill, value)]);
}
const texts = ['text', 'text-2', 'muted', 'accent', 'positive', 'warning', 'danger', 'team-a', 'team-b'];
const pairs = [['on-accent', 'accent'], ['on-accent', 'team-a'], ['on-accent', 'team-b']];

let failures = 0;
const rows = [];
for (const name of texts) {
  const fg = token(name);
  let worst = { value: Infinity, surface: '' };
  for (const [surface, value] of surfaces) {
    const result = ratio(fg, value);
    if (result < worst.value) worst = { value: result, surface: `${surface} (${hex(value)})` };
    if (result < MIN) { failures++; console.error(`FAIL --${name} ${tokens[name]} on ${surface} ${hex(value)}: ${result.toFixed(2)}:1`); }
  }
  rows.push([`--${name}`, worst.value, worst.surface]);
}
for (const [fgName, bgName] of pairs) {
  const result = ratio(token(fgName), token(bgName));
  if (result < MIN) { failures++; console.error(`FAIL --${fgName} on --${bgName}: ${result.toFixed(2)}:1`); }
  rows.push([`--${fgName} on --${bgName}`, result, tokens[bgName]]);
}
console.log(`Contrast check · ${surfaces.length} surfaces · minimum ${MIN}:1`);
for (const [name, value, surface] of rows) console.log(`${value >= MIN ? 'ok  ' : 'FAIL'} ${name.padEnd(24)} worst ${value.toFixed(2)}:1  on ${surface}`);
if (failures) { console.error(`${failures} pair(s) below ${MIN}:1`); process.exit(1); }
