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
                .Select(t => new TrackDto(t.Id, t.Title ?? "Untitled", t.Artist, t.Album, t.Genre, t.TrackNumber, t.Year, t.DurationSeconds, t.HasEmbeddedArt, t.Rating, t.IsMissing))
                .ToListAsync();

            return Results.Ok(new PagedResult<TrackDto>(items, page, pageSize, totalCount));
        });

        app.MapGet("/api/artists", async (LibraryDbContext db) =>
        {
            var trackCounts = await db.Tracks
                .Where(t => t.Artist != null)
                .GroupBy(t => t.Artist)
                .Select(g => new { Name = g.Key!, Count = g.Count() })
                .ToListAsync();

            // One representative track id per (Artist, Album) pair, for the
            // frontend's small cascaded album-art stack next to each artist.
            var albumSamples = await db.Tracks
                .Where(t => t.Artist != null && t.Album != null)
                .GroupBy(t => new { t.Artist, t.Album })
                .Select(g => new { Artist = g.Key.Artist!, Album = g.Key.Album!, SampleTrackId = g.Min(t => t.Id) })
                .ToListAsync();

            var albumArtByArtist = albumSamples
                .GroupBy(a => a.Artist)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(a => a.Album).Take(4).Select(a => a.SampleTrackId).ToArray());

            var artists = trackCounts
                .Select(a => new ArtistDto(a.Name, a.Count, albumArtByArtist.GetValueOrDefault(a.Name, [])))
                .OrderBy(a => a.Name);

            return Results.Ok(artists);
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

        app.MapGet("/api/tracks/{id:int}/download", async (int id, LibraryDbContext db) =>
        {
            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();

            return Results.File(track.FilePath, "audio/mpeg", fileDownloadName: BuildDownloadFileName(track));
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

        app.MapPut("/api/tracks/{id:int}/tags", async (int id, UpdateTagsRequest request, LibraryDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(request.Title))
                return Results.BadRequest("Title is required.");

            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();

            using (var tagFile = TagLib.File.Create(track.FilePath))
            {
                var tag = tagFile.Tag;
                tag.Title = request.Title;
                tag.Performers = string.IsNullOrWhiteSpace(request.Artist) ? [] : [request.Artist];
                tag.Album = request.Album;
                tag.Genres = string.IsNullOrWhiteSpace(request.Genre) ? [] : [request.Genre];
                tag.Track = (uint)(request.TrackNumber ?? 0);
                tag.Year = (uint)(request.Year ?? 0);
                tagFile.Save();
            }

            track.Title = request.Title;
            track.Artist = request.Artist;
            track.Album = request.Album;
            track.Genre = request.Genre;
            track.TrackNumber = request.TrackNumber;
            track.Year = request.Year;
            await db.SaveChangesAsync();

            return Results.Ok(new TrackDto(
                track.Id, track.Title, track.Artist, track.Album, track.Genre,
                track.TrackNumber, track.Year, track.DurationSeconds, track.HasEmbeddedArt, track.Rating, track.IsMissing));
        });

        app.MapPut("/api/tracks/bulk-tags", async (BulkUpdateTagsRequest request, LibraryDbContext db) =>
        {
            if (request.TrackIds.Length == 0)
                return Results.BadRequest("No tracks specified.");
            if (!request.SetArtist && !request.SetAlbum && !request.SetGenre && !request.SetYear)
                return Results.BadRequest("No fields to update.");

            var tracks = await db.Tracks.Where(t => request.TrackIds.Contains(t.Id)).ToListAsync();
            var updated = new List<TrackDto>();

            foreach (var track in tracks)
            {
                if (!File.Exists(track.FilePath))
                    continue;

                using (var tagFile = TagLib.File.Create(track.FilePath))
                {
                    var tag = tagFile.Tag;
                    if (request.SetArtist)
                        tag.Performers = string.IsNullOrWhiteSpace(request.Artist) ? [] : [request.Artist];
                    if (request.SetAlbum)
                        tag.Album = request.Album;
                    if (request.SetGenre)
                        tag.Genres = string.IsNullOrWhiteSpace(request.Genre) ? [] : [request.Genre];
                    if (request.SetYear)
                        tag.Year = (uint)(request.Year ?? 0);
                    tagFile.Save();
                }

                if (request.SetArtist) track.Artist = request.Artist;
                if (request.SetAlbum) track.Album = request.Album;
                if (request.SetGenre) track.Genre = request.Genre;
                if (request.SetYear) track.Year = request.Year;

                updated.Add(new TrackDto(
                    track.Id, track.Title ?? "Untitled", track.Artist, track.Album, track.Genre,
                    track.TrackNumber, track.Year, track.DurationSeconds, track.HasEmbeddedArt, track.Rating, track.IsMissing));
            }

            await db.SaveChangesAsync();

            return Results.Ok(updated);
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

        app.MapGet("/api/settings/remove-missing-tracks", async (LibraryDbContext db) =>
        {
            var setting = await db.Settings.FindAsync("RemoveMissingTracks");
            var enabled = setting is null || bool.Parse(setting.Value);
            return Results.Ok(new { enabled });
        });

        app.MapPut("/api/settings/remove-missing-tracks", async (SetRemoveMissingTracksRequest request, LibraryDbContext db) =>
        {
            var setting = await db.Settings.FindAsync("RemoveMissingTracks");
            if (setting is null)
                db.Settings.Add(new AppSetting { Key = "RemoveMissingTracks", Value = request.Enabled.ToString() });
            else
                setting.Value = request.Enabled.ToString();

            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static string BuildDownloadFileName(Track track)
    {
        var name = string.IsNullOrWhiteSpace(track.Artist)
            ? track.Title ?? "track"
            : $"{track.Artist} - {track.Title}";

        foreach (var c in Path.GetInvalidFileNameChars())
        {
            name = name.Replace(c, '_');
        }

        return $"{name}.mp3";
    }
}
