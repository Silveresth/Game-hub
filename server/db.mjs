/**
 * Persistance du serveur.
 *
 * - Sans DATABASE_URL : fichiers JSON dans server/data (un fichier par joueur, plus sales.json, visitors.json, vapid.json),
 *   écrits de façon atomique (fichier .tmp puis rename). Il faut alors un disque persistant.
 * - Avec DATABASE_URL (PostgreSQL, par exemple Neon) : TOUT l'état durable est en base, le serveur n'a besoin d'aucun disque :
 *     table `players` (un joueur par ligne, JSONB) et table `kv` (ventes aux enchères, clés des notifications, visiteurs).
 *   Au premier démarrage sur une base vide, les fichiers JSON présents sont importés automatiquement (migration).
 *
 * Quartiers et enchères en cours vivent en mémoire : une seule instance du serveur à la fois, même avec PostgreSQL.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createDatabase({ dataDir }) {
  const dir = join(dataDir, 'players');
  await mkdir(dir, { recursive: true });

  const url = process.env.DATABASE_URL || '';
  let pg = null;

  if (url) {
    try {
      const { default: pgLib } = await import('pg');
      pg = new pgLib.Pool({
        connectionString: url,
        max: 5,
        // Neon met la base en veille quand elle ne sert pas : le premier accès peut prendre une ou deux secondes
        connectionTimeoutMillis: 15_000,
        idleTimeoutMillis: 30_000,
      });
      pg.on('error', (e) => console.error('PostgreSQL (connexion inactive) :', e.message));
      await pg.query(`
        CREATE TABLE IF NOT EXISTS players (
          id VARCHAR(64) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS kv (
          key VARCHAR(64) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      console.log('📦 PostgreSQL connecté : joueurs, ventes, clés push et visiteurs sont enregistrés en base.');
    } catch (e) {
      // base configurée mais injoignable : on refuse de démarrer plutôt que de perdre des données dans un disque éphémère
      throw new Error(`DATABASE_URL est défini mais PostgreSQL est injoignable : ${e.message}`);
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️ Pas de DATABASE_URL : données dans server/data. Sans disque persistant, elles seront perdues au prochain déploiement.');
  }

  // ---------------------------------------------------------------- fichiers JSON (secours, et source de la migration)

  async function writeAtomic(file, text) {
    await writeFile(file + '.tmp', text);
    await rename(file + '.tmp', file);
  }

  async function readJsonFile(file) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  async function readPlayerFiles(migrateFn) {
    const players = new Map();
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(await readFile(join(dir, f), 'utf8'));
        players.set(p.id, migrateFn(p));
      } catch (e) {
        console.error(`Sauvegarde illisible ignorée (${f}) :`, e.message);
      }
    }
    return players;
  }

  // ---------------------------------------------------------------- joueurs

  /**
   * Charge tous les joueurs. Avec PostgreSQL : la base fait foi ; si elle est vide et que des fichiers JSON existent,
   * ils sont importés (une seule fois).
   * @param {(p: any) => any} migrateFn
   */
  async function loadAllPlayers(migrateFn) {
    if (!pg) return readPlayerFiles(migrateFn);
    const { rows } = await pg.query('SELECT id, data FROM players');
    if (!rows.length) {
      const files = await readPlayerFiles(migrateFn);
      if (files.size) {
        console.log(`📦 Migration : ${files.size} joueur(s) des fichiers JSON vers PostgreSQL…`);
        for (const [id, p] of files) await savePlayer(id, p);
      }
      return files;
    }
    const players = new Map();
    for (const row of rows) {
      try {
        players.set(row.id, migrateFn(row.data));
      } catch (e) {
        console.error(`Joueur ${row.id} illisible dans PostgreSQL :`, e.message);
      }
    }
    console.log(`📦 ${players.size} joueur(s) chargé(s) depuis PostgreSQL.`);
    return players;
  }

  /** Enregistre un joueur (en base si configurée, sinon en fichier). */
  async function savePlayer(id, player) {
    try {
      if (pg) {
        await pg.query(
          `INSERT INTO players (id, data, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [id, player],
        );
      } else {
        await writeAtomic(join(dir, `${id}.json`), JSON.stringify(player));
      }
    } catch (e) {
      console.error(`Erreur d'enregistrement du joueur ${id} :`, e.message);
    }
  }

  // ---------------------------------------------------------------- petites valeurs (ventes, clés push, visiteurs)

  /**
   * Valeur enregistrée sous `key` (ou undefined). Sans base : fichier `<dataDir>/<key>.json` (mêmes fichiers qu'avant).
   * Avec base : table kv, et import du fichier s'il existe encore (migration).
   */
  async function kvGet(key) {
    const file = join(dataDir, `${key}.json`);
    if (!pg) return readJsonFile(file);
    const { rows } = await pg.query('SELECT value FROM kv WHERE key = $1', [key]);
    if (rows.length) return rows[0].value;
    const legacy = await readJsonFile(file);
    if (legacy !== undefined) {
      console.log(`📦 Migration : ${key}.json vers PostgreSQL`);
      await kvSet(key, legacy);
    }
    return legacy;
  }

  async function kvSet(key, value) {
    if (pg) {
      await pg.query(
        `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)],
      );
    } else {
      await writeAtomic(join(dataDir, `${key}.json`), JSON.stringify(value));
    }
  }

  return {
    loadAllPlayers,
    savePlayer,
    kvGet,
    kvSet,
    isPostgres: () => !!pg,
    close: () => pg?.end(),
  };
}
