namespace Mp3Streamer.Api.Models;

public class Track
{
    public int Id { get; set; }
    public required string FilePath { get; set; }
    public string? Title { get; set; }
    public string? Artist { get; set; }
    public string? Album { get; set; }
    public string? Genre { get; set; }
    public int? TrackNumber { get; set; }
    public int? Year { get; set; }
    public double DurationSeconds { get; set; }
    public long FileSizeBytes { get; set; }
    public DateTime DateAdded { get; set; }
    public bool HasEmbeddedArt { get; set; }
    public int Rating { get; set; }

    public ICollection<PlaylistTrack> PlaylistTracks { get; set; } = new List<PlaylistTrack>();
}
