using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
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
            string? albumArtist,
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

            // Disambiguates same-named albums by different artists (e.g. two
            // bands each with an album called "Onward") — matches how Albums
            // are grouped (AlbumArtist, falling back to Artist).
            if (!string.IsNullOrWhiteSpace(albumArtist))
                query = query.Where(t => (t.AlbumArtist ?? t.Artist) == albumArtist);

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
            // frontend's small album-art stack next to each artist. Sent
            // uncapped — the frontend shows up to 10 as a static row, or
            // switches to a scrolling marquee beyond that, so it needs the
            // full list either way rather than a server-side cap.
            var albumSamples = await db.Tracks
                .Where(t => t.Artist != null && t.Album != null)
                .GroupBy(t => new { t.Artist, t.Album })
                .Select(g => new { Artist = g.Key.Artist!, Album = g.Key.Album!, SampleTrackId = g.Min(t => t.Id) })
                .ToListAsync();

            var albumArtByArtist = albumSamples
                .GroupBy(a => a.Artist)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(a => a.Album).Select(a => new AlbumArtDto(a.SampleTrackId, a.Album)).ToArray());

            var artists = trackCounts
                .Select(a => new ArtistDto(a.Name, a.Count, albumArtByArtist.GetValueOrDefault(a.Name, [])))
                .OrderBy(a => a.Name);

            return Results.Ok(artists);
        });

        app.MapGet("/api/album-artists", async (LibraryDbContext db) =>
        {
            // Same shape as /api/artists, but grouped by AlbumArtist (falling
            // back to Artist for tracks that never got one) instead of the
            // per-track Artist — mirrors how Albums are grouped, so a track
            // credited to "Band feat. Someone" still lands under "Band".
            var trackCounts = await db.Tracks
                .Where(t => t.AlbumArtist != null || t.Artist != null)
                .GroupBy(t => t.AlbumArtist ?? t.Artist)
                .Select(g => new { Name = g.Key!, Count = g.Count() })
                .ToListAsync();

            var albumSamples = await db.Tracks
                .Where(t => (t.AlbumArtist != null || t.Artist != null) && t.Album != null)
                .GroupBy(t => new { Artist = t.AlbumArtist ?? t.Artist, t.Album })
                .Select(g => new { Artist = g.Key.Artist!, Album = g.Key.Album!, SampleTrackId = g.Min(t => t.Id) })
                .ToListAsync();

            var albumArtByArtist = albumSamples
                .GroupBy(a => a.Artist)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(a => a.Album).Select(a => new AlbumArtDto(a.SampleTrackId, a.Album)).ToArray());

            var albumArtists = trackCounts
                .Select(a => new ArtistDto(a.Name, a.Count, albumArtByArtist.GetValueOrDefault(a.Name, [])))
                .OrderBy(a => a.Name);

            return Results.Ok(albumArtists);
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
                .GroupBy(t => new { t.Album, Artist = t.AlbumArtist ?? t.Artist })
                .Select(g => new { g.Key.Album, g.Key.Artist, Count = g.Count(), SampleTrackId = g.Min(t => t.Id), Year = g.Min(t => t.Year) })
                .ToListAsync();
            return Results.Ok(albums
                .Select(a => new AlbumDto(a.Album!, a.Artist, a.Count, a.SampleTrackId, a.Year))
                .OrderBy(a => a.Artist)
                .ThenBy(a => a.Album));
        });

        app.MapGet("/api/tracks/{id:int}/stream", async (int id, LibraryDbContext db, HttpContext context) =>
        {
            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();

            // Without this, the response had no Cache-Control at all (just
            // Last-Modified), which lets browsers heuristically cache full
            // audio byte ranges to disk indefinitely — independent of, and
            // outliving, the app's own single-track Blob buffering
            // (bufferTrack.ts). That let several previously-played tracks
            // keep working offline well after their in-memory Blob had
            // already been revoked on track change, not just the one
            // actually buffered — not a bug in the buffering cleanup
            // itself (verified: NowPlayingBar.tsx already revokes the
            // previous Blob on every track change), but the browser's own
            // cache filling the same role behind the scenes.
            context.Response.Headers.CacheControl = "no-store";

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

        app.MapGet("/api/tracks/{id:int}/artwork", async (int id, LibraryDbContext db, HttpContext httpContext) =>
        {
            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();

            // Picture existence must be checked *before* setting any cache
            // headers — setting Cache-Control unconditionally meant a
            // track's first "no art yet" 404 got cached by the browser for
            // a full day right along with real 200 responses. Adding art
            // later (single or bulk edit) to a track that started with
            // none wouldn't show up until that cache expired or a hard
            // refresh forced it — confirmed by reproduction: a plain
            // fetch() with cache disabled got the fresh image immediately,
            // but the <img> tag kept rendering broken because it re-used
            // the stale cached 404 from before the edit.
            using var tagFile = TagLib.File.Create(track.FilePath);
            var picture = tagFile.Tag.Pictures.FirstOrDefault();
            if (picture is null)
                return Results.NotFound();

            var fileInfo = new FileInfo(track.FilePath);
            var etag = $"\"{fileInfo.Length:x}-{fileInfo.LastWriteTimeUtc.Ticks:x}\"";
            httpContext.Response.Headers.CacheControl = "public,max-age=86400";
            httpContext.Response.Headers.ETag = etag;
            if (httpContext.Request.Headers.IfNoneMatch.Any(value => value == etag))
                return Results.StatusCode(StatusCodes.Status304NotModified);

            return Results.File(picture.Data.Data, string.IsNullOrWhiteSpace(picture.MimeType) ? "image/jpeg" : picture.MimeType);
        });

        // Replaces the track's embedded art entirely (a single new picture
        // takes over whatever was there before, or becomes the art if there
        // was none) — same code path handles both cases, since assigning a
        // single-element Pictures array is idempotent either way. Editing
        // the file changes its mtime, which the GET endpoint above already
        // keys its ETag on, so browser-cached art is naturally invalidated
        // without any extra cache-busting logic needed here.
        app.MapPut("/api/tracks/{id:int}/artwork", async (int id, IFormFile file, LibraryDbContext db) =>
        {
            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();
            if (file.Length == 0)
                return Results.BadRequest("No image file provided.");

            await using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            SaveArtwork(track.FilePath, ms.ToArray(), file.ContentType);

            track.HasEmbeddedArt = true;
            await db.SaveChangesAsync();

            return Results.Ok(new TrackDto(
                track.Id, track.Title ?? "Untitled", track.Artist, track.Album, track.Genre,
                track.TrackNumber, track.Year, track.DurationSeconds, track.HasEmbeddedArt, track.Rating, track.IsMissing));
        }).DisableAntiforgery();

        // Free, keyless public catalog search — no official terms issue for
        // personal, low-volume lookups like this. Returned artwork URLs
        // point at Apple's own mzstatic.com CDN.
        app.MapGet("/api/artwork/search", async (string? artist, string? album, IHttpClientFactory httpClientFactory) =>
        {
            if (string.IsNullOrWhiteSpace(album))
                return Results.BadRequest("Album is required.");

            var term = string.IsNullOrWhiteSpace(artist) ? album : $"{artist} {album}";
            var searchUrl = $"https://itunes.apple.com/search?term={Uri.EscapeDataString(term)}&entity=album&limit=5";

            ItunesSearchResponse? parsed;
            try
            {
                var client = httpClientFactory.CreateClient();
                parsed = await client.GetFromJsonAsync<ItunesSearchResponse>(searchUrl, ItunesJsonOptions);
            }
            catch
            {
                return Results.Problem("Failed to reach the iTunes search API.", statusCode: StatusCodes.Status502BadGateway);
            }

            var results = (parsed?.Results ?? [])
                .Where(r => !string.IsNullOrWhiteSpace(r.ArtworkUrl100))
                // iTunes only returns small (100x100) thumbnails — the same
                // CDN path serves much larger art if you swap the size
                // segment in the URL; this is the standard (if undocumented)
                // trick every iTunes-artwork tool uses to get full-res art.
                .Select(r => new ArtworkSearchResultDto(
                    r.ArtworkUrl100!.Replace("100x100bb", "600x600bb"),
                    r.ArtistName ?? "",
                    r.CollectionName ?? ""))
                .ToArray();

            return Results.Ok(results);
        });

        // Downloads the given (Apple CDN only — see the host allowlist
        // below) image URL server-side and writes it into the track's ID3
        // art, same as the file-upload endpoint above.
        app.MapPut("/api/tracks/{id:int}/artwork-from-url", async (int id, ApplyArtworkFromUrlRequest request, LibraryDbContext db, IHttpClientFactory httpClientFactory) =>
        {
            var track = await db.Tracks.FindAsync(id);
            if (track is null || !File.Exists(track.FilePath))
                return Results.NotFound();

            if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
                uri.Scheme != Uri.UriSchemeHttps ||
                !(uri.Host.EndsWith(".mzstatic.com", StringComparison.OrdinalIgnoreCase) ||
                  uri.Host.EndsWith(".apple.com", StringComparison.OrdinalIgnoreCase)))
            {
                return Results.BadRequest("Artwork URL must be an https Apple CDN URL.");
            }

            byte[] bytes;
            string? mimeType;
            try
            {
                var client = httpClientFactory.CreateClient();
                using var response = await client.GetAsync(uri);
                response.EnsureSuccessStatusCode();
                bytes = await response.Content.ReadAsByteArrayAsync();
                mimeType = response.Content.Headers.ContentType?.MediaType;
            }
            catch
            {
                return Results.Problem("Failed to download artwork.", statusCode: StatusCodes.Status502BadGateway);
            }

            SaveArtwork(track.FilePath, bytes, mimeType);

            track.HasEmbeddedArt = true;
            await db.SaveChangesAsync();

            return Results.Ok(new TrackDto(
                track.Id, track.Title ?? "Untitled", track.Artist, track.Album, track.Genre,
                track.TrackNumber, track.Year, track.DurationSeconds, track.HasEmbeddedArt, track.Rating, track.IsMissing));
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

    private static void SaveArtwork(string filePath, byte[] bytes, string? mimeType)
    {
        var picture = new TagLib.Picture(new TagLib.ByteVector(bytes))
        {
            Type = TagLib.PictureType.FrontCover,
            MimeType = string.IsNullOrWhiteSpace(mimeType) ? "image/jpeg" : mimeType,
        };

        using var tagFile = TagLib.File.Create(filePath);
        tagFile.Tag.Pictures = [picture];
        tagFile.Save();
    }

    private static readonly JsonSerializerOptions ItunesJsonOptions = new(JsonSerializerDefaults.Web);

    private record ItunesSearchResponse(int ResultCount, List<ItunesSearchResult> Results);

    private record ItunesSearchResult(string? ArtistName, string? CollectionName, string? ArtworkUrl100);
}
