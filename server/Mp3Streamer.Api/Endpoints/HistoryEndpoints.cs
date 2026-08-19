using Microsoft.EntityFrameworkCore;
using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Endpoints;

public static class HistoryEndpoints
{
    private const string HistoryEnabledKey = "HistoryEnabled";

    public static void MapHistoryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/settings/history-enabled", async (LibraryDbContext db) =>
        {
            return Results.Ok(new { enabled = await IsHistoryEnabledAsync(db) });
        });

        app.MapPut("/api/settings/history-enabled", async (SetHistoryEnabledRequest request, LibraryDbContext db) =>
        {
            var setting = await db.Settings.FindAsync(HistoryEnabledKey);
            if (setting is null)
                db.Settings.Add(new AppSetting { Key = HistoryEnabledKey, Value = request.Enabled.ToString() });
            else
                setting.Value = request.Enabled.ToString();

            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Fire-and-forget from the client whenever a track starts playing.
        // Silently no-ops (rather than erroring) when history is toggled
        // off, so the frontend doesn't need to know the setting itself —
        // the server is the single source of truth for whether to record.
        app.MapPost("/api/tracks/{id:int}/play", async (int id, LibraryDbContext db) =>
        {
            if (!await db.Tracks.AnyAsync(t => t.Id == id))
                return Results.NotFound();

            if (await IsHistoryEnabledAsync(db))
            {
                // History is scoped to "today" only, by design (Ryan,
                // 2026-08-18: "this will prevent it from growing too large
                // over time") — actually delete anything from a prior day
                // rather than just filtering it out on read, so the table
                // stays bounded instead of accumulating forever. Piggybacks
                // on the one write path that ever grows the table, instead
                // of needing a separate cleanup job.
                await db.PlayHistory
                    .Where(h => h.PlayedAtUtc < TodayStartUtc())
                    .ExecuteDeleteAsync();

                db.PlayHistory.Add(new PlayHistoryEntry { TrackId = id, PlayedAtUtc = DateTime.UtcNow });
                await db.SaveChangesAsync();
            }

            return Results.NoContent();
        });

        app.MapGet("/api/history", async (LibraryDbContext db) =>
        {
            var todayStartUtc = TodayStartUtc();

            var entries = await db.PlayHistory
                .Include(h => h.Track)
                .Where(h => h.PlayedAtUtc >= todayStartUtc)
                .OrderByDescending(h => h.PlayedAtUtc)
                .ToListAsync();

            // SQLite loses DateTime.Kind on round-trip (comes back
            // Unspecified), which makes System.Text.Json serialize it
            // without a trailing "Z" — the frontend would then parse an
            // actually-UTC timestamp as if it were local time. Restoring
            // Kind=Utc here (client-side, after the query) fixes the JSON
            // output; EF can't translate DateTime.SpecifyKind into SQL, so
            // this has to happen after ToListAsync(), not inside the query.
            var items = entries.Select(h => new PlayHistoryEntryDto(
                h.Id,
                new TrackDto(
                    h.Track.Id, h.Track.Title ?? "Untitled", h.Track.Artist, h.Track.Album, h.Track.Genre,
                    h.Track.TrackNumber, h.Track.Year, h.Track.DurationSeconds, h.Track.HasEmbeddedArt, h.Track.Rating, h.Track.IsMissing),
                DateTime.SpecifyKind(h.PlayedAtUtc, DateTimeKind.Utc)));

            return Results.Ok(items);
        });

        app.MapDelete("/api/history", async (LibraryDbContext db) =>
        {
            await db.PlayHistory.ExecuteDeleteAsync();
            return Results.NoContent();
        });
    }

    private static DateTime TodayStartUtc() => DateTime.Today.ToUniversalTime();

    private static async Task<bool> IsHistoryEnabledAsync(LibraryDbContext db)
    {
        var setting = await db.Settings.FindAsync(HistoryEnabledKey);
        // No row yet means it's never been toggled — default to on.
        return setting is null || bool.Parse(setting.Value);
    }
}
