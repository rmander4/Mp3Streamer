using Microsoft.EntityFrameworkCore;
using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Endpoints;

public static class PlaylistEndpoints
{
    public static void MapPlaylistEndpoints(this WebApplication app)
    {
        app.MapGet("/api/playlists", async (LibraryDbContext db) =>
        {
            var playlists = await db.Playlists
                .Select(p => new { p.Id, p.Name, TrackCount = p.PlaylistTracks.Count })
                .OrderBy(p => p.Name)
                .ToListAsync();
            return Results.Ok(playlists.Select(p => new PlaylistSummaryDto(p.Id, p.Name, p.TrackCount)));
        });

        app.MapPost("/api/playlists", async (CreatePlaylistRequest request, LibraryDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest("Name is required.");

            var playlist = new Playlist { Name = request.Name.Trim(), DateCreated = DateTime.UtcNow };
            db.Playlists.Add(playlist);
            await db.SaveChangesAsync();
            return Results.Created($"/api/playlists/{playlist.Id}", new PlaylistSummaryDto(playlist.Id, playlist.Name, 0));
        });

        app.MapPut("/api/playlists/{id:int}", async (int id, CreatePlaylistRequest request, LibraryDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest("Name is required.");

            var playlist = await db.Playlists.FindAsync(id);
            if (playlist is null) return Results.NotFound();

            playlist.Name = request.Name.Trim();
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        app.MapDelete("/api/playlists/{id:int}", async (int id, LibraryDbContext db) =>
        {
            var playlist = await db.Playlists.FindAsync(id);
            if (playlist is null) return Results.NotFound();

            db.Playlists.Remove(playlist);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        app.MapGet("/api/playlists/{id:int}", async (int id, LibraryDbContext db) =>
        {
            var playlist = await db.Playlists
                .Include(p => p.PlaylistTracks.OrderBy(pt => pt.SortOrder))
                .ThenInclude(pt => pt.Track)
                .FirstOrDefaultAsync(p => p.Id == id);

            if (playlist is null) return Results.NotFound();

            var tracks = playlist.PlaylistTracks
                .OrderBy(pt => pt.SortOrder)
                .Select(pt => pt.Track)
                .Select(t => new TrackDto(t.Id, t.Title ?? "Untitled", t.Artist, t.Album, t.Genre, t.TrackNumber, t.Year, t.DurationSeconds, t.HasEmbeddedArt, t.Rating))
                .ToList();

            return Results.Ok(new PlaylistDetailDto(playlist.Id, playlist.Name, tracks));
        });

        app.MapPost("/api/playlists/{id:int}/tracks", async (int id, AddPlaylistTrackRequest request, LibraryDbContext db) =>
        {
            var playlist = await db.Playlists.FindAsync(id);
            if (playlist is null) return Results.NotFound();

            var trackExists = await db.Tracks.AnyAsync(t => t.Id == request.TrackId);
            if (!trackExists) return Results.BadRequest("Track does not exist.");

            var nextSortOrder = await db.PlaylistTracks
                .Where(pt => pt.PlaylistId == id)
                .Select(pt => (int?)pt.SortOrder)
                .MaxAsync() ?? -1;

            db.PlaylistTracks.Add(new PlaylistTrack { PlaylistId = id, TrackId = request.TrackId, SortOrder = nextSortOrder + 1 });
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        app.MapDelete("/api/playlists/{id:int}/tracks/{trackId:int}", async (int id, int trackId, LibraryDbContext db) =>
        {
            var entry = await db.PlaylistTracks.FirstOrDefaultAsync(pt => pt.PlaylistId == id && pt.TrackId == trackId);
            if (entry is null) return Results.NotFound();

            db.PlaylistTracks.Remove(entry);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        app.MapPut("/api/playlists/{id:int}/reorder", async (int id, ReorderPlaylistRequest request, LibraryDbContext db) =>
        {
            var entries = await db.PlaylistTracks
                .Where(pt => pt.PlaylistId == id)
                .ToDictionaryAsync(pt => pt.TrackId);

            for (var index = 0; index < request.TrackIds.Length; index++)
            {
                if (entries.TryGetValue(request.TrackIds[index], out var entry))
                    entry.SortOrder = index;
            }

            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
