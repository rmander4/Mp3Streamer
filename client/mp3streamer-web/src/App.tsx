import { useCallback, useEffect, useState } from 'react';
import { Sidebar, type ViewKey } from './components/Sidebar';
import { SearchBar } from './components/SearchBar';
import { TrackList } from './components/TrackList';
import { AlbumGrid } from './components/AlbumGrid';
import { FacetList } from './components/FacetList';
import { PlaylistPanel } from './components/PlaylistPanel';
import { HistoryPanel } from './components/HistoryPanel';
import {
  addTrackToPlaylist,
  fetchAlbums,
  fetchArtists,
  fetchGenres,
  fetchPlaylists,
  fetchTracks,
  setTrackRating,
} from './api/client';
import type { Album, Facet, PlaylistSummary, Track } from './api/types';
import { usePlayer } from './player/PlayerContext';
import { NowPlayingBar } from './player/NowPlayingBar';
import { ResumePrompt } from './player/ResumePrompt';
import './App.css';

interface DrillDown {
  kind: 'album' | 'genre';
  value: string;
  // Only meaningful for kind === 'album' — disambiguates same-named albums
  // by different artists (e.g. two unrelated bands both with an "Onward").
  artist?: string | null;
}

const SAVED_VIEW_KEY = 'mp3streamer.view';
const VIEW_KEYS: ViewKey[] = ['all', 'artists', 'albums', 'genres', 'playlists', 'history'];

function getSavedView(): ViewKey {
  const saved = localStorage.getItem(SAVED_VIEW_KEY);
  return saved && VIEW_KEYS.includes(saved as ViewKey) ? (saved as ViewKey) : 'all';
}

