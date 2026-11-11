/**
 * Couche d'abstraction de persistance (JSON / PostgreSQL / Redis).
 * 
 * - Par défaut (mode standard sans configuration externe) :
 *   Persistance hybride ultra-rapide en mémoire + fichiers JSON atomiques (fs).
 * - Si DATABASE_URL est défini (ex: postgresql://user:pass@host:5432/dbname) :
 *   Stockage et synchronisation PostgreSQL automatique avec table `players`.
 * - Si REDIS_URL est défini (ex: redis://localhost:6379) :
 *   Mise en cache / réplication Redis pour haute disponibilité et scalabilité multi-instances.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createDatabase({ dataDir, devMode = false }) {
  const dir = join(dataDir, 'players');
  await mkdir(dir, { recursive: true });

  const postgresUrl = process.env.DATABASE_URL || '';
  const redisUrl = process.env.REDIS_URL || '';

  let pgClient = null;
  let redisClient = null;

  if (postgresUrl) {
    try {
      // Import dynamique de 'pg' si disponible dans l'environnement
      const { Pool } = await import('pg');
      pgClient = new Pool({ connectionString: postgresUrl });
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS players (
          id VARCHAR(64) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_players_updated_at ON players(updated_at);
      `);
      console.log('📦 Persistance PostgreSQL connectée et initialisée.');
    } catch (e) {
      console.warn('⚠️ Connexion PostgreSQL impossible (le pilote "pg" est-il installé ?) : repli sur JSON local.', e.message);
      pgClient = null;
    }
  }

  if (redisUrl) {
    try {
      const { createClient } = await import('redis');
      redisClient = createClient({ url: redisUrl });
      await redisClient.connect();
      console.log('⚡ Cache Redis connecté et initialisé.');
    } catch (e) {
      console.warn('⚠️ Connexion Redis impossible (le pilote "redis" est-il installé ?) : repli en mémoire locale.', e.message);
      redisClient = null;
    }
  }

  /**
   * Charge tous les joueurs depuis la base (PostgreSQL ou fichiers JSON).
   * @param {(p: any) => any} migrateFn
   * @returns {Promise<Map<string, any>>}
   */
  async function loadAllPlayers(migrateFn) {
    const players = new Map();

    if (pgClient) {
      try {
        const { rows } = await pgClient.query('SELECT id, data FROM players');
        for (const row of rows) {
          try {
            players.set(row.id, migrateFn(row.data));
          } catch {}
        }
        console.log(`📦 ${players.size} joueur(s) chargé(s) depuis PostgreSQL.`);
        return players;
      } catch (e) {
        console.error('Erreur lecture PostgreSQL :', e.message);
      }
    }

    // Chargement depuis les fichiers JSON locaux
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const p = JSON.parse(await readFile(join(dir, f), 'utf8'));
        players.set(p.id, migrateFn(p));
      } catch {
        /* fichier corrompu ou incomplet : ignoré */
      }
    }
    return players;
  }

  /**
   * Sauvegarde un joueur (dans PostgreSQL, Redis, et en JSON atomique).
   * @param {string} id
   * @param {any} player
   */
  async function savePlayer(id, player) {
    const jsonStr = JSON.stringify(player);

    // 1. Sauvegarde fichier atomique local (toujours actif pour garantie de résilience)
    try {
      const file = join(dir, `${id}.json`);
      await writeFile(file + '.tmp', jsonStr);
      await rename(file + '.tmp', file);
    } catch (e) {
      console.error(`Erreur écriture fichier ${id} :`, e.message);
    }

    // 2. Sauvegarde PostgreSQL si configuré
    if (pgClient) {
      try {
        await pgClient.query(
          `INSERT INTO players (id, data, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [id, player],
        );
      } catch (e) {
        console.error(`Erreur sauvegarde PostgreSQL joueur ${id} :`, e.message);
      }
    }

    // 3. Mise à jour cache Redis si configuré
    if (redisClient) {
      try {
        await redisClient.set(`player:${id}`, jsonStr, { EX: 86400 * 7 });
      } catch (e) {
        console.error(`Erreur cache Redis joueur ${id} :`, e.message);
      }
    }
  }

  return {
    loadAllPlayers,
    savePlayer,
    isPostgres: () => !!pgClient,
    isRedis: () => !!redisClient,
  };
}
