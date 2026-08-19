using Microsoft.EntityFrameworkCore;
using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Services;

public class LibraryScanner(LibraryDbContext db, IConfiguration config, ILogger<LibraryScanner> logger)
{
    public async Task<ScanResult> ScanAsync(CancellationToken ct = default)
    {
        var roots = config.GetSection("LibraryRootPaths").Get<string[]>() ?? [];
        var filesOnDisk = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var existingByPath = await db.Tracks.ToDictionaryAsync(t => t.FilePath, StringComparer.OrdinalIgnoreCase, ct);
        int added = 0, updated = 0;

        foreach (var configuredRoot in roots)
        {
            var root = Path.GetFullPath(configuredRoot);
            if (!Directory.Exists(root))
            {
                logger.LogWarning("Library root path does not exist: {Root}", root);
                continue;
            }

            foreach (var path in Directory.EnumerateFiles(root, "*.mp3", SearchOption.AllDirectories))
            {
                ct.ThrowIfCancellationRequested();
                filesOnDisk.Add(path);

                var fileInfo = new FileInfo(path);
                existingByPath.TryGetValue(path, out var existing);

                TagLib.File tagFile;
                try
                {
                    tagFile = TagLib.File.Create(path);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to read tags for {Path}", path);
                    continue;
                }

                var tag = tagFile.Tag;
                var properties = tagFile.Properties;
                var rating = ReadRating(tagFile);

                if (existing is null)
                {
                    db.Tracks.Add(new Track
                    {
                        FilePath = path,
                        Title = string.IsNullOrWhiteSpace(tag.Title) ? Path.GetFileNameWithoutExtension(path) : tag.Title,
                        Artist = tag.FirstPerformer,
                        Album = tag.Album,
                        Genre = tag.FirstGenre,
                        TrackNumber = tag.Track == 0 ? null : (int)tag.Track,
                        Year = tag.Year == 0 ? null : (int)tag.Year,
                        DurationSeconds = properties.Duration.TotalSeconds,
                        FileSizeBytes = fileInfo.Length,
                        DateAdded = DateTime.UtcNow,
                        HasEmbeddedArt = tag.Pictures.Length > 0,
                        Rating = rating
                    });
                    added++;
                }
                else
                {
                    existing.Title = string.IsNullOrWhiteSpace(tag.Title) ? Path.GetFileNameWithoutExtension(path) : tag.Title;
                    existing.Artist = tag.FirstPerformer;
                    existing.Album = tag.Album;
                    existing.Genre = tag.FirstGenre;
                    existing.TrackNumber = tag.Track == 0 ? null : (int)tag.Track;
                    existing.Year = tag.Year == 0 ? null : (int)tag.Year;
                    existing.DurationSeconds = properties.Duration.TotalSeconds;
                    existing.FileSizeBytes = fileInfo.Length;
                    existing.HasEmbeddedArt = tag.Pictures.Length > 0;
                    existing.Rating = rating;
                    existing.IsMissing = false; // covers a file reappearing at the same path after having gone missing
                    updated++;
                }
            }
        }

        var missing = existingByPath.Values
            .Where(t => !filesOnDisk.Contains(t.FilePath))
            .ToList();

        if (await ShouldRemoveMissingTracksAsync())
        {
            db.Tracks.RemoveRange(missing);
        }
        else
        {
            // Keep the row (and its playlist memberships / play history)
            // instead of deleting it — the frontend grays these out rather
            // than hiding them, per Ryan (2026-08-18): "maybe I don't want
            // those tracks to be removed... hence the setting."
            foreach (var track in missing)
            {
                track.IsMissing = true;
            }
        }

        await db.SaveChangesAsync(ct);

        return new ScanResult(added, updated, missing.Count, filesOnDisk.Count);
    }

    private async Task<bool> ShouldRemoveMissingTracksAsync()
    {
        var setting = await db.Settings.FindAsync("RemoveMissingTracks");
        // No row yet means it's never been toggled — default to the
        // original always-remove behavior, so this is opt-in to change.
        return setting is null || bool.Parse(setting.Value);
    }

    private static int ReadRating(TagLib.File tagFile)
    {
        if (tagFile.GetTag(TagLib.TagTypes.Id3v2) is not TagLib.Id3v2.Tag id3v2)
            return 0;

        var popm = id3v2.GetFrames<TagLib.Id3v2.PopularimeterFrame>().FirstOrDefault();
        return popm is null ? 0 : RatingMapper.ByteToStars(popm.Rating);
    }
}

public record ScanResult(int Added, int Updated, int Removed, int TotalFilesFound);
