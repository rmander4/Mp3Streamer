import type { Album, Facet, PagedResult, PlaybackState, PlayHistoryEntry, PlaylistDetail, PlaylistSummary, Track } from './types';

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

export interface UpdateTagsRequest {
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  trackNumber: number | null;
  year: number | null;
}

export async function updateTrackTags(trackId: number, request: UpdateTagsRequest): Promise<Track> {
  const res = await fetch(`/api/tracks/${trackId}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface BulkUpdateTagsRequest {
  trackIds: number[];
  setArtist: boolean;
  artist: string | null;
  setAlbum: boolean;
  album: string | null;
  setGenre: boolean;
  genre: string | null;
  setYear: boolean;
  year: number | null;
}

export async function updateTracksBulkTags(request: BulkUpdateTagsRequest): Promise<Track[]> {
  const res = await fetch('/api/tracks/bulk-tags', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function streamUrl(trackId: number): string {
  return `/api/tracks/${trackId}/stream`;
}

export function downloadUrl(trackId: number): string {
  return `/api/tracks/${trackId}/download`;
}

export function artworkUrl(trackId: number): string {
  return `/api/tracks/${trackId}/artwork`;
}

export function recordPlay(trackId: number): Promise<void> {
  return fetch(`/api/tracks/${trackId}/play`, { method: 'POST' }).then((res) => {
    if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  });
}

export async function getHistoryEnabled(): Promise<boolean> {
  const data = await getJson<{ enabled: boolean }>('/api/settings/history-enabled');
  return data.enabled;
}

export function setHistoryEnabled(enabled: boolean): Promise<void> {
  return sendJson('/api/settings/history-enabled', 'PUT', { enabled });
}

export function fetchHistory(): Promise<PlayHistoryEntry[]> {
  return getJson('/api/history');
}

export function clearHistory(): Promise<void> {
  return sendJson('/api/history', 'DELETE');
}

export async function getRemoveMissingTracks(): Promise<boolean> {
  const data = await getJson<{ enabled: boolean }>('/api/settings/remove-missing-tracks');
  return data.enabled;
}

export function setRemoveMissingTracks(enabled: boolean): Promise<void> {
  return sendJson('/api/settings/remove-missing-tracks', 'PUT', { enabled });
}

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  totalFilesFound: number;
}

// Manual on-demand rescan — the watcher normally catches library changes
// automatically, but its FileSystemWatcher can silently drop events during
// a large bulk change (its internal OS buffer can overflow), so this is a
// user-facing fallback rather than something that should be needed often.
export async function scanLibrary(): Promise<ScanResult> {
  const res = await fetch('/api/library/scan', { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// 404 means "nothing saved" — an expected, common case (most sessions never
// pause mid-track), not an error condition worth throwing over.
export async function fetchPlaybackState(): Promise<PlaybackState | null> {
  const res = await fetch('/api/playback-state');
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function savePlaybackState(trackId: number, positionSeconds: number): Promise<void> {
  return sendJson('/api/playback-state', 'PUT', { trackId, positionSeconds });
}

export function clearPlaybackState(): Promise<void> {
  return sendJson('/api/playback-state', 'DELETE');
}
