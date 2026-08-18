import type { Album, Facet, PagedResult, PlaylistDetail, PlaylistSummary, Track } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json() as Promise<T>;
}

async function sendJson(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
  }
}

export interface TrackQuery {
  search?: string;
  artist?: string;
  album?: string;
  genre?: string;
  page?: number;
  pageSize?: number;
}

export function fetchTracks(query: TrackQuery = {}): Promise<PagedResult<Track>> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.artist) params.set('artist', query.artist);
  if (query.album) params.set('album', query.album);
  if (query.genre) params.set('genre', query.genre);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 100));
  return getJson(`/api/tracks?${params.toString()}`);
}

export function fetchArtists(): Promise<Facet[]> {
  return getJson('/api/artists');
}

export function fetchGenres(): Promise<Facet[]> {
  return getJson('/api/genres');
}

export function fetchAlbums(): Promise<Album[]> {
  return getJson('/api/albums');
}

export function triggerScan(): Promise<unknown> {
  return fetch('/api/library/scan', { method: 'POST' }).then((res) => {
    if (!res.ok) throw new Error('Scan failed');
    return res.json();
  });
}

export function fetchPlaylists(): Promise<PlaylistSummary[]> {
  return getJson('/api/playlists');
}

export function fetchPlaylistDetail(id: number): Promise<PlaylistDetail> {
  return getJson(`/api/playlists/${id}`);
}

export function createPlaylist(name: string): Promise<PlaylistSummary> {
  return fetch('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then((res) => {
    if (!res.ok) throw new Error('Failed to create playlist');
    return res.json();
  });
}

export function renamePlaylist(id: number, name: string): Promise<void> {
  return sendJson(`/api/playlists/${id}`, 'PUT', { name });
}

export function deletePlaylist(id: number): Promise<void> {
  return sendJson(`/api/playlists/${id}`, 'DELETE');
}

export function addTrackToPlaylist(playlistId: number, trackId: number): Promise<void> {
  return sendJson(`/api/playlists/${playlistId}/tracks`, 'POST', { trackId });
}

export function removeTrackFromPlaylist(playlistId: number, trackId: number): Promise<void> {
  return sendJson(`/api/playlists/${playlistId}/tracks/${trackId}`, 'DELETE');
}

export function reorderPlaylist(playlistId: number, trackIds: number[]): Promise<void> {
  return sendJson(`/api/playlists/${playlistId}/reorder`, 'PUT', { trackIds });
}

export function setTrackRating(trackId: number, rating: number): Promise<void> {
  return sendJson(`/api/tracks/${trackId}/rating`, 'PUT', { rating });
}

export function streamUrl(trackId: number): string {
  return `/api/tracks/${trackId}/stream`;
}

export function artworkUrl(trackId: number): string {
  return `/api/tracks/${trackId}/artwork`;
}
