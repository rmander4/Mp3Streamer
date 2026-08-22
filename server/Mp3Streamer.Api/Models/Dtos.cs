namespace Mp3Streamer.Api.Models;

public record TrackDto(
    int Id,
    string Title,
    string? Artist,
    string? Album,
    string? Genre,
    int? TrackNumber,
    int? Year,
    double DurationSeconds,
    bool HasEmbeddedArt,
    int Rating,
    bool IsMissing);

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public record FacetDto(string Name, int TrackCount);

// AlbumArt: up to 4 sample (track id, album name) pairs, one per distinct
// album by this artist — the frontend uses these to render a small
// cascaded stack of album art thumbnails next to the artist name, each
// clickable through to that album (needs the name) and hoverable for a
// tooltip (also needs the name). Empty for genres (they use plain
// FacetDto).
public record ArtistDto(string Name, int TrackCount, AlbumArtDto[] AlbumArt);

public record AlbumArtDto(int TrackId, string Album);

public record AlbumDto(string Album, string? Artist, int TrackCount, int SampleTrackId);

public record PlaylistSummaryDto(int Id, string Name, int TrackCount);

public record PlaylistDetailDto(int Id, string Name, IReadOnlyList<TrackDto> Tracks);

public record CreatePlaylistRequest(string Name);

public record AddPlaylistTrackRequest(int TrackId);

public record ReorderPlaylistRequest(int[] TrackIds);

public record SetRatingRequest(int Rating);

public record UpdateTagsRequest(string Title, string? Artist, string? Album, string? Genre, int? TrackNumber, int? Year);

// Bulk tag edit only covers fields multiple tracks could plausibly share
// (Artist/Album/Genre/Year) — never Title, Track #, or Rating, which are
// inherently per-track. Each field has a paired "Set*" flag because the
// field's own value alone can't distinguish "leave this alone" from
// "explicitly clear it" — a plain null is ambiguous between the two, and
// blindly applying every field (like the single-track edit does) would
// silently wipe out values that differ across the selection but were never
// actually touched by the user.
// Carries the full track (not just title/artist/album) so a history entry
// is enough on its own to queue up and play — Ryan's use case (2026-08-18):
// "you think you heard [a song] around 3pm... click on various songs around
// 3pm and eventually you will find it."
public record PlayHistoryEntryDto(int Id, TrackDto Track, DateTime PlayedAtUtc);

public record SetHistoryEnabledRequest(bool Enabled);

public record SetRemoveMissingTracksRequest(bool Enabled);

public record BulkUpdateTagsRequest(
    int[] TrackIds,
    bool SetArtist, string? Artist,
    bool SetAlbum, string? Album,
    bool SetGenre, string? Genre,
    bool SetYear, int? Year);

// Carries the full track (same reasoning as PlayHistoryEntryDto above) so
// the "Continue playing?" resume prompt has everything it needs — title,
// artist, art — without a second round-trip.
public record PlaybackStateDto(TrackDto Track, double PositionSeconds);

public record SavePlaybackStateRequest(int TrackId, double PositionSeconds);
