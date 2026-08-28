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
  fetchAlbumArtists,
  fetchAlbums,
  fetchArtists,
  fetchGenres,
  fetchPlaylists,
  fetchTracks,
  setTrackRating,
} from './api/client';
import type { Album, Facet, PagedResult, PlaylistSummary, Track } from './api/types';
import { useInfinitePages } from './hooks/useInfinitePages';
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
const VIEW_KEYS: ViewKey[] = ['all', 'albumArtists', 'artists', 'albums', 'genres', 'playlists', 'history'];

function getSavedView(): ViewKey {
  const saved = localStorage.getItem(SAVED_VIEW_KEY);
  return saved && VIEW_KEYS.includes(saved as ViewKey) ? (saved as ViewKey) : 'all';
}

type AlbumSort = 'name' | 'year';
const SAVED_ALBUM_SORT_KEY = 'mp3streamer.albumSort';

function getSavedAlbumSort(): AlbumSort {
  const saved = localStorage.getItem(SAVED_ALBUM_SORT_KEY);
  return saved === 'year' ? 'year' : 'name';
}

// Every list/grid screen now fetches its data a page at a time (see
// useInfinitePages) instead of loading the entire result set up front —
// necessary once a library reaches the tens of thousands of albums/
// hundreds of thousands of tracks scale, where "fetch everything" would
// mean multi-hundred-thousand-row JSON payloads before anything can even
// render. Each hook below is only ever *actually* hitting the network
// while its own tab is the active view — see each `fetchPage` guard.
const EMPTY_PAGE = <T,>(page: number, pageSize: number): PagedResult<T> => ({ items: [], page, pageSize, totalCount: 0 });

