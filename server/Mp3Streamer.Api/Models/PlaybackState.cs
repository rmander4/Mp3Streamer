namespace Mp3Streamer.Api.Models;

// Single-row table (there's never more than one) recording where playback
// was last left off — the whole point being "pause in the car, resume on
// the PC." Overwritten on every save, not accumulated like PlayHistory.
public class PlaybackState
{
    public int Id { get; set; }
    public int TrackId { get; set; }
    public Track Track { get; set; } = null!;
    public double PositionSeconds { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
}