function App() {
  const [view, setView] = useState<ViewKey>(getSavedView);
  const [search, setSearch] = useState('');
  const [sectionSearch, setSectionSearch] = useState('');
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  // Selecting an artist from the Artists tab jumps to Albums filtered to
  // just that artist's albums, rather than straight to a track list — set
  // alongside `view`, cleared whenever navigating away via the sidebar or
  // via its own "Back to artists" breadcrumb.
  const [albumsArtistFilter, setAlbumsArtistFilter] = useState<string | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<Facet[]>([]);
  const [genres, setGenres] = useState<Facet[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumPageSize, setAlbumPageSize] = useState(50);
  const [albumPage, setAlbumPage] = useState(1);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectView = useCallback((next: ViewKey) => {
    setView(next);
    localStorage.setItem(SAVED_VIEW_KEY, next);
    setDrillDown(null);
    setAlbumsArtistFilter(null);
    setSearch('');
    setSectionSearch('');
    fetchPlaylists().then(setPlaylists);
  }, []);

  useEffect(() => {
    fetchPlaylists().then(setPlaylists);
  }, []);

  useEffect(() => {
    setError(null);
    if (view === 'artists' && !drillDown) {
      fetchArtists().then(setArtists).catch((e) => setError(String(e)));
    } else if (view === 'genres' && !drillDown) {
      fetchGenres().then(setGenres).catch((e) => setError(String(e)));
    } else if (view === 'albums' && !drillDown) {
      fetchAlbums().then(setAlbums).catch((e) => setError(String(e)));
    }
  }, [view, drillDown]);

  useEffect(() => {
    setAlbumPage(1);
  }, [sectionSearch]);

  useEffect(() => {
    const showTrackList = view === 'all' || drillDown !== null;
    if (!showTrackList) return;

    // Cancels the previous in-flight search whenever a new one starts —
    // without this, a slow search (large libraries especially: the
    // %term% pattern can't use an index, so it's a full table scan) can
    // resolve *after* a more recent one, repeatedly overwriting fresh
    // results with stale ones and flickering the loading state on/off as
    // each request independently finishes. Ryan's small library resolves
    // fast enough that the race window is basically never hit; on his
    // brother's ~285k-track library it reproduced every time (2026-08-24).
    const controller = new AbortController();

    setLoading(true);
    setError(null);
    fetchTracks(
      {
        search: search || undefined,
        album: drillDown?.kind === 'album' ? drillDown.value : undefined,
        albumArtist: drillDown?.kind === 'album' ? (drillDown.artist ?? undefined) : undefined,
        genre: drillDown?.kind === 'genre' ? drillDown.value : undefined,
      },
      controller.signal,
    )
      .then((result) => setTracks(result.items))
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [view, drillDown, search]);

  const { playQueue, currentTrack, setCurrentTrackRating, setCurrentTrackFields } = usePlayer();

  const handlePlay = useCallback(
    (queue: Track[], index: number) => {
      playQueue(queue, index);
    },
    [playQueue],
  );

  const handleRate = useCallback(
    (track: Track, rating: number) => {
      setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, rating } : t)));
      if (currentTrack?.id === track.id) {
        setCurrentTrackRating(rating);
      }
      setTrackRating(track.id, rating).catch((err) => {
        console.error('Failed to save rating', err);
      });
    },
    [currentTrack, setCurrentTrackRating],
  );

  const handleTagsUpdated = useCallback(
    (updated: Track) => {
      setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (currentTrack?.id === updated.id) {
        setCurrentTrackFields(updated);
      }
    },
    [currentTrack, setCurrentTrackFields],
  );

  const handleBulkTagsUpdated = useCallback(
    (updated: Track[]) => {
      const byId = new Map(updated.map((t) => [t.id, t]));
      setTracks((prev) => prev.map((t) => byId.get(t.id) ?? t));
      if (currentTrack && byId.has(currentTrack.id)) {
        setCurrentTrackFields(byId.get(currentTrack.id)!);
      }
    },
    [currentTrack, setCurrentTrackFields],
  );

  const handleAddToPlaylist = useCallback((trackId: number, playlistId: number) => {
    if (!playlistId) return;
    addTrackToPlaylist(playlistId, trackId).then(() => fetchPlaylists().then(setPlaylists));
  }, []);

  const filteredAlbums = albums
    .filter((album) => !albumsArtistFilter || album.artist === albumsArtistFilter)
    .filter((album) => `${album.album} ${album.artist ?? ''}`.toLowerCase().includes(sectionSearch.toLowerCase()));
  const albumPageCount = albumPageSize === 0 ? 1 : Math.max(1, Math.ceil(filteredAlbums.length / albumPageSize));
  const visibleAlbums = albumPageSize === 0
    ? filteredAlbums
    : filteredAlbums.slice((albumPage - 1) * albumPageSize, albumPage * albumPageSize);

  const renderContent = () => {
    if (error) {
      return <p className="error-state">{error}</p>;
    }

    if (view === 'artists' && !drillDown) {
      const filteredArtists = artists.filter((artist) => artist.name.toLowerCase().includes(sectionSearch.toLowerCase()));
      return (
        <FacetList
          facets={filteredArtists}
          onSelect={(name) => {
            setAlbumsArtistFilter(name);
            setView('albums');
          }}
          onSelectAlbum={(album, artist) => {
            setView('albums');
            setDrillDown({ kind: 'album', value: album, artist });
          }}
        />
      );
    }
    if (view === 'genres' && !drillDown) {
      const filteredGenres = genres.filter((genre) => genre.name.toLowerCase().includes(sectionSearch.toLowerCase()));
      return <FacetList facets={filteredGenres} onSelect={(name) => setDrillDown({ kind: 'genre', value: name })} />;
    }
    if (view === 'albums' && !drillDown) {
      return (
        <AlbumGrid
          albums={visibleAlbums}
          onSelect={(album) => setDrillDown({ kind: 'album', value: album.album, artist: album.artist })}
          onTracksEdited={() => fetchAlbums().then(setAlbums).catch((e) => setError(String(e)))}
        />
      );
    }
    if (view === 'playlists') {
      return <PlaylistPanel search={sectionSearch} onSearch={setSectionSearch} />;
    }
    if (view === 'history') {
      return <HistoryPanel />;
    }

    return (
      <>
        {loading ? <p className="loading-state">Loading...</p> : null}
        <TrackList
          tracks={tracks}
          onPlay={handlePlay}
          onRate={handleRate}
          onTagsUpdated={handleTagsUpdated}
          onBulkTagsUpdated={handleBulkTagsUpdated}
          activeTrackId={currentTrack?.id}
          renderRowActions={
            playlists.length > 0
              ? (track) => (
                  <select
                    value=""
                    onChange={(e) => handleAddToPlaylist(track.id, Number(e.target.value))}
                    aria-label={`Add ${track.title} to playlist`}
                  >
                    <option value="" disabled>
                      Add to playlist...
                    </option>
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )
              : undefined
          }
        />
      </>
    );
  };

  return (
    <div className="app-shell">
      <div className={`body-row${currentTrack ? ' has-now-playing' : ''}`}>
        <Sidebar active={view} onSelect={handleSelectView} />
        <main className="main-content">
          <div className="content-header">
            {drillDown ? (
              <button className="back-link" onClick={() => setDrillDown(null)}>
                &larr; Back to {albumsArtistFilter ?? view}
              </button>
            ) : albumsArtistFilter ? (
              <button
                className="back-link"
                onClick={() => {
                  setAlbumsArtistFilter(null);
                  setView('artists');
                }}
              >
                &larr; Back to artists
              </button>
            ) : null}
            {view === 'all' || drillDown ? <SearchBar onSearch={setSearch} /> : null}
            {view !== 'all' && !drillDown && view !== 'playlists' && view !== 'history' ? (
              <div className="section-search-row">
                <SearchBar onSearch={setSectionSearch} placeholder={`Search ${view}...`} />
                {sectionSearch.trim() ? (
                  <span className="search-match-count">
                    {view === 'artists'
                      ? artists.filter((artist) => artist.name.toLowerCase().includes(sectionSearch.toLowerCase())).length
                      : view === 'albums'
                        ? filteredAlbums.length
                        : genres.filter((genre) => genre.name.toLowerCase().includes(sectionSearch.toLowerCase())).length}{' '}
                    matches
                  </span>
                ) : null}
                {view === 'albums' ? (
                  <>
                    <label className="album-page-size">
                      <span>Show</span>
                      <select
                        value={albumPageSize}
                        onChange={(event) => {
                          setAlbumPageSize(Number(event.target.value));
                          setAlbumPage(1);
                        }}
                        aria-label="Albums per page"
                      >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={0}>All</option>
                      </select>
                    </label>
                    {albumPageSize !== 0 ? (
                      <>
                        <button className="page-button" onClick={() => setAlbumPage((page) => Math.max(1, page - 1))} disabled={albumPage === 1} aria-label="Previous album page">
                          &larr;
                        </button>
                        <span className="page-status">{albumPage} / {albumPageCount}</span>
                        <button className="page-button" onClick={() => setAlbumPage((page) => Math.min(albumPageCount, page + 1))} disabled={albumPage === albumPageCount} aria-label="Next album page">
                          &rarr;
                        </button>
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {renderContent()}
        </main>
      </div>
      <NowPlayingBar />
      <ResumePrompt />
    </div>
  );
}

export default App;
