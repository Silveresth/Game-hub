// Télécharge les visuels du catalogue depuis Wikimedia Commons (domaine public uniquement).
// Usage : node tools/fetch-art.mjs        → public/art/<id>.jpg + public/art/credits.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync('src/shared/catalog.json', 'utf8'));
const UA = 'StealAMasterpiece-asset-script/0.1 (dev build tool)';
const API = 'https://commons.wikimedia.org/w/api.php';
const CREDITS = 'public/art/credits.json';
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}?${params}`, { headers: { 'user-agent': UA } });
    const text = await res.text();
    if (res.ok && text.startsWith('{')) return JSON.parse(text);
    console.log('  … limite de l’API, nouvel essai dans', 10 * (attempt + 1), 's');
    await sleep(10000 * (attempt + 1));
  }
  throw new Error('API Wikimedia indisponible');
}

async function find(query) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '5',
    prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '640', origin: '*',
  });
  const data = await api(params);
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !/jpeg|png/.test(info.mime)) continue;
    const license = info.extmetadata?.LicenseShortName?.value ?? '';
    if (!/public domain|PD|CC0/i.test(license)) continue;
    return { title: p.title, thumb: info.thumburl, page: info.descriptionurl, license };
  }
  return null;
}

for (const work of catalog.works) {
  if (credits[work.id] && existsSync(`public/art/${work.id}.jpg`) && !process.argv.includes('--force')) continue;
  const hit = await find(work.query);
  if (!hit) {
    console.log('✗', work.id, '— aucun fichier du domaine public trouvé pour', work.query);
    continue;
  }
  const img = await fetch(hit.thumb, { headers: { 'user-agent': UA } });
  writeFileSync(`public/art/${work.id}.jpg`, Buffer.from(await img.arrayBuffer()));
  credits[work.id] = { file: hit.title, source: hit.page, license: hit.license };
  writeFileSync(CREDITS, JSON.stringify(credits, null, 2)); // écrit à chaque œuvre : reprise possible
  console.log('✓', work.id.padEnd(14), hit.license.padEnd(16), hit.title);
  await sleep(1500); // courtoisie envers l'API
}
