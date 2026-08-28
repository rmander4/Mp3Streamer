import { useCallback, useEffect, useState } from 'react';
import type { PlaylistDetail, PlaylistSummary, Track } from '../api/types';
import {
  createPlaylist,
  deletePlaylist,
  fetchPlaylistDetail,
  fetchPlaylists,
  removeTrackFromPlaylist,
  reorderPlaylist,
  setTrackRating,
} from '../api/client';
import { TrackList } from './TrackList';
import { usePlayer } from '../player/PlayerContext';
import { SearchBar } from './SearchBar';

interface PlaylistPanelProps {
  search: string;
  onSearch: (term: string) => void;
}

// The playlist-name sidebar list stays a plain (unvirtualized) list —
// unlike everything else converted in this pass, it's always small and
// user-curated, and virtualizing it would fight the *other* virtualized
// list rendered right next to it (the selected playlist's tracks, via
// TrackList below): the two sit side by side, not stacked, so they can't
// both bind to the shared `.main-content` scroll container at once — only
// TrackList (the one that can actually grow large) needs to.
export function PlaylistPanel({ search, onSearch }: PlaylistPanelProps) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [newName, setNewName] = useState('');
  const { playQueue, currentTrack, setCurrentTrackRating, setCurrentTrackFields } = usePlayer();
  const filteredPlaylists = playlists.filter((playlist) => playlist.name.toLowerCase().includes(search.toLowerCase()));

  const reloadPlaylists = useCallback(() => {
    fetchPlaylists().then(setPlaylists);
  }, []);

  useEffect(() => {
    reloadPlaylists();
  }, [reloadPlaylists]);

  const reloadDetail = useCallback((id: number) => {
    fetchPlaylistDetail(id).then(setDetail);
  }, []);

  useEffect(() => {
    if (selectedId !== null) reloadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, reloadDetail]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const created = await createPlaylist(newName.trim());
    setNewName('');
    reloadPlaylists();
    setSelectedId(created.id);
  };

  const handleDelete = async (id: number) => {
    await deletePlaylist(id);
    if (selectedId === id) setSelectedId(null);
    reloadPlaylists();
  };

  const handleRemoveTrack = async (trackId: number) => {
    if (selectedId === null) return;
    await removeTrackFromPlaylist(selectedId, trackId);
    reloadDetail(selectedId);
    reloadPlaylists();
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!detail) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= detail.tracks.length) return;

    const reordered = [...detail.tracks];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    setDetail({ ...detail, tracks: reordered });
    await reorderPlaylist(detail.id, reordered.map((t) => t.id));
  };

  const handlePlay = (tracks: Track[], index: number) => {
    playQueue(tracks, index);
  };

  const handleRate = (track: Track, rating: number) => {
    if (!detail) return;
    setDetail({ ...detail, tracks: detail.tracks.map((t) => (t.id === track.id ? { ...t, rating } : t)) });
    if (currentTrack?.id === track.id) {
      setCurrentTrackRating(rating);
    }
    setTrackRating(track.id, rating).catch((err) => {
      console.error('Failed to save rating', err);
    });
  };

  const handleTagsUpdated = (updated: Track) => {
    if (!detail) return;
    setDetail({ ...detail, tracks: detail.tracks.map((t) => (t.id === updated.id ? updated : t)) });
    if (currentTrack?.id === updated.id) {
      setCurrentTrackFields(updated);
    }
  };

  const handleBulkTagsUpdated = (updated: Track[]) => {
    if (!detail) return;
    const byId = new Map(updated.map((t) => [t.id, t]));
    setDetail({ ...detail, tracks: detail.tracks.map((t) => byId.get(t.id) ?? t) });
    if (currentTrack && byId.has(currentTrack.id)) {
      setCurrentTrackFields(byId.get(currentTrack.id)!);
    }
  };

  return (
    <div className="playlist-panel">
      <div className="playlist-sidebar">
        <div className="section-search-row playlist-search-row">
          <SearchBar onSearch={onSearch} placeholder="Search playlists..." />
          <span className="search-match-count">{filteredPlaylists.length} matches</span>
        </div>
        <div className="playlist-create">
          <input
            type="text"
            placeholder="New playlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button onClick={handleCreate}>Create</button>
        </div>
        <ul className="playlist-list">
          {filteredPlaylists.map((p) => (
            <li key={p.id}>
              <button
                className={p.id === selectedId ? 'facet-item active' : 'facet-item'}
                onClick={() => setSelectedId(p.id)}
              >
                <span>{p.name}</span>
                <span className="facet-count">{p.trackCount}</span>
              </button>
              <button className="playlist-delete" onClick={() => handleDelete(p.id)} aria-label={`Delete ${p.name}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="playlist-detail">
        {detail ? (
          <>
            <h2>{detail.name}</h2>
            <TrackList
              tracks={detail.tracks}
              onPlay={handlePlay}
              onRate={handleRate}
              onTagsUpdated={handleTagsUpdated}
              onBulkTagsUpdated={handleBulkTagsUpdated}
              activeTrackId={currentTrack?.id}
              renderRowActions={(track, index) => (
                <>
                  <button onClick={() => handleMove(index, -1)} aria-label="Move up" disabled={index === 0}>
                    ↑
                  </button>
                  <button
                    onClick={() => handleMove(index, 1)}
                    aria-label="Move down"
                    disabled={index === detail.tracks.length - 1}
                  >
                    ↓
                  </button>
                  <button onClick={() => handleRemoveTrack(track.id)} aria-label="Remove from playlist">
                    ✕
                  </button>
                </>
              )}
            />
          </>
        ) : (
          <p className="empty-state">Select or create a playlist.</p>
        )}
      </div>
    </div>
  );
}
