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

export interface AlbumArt {
  trackId: number;
  album: string;
}

export interface Facet {
  name: string;
  trackCount: number;
  // Only populated for artists — up to 4 sample (track id, album name)
  // pairs used to render a small cascaded album-art stack, each clickable
  // through to that album and hoverable for a tooltip. Absent for genres.
  albumArt?: AlbumArt[];
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

export interface PlaybackState {
  track: Track;
  positionSeconds: number;
}

export interface ArtworkSearchResult {
  artworkUrl: string;
  artistName: string;
  collectionName: string;
}
