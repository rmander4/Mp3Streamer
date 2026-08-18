using Microsoft.EntityFrameworkCore;
using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Models;
using Mp3Streamer.Api.Services;

namespace Mp3Streamer.Api.Endpoints;

public static class LibraryEndpoints
{
    public static void MapLibraryEndpoints(this WebApplication app)
    {
        app.MapGet("/api/tracks", async (
            LibraryDbContext db,
            string? search,
            string? artist,
            string? album,
            string? genre,
            int page = 1,
            int pageSize = 50) =>
        {
            page = Math.Max(page, 1);
            pageSize = Math.Clamp(pageSize, 1, 200);

            var query = db.Tracks.AsQueryable();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = $"%{search}%";
                query = query.Where(t =>
                    EF.Functions.Like(t.Title!, term) ||
                    EF.Functions.Like(t.Artist!, term) ||
                    EF.Functions.Like(t.Album!, term));
            }

            if (!string.IsNullOrWhiteSpace(artist))
                query = query.Where(t => t.Artist == artist);

            if (!string.IsNullOrWhiteSpace(album))
                query = query.Where(t => t.Album == album);

            if (!string.IsNullOrWhiteSpace(genre))
                query = query.Where(t => t.Genre == genre);

            var totalCount = await query.CountAsync();

            var items = await query
                .OrderBy(t => t.Artist)
                .ThenBy(t => t.Album)
                .ThenBy(t => t.TrackNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(t => new TrackDto(t.Id, t.Title ?? "Untitled", t.Artist, t.Album, t.Genre, t.TrackNumber, t.Year, t.DurationSeconds, t.HasEmbeddedArt, t.Rating))
                .ToListAsync();

            return Results.Ok(new PagedResult<TrackDto>(items, page, pageSize, totalCount));
        });

        app.MapGet("/api/artists", async (LibraryDbContext db) =>
        {
            var artists = await db.Tracks
                .Where(t => t.Artist != null)
                .GroupBy(t => t.Artist)
                .Select(g => new { Name = g.Key!, Count = g.Count() })
                .ToListAsync();
            return Results.Ok(artists
                .Select(a => new FacetDto(a.Name, a.Count))
                .OrderBy(f => f.Name));
        });

        app.MapGet("/api/genres", async (LibraryDbContext db) =>
        {
            var genres = await db.Tracks
                .Where(t => t.Genre != null)
                .GroupBy(t => t.Genre)
                .Select(g => new { Name = g.Key!, Count = g.Count() })
                .ToListAsync();
            return Results.Ok(genres
                .Select(g => new FacetDto(g.Name, g.Count))
                .OrderBy(f => f.Name));
        });

        app.MapGet("/api/albums", async (LibraryDbContext db) =>
        {
            var albums = await db.Tracks
                .Where(t => t.Album != null)
                .GroupBy(t => new { t.Album, t.Artist })
                .Select(g => new { g.Key.Album, g.Key.Artist, Count = g.Count(), SampleTrackId = g.Min(t => t.Id) })
                .ToListAsync();
            return Results.Ok(albums
                .Select(a => new AlbumDto(a.Album!, a.Artist, a.Count, a.SampleTrackId))
                .OrderBy(a => a.Artist)
                .ThenBy(a => a.Album));
        });

        app.MapGet("/api/tracks/{id:int}/stream", async (int id, LibraryDbContext db) =>
        {
            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();

            return Results.File(track.FilePath, "audio/mpeg", enableRangeProcessing: true);
        });

        app.MapPut("/api/tracks/{id:int}/rating", async (int id, SetRatingRequest request, LibraryDbContext db) =>
        {
            if (request.Rating < 0 || request.Rating > 5)
                return Results.BadRequest("Rating must be between 0 and 5.");

            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();

            using (var tagFile = TagLib.File.Create(track.FilePath))
            {
                var id3v2 = (TagLib.Id3v2.Tag)tagFile.GetTag(TagLib.TagTypes.Id3v2, create: true)!;
                var popm = TagLib.Id3v2.PopularimeterFrame.Get(id3v2, string.Empty, create: true);
                popm.Rating = RatingMapper.StarsToByte(request.Rating);
                tagFile.Save();
            }

            track.Rating = request.Rating;
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        app.MapGet("/api/tracks/{id:int}/artwork", async (int id, LibraryDbContext db) =>
        {
            var track = await db.Tracks.FindAsync(id);
            if (track is null || !track.HasEmbeddedArt || !File.Exists(track.FilePath))
                return Results.NotFound();

            using var tagFile = TagLib.File.Create(track.FilePath);
            var picture = tagFile.Tag.Pictures.FirstOrDefault();
            if (picture is null)
                return Results.NotFound();

            return Results.File(picture.Data.Data, string.IsNullOrWhiteSpace(picture.MimeType) ? "image/jpeg" : picture.MimeType);
        });
    }
}
