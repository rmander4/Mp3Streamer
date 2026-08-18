namespace Mp3Streamer.Api.Models;

public class Playlist
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public DateTime DateCreated { get; set; }

    public ICollection<PlaylistTrack> PlaylistTracks { get; set; } = new List<PlaylistTrack>();
}

public class PlaylistTrack
{
    public int Id { get; set; }
    public int PlaylistId { get; set; }
    public Playlist Playlist { get; set; } = null!;
    public int TrackId { get; set; }
    public Track Track { get; set; } = null!;
    public int SortOrder { get; set; }
}
