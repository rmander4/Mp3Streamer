namespace Mp3Streamer.Api.Models;

public class PlayHistoryEntry
{
    public int Id { get; set; }
    public int TrackId { get; set; }
    public Track Track { get; set; } = null!;
    public DateTime PlayedAtUtc { get; set; }
}
