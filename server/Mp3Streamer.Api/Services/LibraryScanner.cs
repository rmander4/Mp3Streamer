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

                if (existing is null)
                {
                    var track = new Track { FilePath = path, DateAdded = DateTime.UtcNow };
                    TrackTagMapper.Apply(track, tagFile, fileInfo);
                    track.FileModifiedUtc = fileInfo.LastWriteTimeUtc;
                    db.Tracks.Add(track);
                    added++;
                }
                else
                {
                    TrackTagMapper.Apply(existing, tagFile, fileInfo);
                    existing.FileModifiedUtc = fileInfo.LastWriteTimeUtc;
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
}

public record ScanResult(int Added, int Updated, int Removed, int TotalFilesFound);