function App() {
  const [view, setView] = useState<ViewKey>(getSavedView);
  const [search, setSearch] = useState('');
  const [sectionSearch, setSectionSearch] = useState('');
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  // Selecting an artist (or album artist) from those tabs jumps to Albums
  // filtered to just that artist's albums, rather than straight to a track
  // list. `albumsFilterSource` remembers which tab it came from, so the
  // breadcrumb can send you back to the right one.
  const [albumsArtistFilter, setAlbumsArtistFilter] = useState<string | null>(null);
  const [albumsFilterSource, setAlbumsFilterSource] = useState<ViewKey | null>(null);

  const [albumSort, setAlbumSort] = useState<AlbumSort>(getSavedAlbumSort);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);

  const handleSelectView = useCallback((next: ViewKey) => {
    setView(next);
    localStorage.setItem(SAVED_VIEW_KEY, next);
    setDrillDown(null);
    setAlbumsArtistFilter(null);
    setAlbumsFilterSource(null);
    setSearch('');
    setSectionSearch('');
    fetchPlaylists().then(setPlaylists);
  }, []);

  useEffect(() => {
    fetchPlaylists().then(setPlaylists);
  }, []);

  const handleAlbumSortChange = (next: AlbumSort) => {
    setAlbumSort(next);
    localStorage.setItem(SAVED_ALBUM_SORT_KEY, next);
  };

  const showTrackList = view === 'all' || drillDown !== null;

  const tracksPages = useInfinitePages<Track>(
    (page, signal) =>
      showTrackList
        ? fetchTracks(
            {
              search: search || undefined,
              album: drillDown?.kind === 'album' ? drillDown.value : undefined,
              albumArtist: drillDown?.kind === 'album' ? (drillDown.artist ?? undefined) : undefined,
              genre: drillDown?.kind === 'genre' ? drillDown.value : undefined,
              page,
              pageSize: 100,
            },
            signal,
          )
        : Promise.resolve(EMPTY_PAGE<Track>(page, 100)),
    [view, drillDown, search],
  );

  const artistsPages = useInfinitePages<Facet>(
    (page, signal) =>
      view === 'artists' && !drillDown
        ? fetchArtists({ search: sectionSearch || undefined, page, pageSize: 100 }, signal)
        : Promise.resolve(EMPTY_PAGE<Facet>(page, 100)),
    [view, drillDown, sectionSearch],
  );

  const albumArtistsPages = useInfinitePages<Facet>(
    (page, signal) =>
      view === 'albumArtists' && !drillDown
        ? fetchAlbumArtists({ search: sectionSearch || undefined, page, pageSize: 100 }, signal)
        : Promise.resolve(EMPTY_PAGE<Facet>(page, 100)),
    [view, drillDown, sectionSearch],
  );

  const genresPages = useInfinitePages<Facet>(
    (page, signal) =>
      view === 'genres' && !drillDown
        ? fetchGenres({ search: sectionSearch || undefined, page, pageSize: 100 }, signal)
        : Promise.resolve(EMPTY_PAGE<Facet>(page, 100)),
    [view, drillDown, sectionSearch],
  );

  const albumsPages = useInfinitePages<Album>(
    (page, signal) =>
      view === 'albums' && !drillDown
        ? fetchAlbums(
            { search: sectionSearch || undefined, artist: albumsArtistFilter ?? undefined, sort: albumSort, page, pageSize: 100 },
            signal,
          )
        : Promise.resolve(EMPTY_PAGE<Album>(page, 100)),
    [view, drillDown, sectionSearch, albumsArtistFilter, albumSort],
  );

  const { playQueue, currentTrack, setCurrentTrackRating, setCurrentTrackFields } = usePlayer();

  const handlePlay = useCallback(
    (queue: Track[], index: number) => {
      playQueue(queue, index);
    },
    [playQueue],
  );

  const handleRate = useCallback(
    (track: Track, rating: number) => {
      tracksPages.updateItems((prev) => prev.map((t) => (t.id === track.id ? { ...t, rating } : t)));
      if (currentTrack?.id === track.id) {
        setCurrentTrackRating(rating);
      }
      setTrackRating(track.id, rating).catch((err) => {
        console.error('Failed to save rating', err);
      });
    },
    [currentTrack, setCurrentTrackRating, tracksPages],
  );

  const handleTagsUpdated = useCallback(
    (updated: Track) => {
      tracksPages.updateItems((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (currentTrack?.id === updated.id) {
        setCurrentTrackFields(updated);
      }
    },
    [currentTrack, setCurrentTrackFields, tracksPages],
  );

  const handleBulkTagsUpdated = useCallback(
    (updated: Track[]) => {
      const byId = new Map(updated.map((t) => [t.id, t]));
      tracksPages.updateItems((prev) => prev.map((t) => byId.get(t.id) ?? t));
      if (currentTrack && byId.has(currentTrack.id)) {
        setCurrentTrackFields(byId.get(currentTrack.id)!);
      }
    },
    [currentTrack, setCurrentTrackFields, tracksPages],
  );

  const handleAddToPlaylist = useCallback((trackId: number, playlistId: number) => {
    if (!playlistId) return;
    addTrackToPlaylist(playlistId, trackId).then(() => fetchPlaylists().then(setPlaylists));
  }, []);

  const renderContent = () => {
    if (view === 'albumArtists' && !drillDown) {
      if (albumArtistsPages.error) return <p className="error-state">{albumArtistsPages.error}</p>;
      return (
        <FacetList
          facets={albumArtistsPages.items}
          onSelect={(name) => {
            setAlbumsArtistFilter(name);
            setAlbumsFilterSource('albumArtists');
            setView('albums');
          }}
          onSelectAlbum={(album, artist) => {
            setView('albums');
            setDrillDown({ kind: 'album', value: album, artist });
          }}
          onLoadMore={albumArtistsPages.loadMore}
        />
      );
    }
    if (view === 'artists' && !drillDown) {
      if (artistsPages.error) return <p className="error-state">{artistsPages.error}</p>;
      return (
        <FacetList
          facets={artistsPages.items}
          onSelect={(name) => {
            setAlbumsArtistFilter(name);
            setAlbumsFilterSource('artists');
            setView('albums');
          }}
          onSelectAlbum={(album, artist) => {
            setView('albums');
            setDrillDown({ kind: 'album', value: album, artist });
          }}
          onLoadMore={artistsPages.loadMore}
        />
      );
    }
    if (view === 'genres' && !drillDown) {
      if (genresPages.error) return <p className="error-state">{genresPages.error}</p>;
      return (
        <FacetList
          facets={genresPages.items}
          onSelect={(name) => setDrillDown({ kind: 'genre', value: name })}
          onLoadMore={genresPages.loadMore}
        />
      );
    }
    if (view === 'albums' && !drillDown) {
      if (albumsPages.error) return <p className="error-state">{albumsPages.error}</p>;
      return (
        <AlbumGrid
          albums={albumsPages.items}
          onSelect={(album) => setDrillDown({ kind: 'album', value: album.album, artist: album.artist })}
          onTracksEdited={() => albumsPages.reload()}
          onLoadMore={albumsPages.loadMore}
        />
      );
    }
    if (view === 'playlists') {
      return <PlaylistPanel search={sectionSearch} onSearch={setSectionSearch} />;
    }
    if (view === 'history') {
      return <HistoryPanel />;
    }

    if (tracksPages.error) {
      return <p className="error-state">{tracksPages.error}</p>;
    }

    return (
      <>
        {tracksPages.loading && tracksPages.items.length === 0 ? <p className="loading-state">Loading...</p> : null}
        <TrackList
          tracks={tracksPages.items}
          onPlay={handlePlay}
          onRate={handleRate}
          onTagsUpdated={handleTagsUpdated}
          onBulkTagsUpdated={handleBulkTagsUpdated}
          activeTrackId={currentTrack?.id}
          onLoadMore={tracksPages.loadMore}
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

  const sectionMatchCount =
    view === 'albumArtists'
      ? albumArtistsPages.totalCount
      : view === 'artists'
        ? artistsPages.totalCount
        : view === 'albums'
          ? albumsPages.totalCount
          : genresPages.totalCount;

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
                  setView(albumsFilterSource ?? 'artists');
                  setAlbumsFilterSource(null);
                }}
              >
                &larr; Back to {albumsFilterSource === 'albumArtists' ? 'album artist' : 'artists'}
              </button>
            ) : null}
            {view === 'all' || drillDown ? <SearchBar onSearch={setSearch} /> : null}
            {view !== 'all' && !drillDown && view !== 'playlists' && view !== 'history' ? (
              <div className="section-search-row">
                <SearchBar onSearch={setSectionSearch} placeholder={`Search ${view === 'albumArtists' ? 'album artists' : view}...`} />
                {sectionSearch.trim() ? <span className="search-match-count">{sectionMatchCount} matches</span> : null}
                {view === 'albums' ? (
                  <label className="album-page-size">
                    <span>Sort</span>
                    <select
                      value={albumSort}
                      onChange={(event) => handleAlbumSortChange(event.target.value as AlbumSort)}
                      aria-label="Sort albums by"
                    >
                      <option value="name">Name</option>
                      <option value="year">Year</option>
                    </select>
                  </label>
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
