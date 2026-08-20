export interface Track {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  trackNumber: number | null;
  year: number | null;
  durationSeconds: number;
  hasEmbeddedArt: boolean;
  rating: number;
  isMissing: boolean;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface Facet {
  name: string;
  trackCount: number;
  // Only populated for artists — up to 4 sample track ids (one per album)
  // used to render a small cascaded album-art stack. Absent for genres.
  albumArtTrackIds?: number[];
}

export interface Album {
  album: string;
  artist: string | null;
  trackCount: number;
  sampleTrackId: number;
}

export interface PlaylistSummary {
  id: number;
  name: string;
  trackCount: number;
}

export interface PlaylistDetail {
  id: number;
  name: string;
  tracks: Track[];
}

export interface PlayHistoryEntry {
  id: number;
  track: Track;
  playedAtUtc: string;
}
