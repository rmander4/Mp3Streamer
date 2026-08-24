import { useState } from 'react';
import type { ArtworkSearchResult } from '../api/types';
import { searchItunesArtwork } from '../api/client';

interface ItunesArtworkSearchProps {
  artist: string;
  album: string;
  selectedUrl: string | null;
  onSelect: (url: string) => void;
}

// Shared by both the single-track and bulk ID3 editors — looks up album
// art via the free, keyless iTunes Search API (see api/client.ts) and lets
// the user pick from up to 5 candidates rather than trusting a single
// automatic match. Selecting a result flows through the same
// artworkPreview/apply path each dialog already has for a locally-browsed
// file, just backed by a remote URL instead of a File.
export function ItunesArtworkSearch({ artist, album, selectedUrl, onSelect }: ItunesArtworkSearchProps) {
  const [results, setResults] = useState<ArtworkSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSearch = album.trim().length > 0 && !loading;

  const handleSearch = async () => {
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    try {
      const found = await searchItunesArtwork(artist.trim(), album.trim());
      setResults(found);
    } catch {
      setError('iTunes search failed — please try again.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="itunes-art-search">
      <button type="button" className="settings-option" onClick={handleSearch} disabled={!canSearch}>
        {loading ? 'Searching…' : 'Search iTunes'}
      </button>
      {error ? <p className="tags-error">{error}</p> : null}
      {results ? (
        results.length === 0 ? (
          <p className="itunes-art-empty">No matches found.</p>
        ) : (
          <div className="itunes-art-results">
            {results.map((result) => (
              <button
                type="button"
                key={result.artworkUrl}
                className={
                  selectedUrl === result.artworkUrl ? 'itunes-art-result active' : 'itunes-art-result'
                }
                onClick={() => onSelect(result.artworkUrl)}
                title={`${result.artistName} — ${result.collectionName}`}
              >
                <img src={result.artworkUrl} alt={result.collectionName} />
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
