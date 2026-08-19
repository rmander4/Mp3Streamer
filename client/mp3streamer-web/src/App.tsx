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
import './App.css';

interface DrillDown {
  kind: 'artist' | 'album' | 'genre';
  value: string;
}

function App() {
  const [view, setView] = useState<ViewKey>('all');
  const [search, setSearch] = useState('');
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<Facet[]>([]);
  const [genres, setGenres] = useState<Facet[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectView = useCallback((next: ViewKey) => {
    setView(next);
    setDrillDown(null);
    setSearch('');
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
    const showTrackList = view === 'all' || drillDown !== null;
    if (!showTrackList) return;

    setLoading(true);
    setError(null);
    fetchTracks({
      search: search || undefined,
      artist: drillDown?.kind === 'artist' ? drillDown.value : undefined,
      album: drillDown?.kind === 'album' ? drillDown.value : undefined,
      genre: drillDown?.kind === 'genre' ? drillDown.value : undefined,
    })
      .then((result) => setTracks(result.items))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
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

  const renderContent = () => {
    if (error) {
      return <p className="error-state">{error}</p>;
    }

    if (view === 'artists' && !drillDown) {
      return <FacetList facets={artists} onSelect={(name) => setDrillDown({ kind: 'artist', value: name })} />;
    }
    if (view === 'genres' && !drillDown) {
      return <FacetList facets={genres} onSelect={(name) => setDrillDown({ kind: 'genre', value: name })} />;
    }
    if (view === 'albums' && !drillDown) {
      return <AlbumGrid albums={albums} onSelect={(album) => setDrillDown({ kind: 'album', value: album.album })} />;
    }
    if (view === 'playlists') {
      return <PlaylistPanel />;
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
      <div className="body-row">
        <Sidebar active={view} onSelect={handleSelectView} />
        <main className="main-content">
          <div className="content-header">
            {drillDown ? (
              <button className="back-link" onClick={() => setDrillDown(null)}>
                &larr; Back to {view}
              </button>
            ) : null}
            {view === 'all' || drillDown ? <SearchBar onSearch={setSearch} /> : null}
          </div>
          {renderContent()}
        </main>
      </div>
      <NowPlayingBar />
    </div>
  );
}

export default App;
