import type { MuseumData, MuseumSummary } from './types';

/** Client de l'API REST du serveur Node (même origine ; proxy Vite en développement). */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* corps non JSON */
    }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return (await res.json()) as T;
}

/** Le musée publié ne contient jamais les identifiants de publication. */
function publicCopy(data: MuseumData): Omit<MuseumData, 'remote'> {
  const { remote: _remote, ...rest } = data;
  return rest;
}

export async function listMuseums(sort: 'recent' | 'popular', limit = 24): Promise<MuseumSummary[]> {
  return json(await fetch(`/api/museums?sort=${sort}&limit=${limit}`));
}

export async function getMuseum(id: string): Promise<{ museum: unknown; meta: MuseumSummary }> {
  return json(await fetch(`/api/museums/${encodeURIComponent(id)}`));
}

export async function publishMuseum(data: MuseumData, thumbnail: string): Promise<{ id: string; token: string }> {
  return json(
    await fetch('/api/museums', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ museum: publicCopy(data), thumbnail }),
    }),
  );
}

export async function updateMuseum(data: MuseumData, thumbnail: string): Promise<{ id: string }> {
  const r = data.remote!;
  return json(
    await fetch(`/api/museums/${encodeURIComponent(r.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-edit-token': r.token },
      body: JSON.stringify({ museum: publicCopy(data), thumbnail }),
    }),
  );
}

export async function likeMuseum(id: string): Promise<{ likes: number }> {
  return json(await fetch(`/api/museums/${encodeURIComponent(id)}/like`, { method: 'POST' }));
}

export const thumbUrl = (id: string) => `/api/museums/${encodeURIComponent(id)}/thumb`;
