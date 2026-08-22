using Microsoft.EntityFrameworkCore;
using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Endpoints;

// Cross-device "continue where you left off" — see DEVLOG.md for the full
// design discussion. Saved on every `pause` (mid-track only, not on natural
// track-end) and periodically during playback; fetched once on app load to
// show the "Continue playing?" prompt; cleared if the user declines it.
public static class PlaybackStateEndpoints
{
    public static void MapPlaybackStateEndpoints(this WebApplication app)
    {
        app.MapGet("/api/playback-state", async (LibraryDbContext db) =>
        {
            var state = await db.PlaybackState
                .Include(p => p.Track)
                .Where(p => !p.Track.IsMissing)
                .FirstOrDefaultAsync();

            if (state is null)
                return Results.NotFound();

            var track = state.Track;
            var dto = new PlaybackStateDto(
                new TrackDto(track.Id, track.Title ?? "Untitled", track.Artist, track.Album, track.Genre,
                    track.TrackNumber, track.Year, track.DurationSeconds, track.HasEmbeddedArt, track.Rating, track.IsMissing),
                state.PositionSeconds);

            return Results.Ok(dto);
        });

        app.MapPut("/api/playback-state", async (SavePlaybackStateRequest request, LibraryDbContext db) =>
        {
            if (!await db.Tracks.AnyAsync(t => t.Id == request.TrackId))
                return Results.NotFound();

            // Singleton row — always replace rather than tracking an id.
            await db.PlaybackState.ExecuteDeleteAsync();
            db.PlaybackState.Add(new PlaybackState
            {
                TrackId = request.TrackId,
                PositionSeconds = request.PositionSeconds,
                UpdatedAtUtc = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        app.MapDelete("/api/playback-state", async (LibraryDbContext db) =>
        {
            await db.PlaybackState.ExecuteDeleteAsync();
            return Results.NoContent();
        });
    }
}
