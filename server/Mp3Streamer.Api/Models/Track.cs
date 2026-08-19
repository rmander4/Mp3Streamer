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
    // Set by the scanner when the file can't be found on disk anymore, but
    // only if the "remove missing tracks" setting is off — otherwise the
    // row is just deleted outright and this never gets used. Cleared back
    // to false if the file reappears at the same path on a later scan.
    public bool IsMissing { get; set; }

    public ICollection<PlaylistTrack> PlaylistTracks { get; set; } = new List<PlaylistTrack>();
}
