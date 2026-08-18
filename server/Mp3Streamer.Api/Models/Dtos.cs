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
    int Rating);

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public record FacetDto(string Name, int TrackCount);

public record AlbumDto(string Album, string? Artist, int TrackCount, int SampleTrackId);

public record PlaylistSummaryDto(int Id, string Name, int TrackCount);

public record PlaylistDetailDto(int Id, string Name, IReadOnlyList<TrackDto> Tracks);

public record CreatePlaylistRequest(string Name);

public record AddPlaylistTrackRequest(int TrackId);

public record ReorderPlaylistRequest(int[] TrackIds);

public record SetRatingRequest(int Rating);
