// Simulation d'équilibrage : un joueur « raisonnable » joue en continu, on mesure quand il atteint chaque étape.
// Usage : node tools/simulate.mjs [minutes=180] [parties=200]
import { readFileSync } from 'node:fs';

const cat = JSON.parse(readFileSync('src/shared/catalog.json', 'utf8'));
const MINUTES = Number(process.argv[2] ?? 180);
const RUNS = Number(process.argv[3] ?? 200);
const pool = Object.entries(cat.rarities).filter(([, r]) => r.convoyWeight > 0);
const total = pool.reduce((s, [, r]) => s + r.convoyWeight, 0);
const rate = cat.incomeRate;

function convoyItem() {
  let roll = Math.random() * total;
  let rarity = pool[0][0];
  for (const [id, r] of pool) { roll -= r.convoyWeight; if (roll < 0) { rarity = id; break; } }
  const works = cat.works.filter((w) => w.rarity === rarity && !w.unique);
  const w = works[Math.floor(Math.random() * works.length)];
  const f = Math.random();
  const mult = f < cat.frames.diamant.chance ? 5 : f < cat.frames.diamant.chance + cat.frames.dore.chance ? 2 : 1;
  return { value: w.price * mult, rarity, rate: cat.rarities[rarity].incomeRate ?? rate };
}

function run() {
  let coins = cat.startCoins ?? 300, level = 1;
  const shown = []; // valeurs exposées
  const marks = {};
  const mark = (k, t) => { if (marks[k] === undefined) marks[k] = t; };
  for (let t = 0; t < MINUTES * 60; t += 20) {
    // revenu de la fenêtre de 20 s (le joueur encaisse au fil de l'eau)
    coins += shown.reduce((s, v) => s + v.value * v.rate, 0) * 20;
    const slots = cat.levels[level - 1].slots;
    const item = convoyItem();
    // achète si une place est libre, ou remplace la moins chère si l'œuvre vaut au moins 3× plus
    if (coins >= item.value) {
      if (shown.length < slots) { coins -= item.value; shown.push(item); }
      else {
        const minV = Math.min(...shown.map((s) => s.value)); const minI = shown.findIndex((s) => s.value === minV);
        if (item.value >= minV * 3) { coins -= item.value; coins += minV * 0.5; shown[minI] = item; }
      }
      if (item.rarity !== 'commun') mark('1re œuvre rare+', t);
    }
    const next = cat.levels[level];
    // agrandit quand le musée est plein et qu'il reste de quoi acheter ensuite
    if (next && shown.length >= slots && coins >= next.cost) { coins -= next.cost; level++; mark(`niveau ${level}`, t); }
    const value = shown.reduce((s, v) => s + v.value, 0);
    for (const v of [1e4, 1e5, 1e6, 1e7]) if (value >= v) mark(`valeur ${v.toLocaleString('fr-FR')}`, t);
    if (shown.length >= 4) mark('4 œuvres exposées', t);
  }
  return marks;
}

const all = Array.from({ length: RUNS }, run);
const keys = [...new Set(all.flatMap((m) => Object.keys(m)))];
const order = (k) => Math.min(...all.map((m) => m[k] ?? Infinity));
keys.sort((a, b) => order(a) - order(b));
const fmt = (s) => (s === undefined ? '—' : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
console.log(`Simulation : ${RUNS} parties de ${MINUTES} min de jeu actif\n`);
console.log('Étape'.padEnd(26), 'médiane'.padStart(9), 'atteinte');
for (const k of keys) {
  const ts = all.map((m) => m[k]).filter((x) => x !== undefined).sort((a, b) => a - b);
  console.log(k.padEnd(26), fmt(ts[Math.floor(ts.length / 2)]).padStart(9), `${Math.round((ts.length / RUNS) * 100)} %`);
}
