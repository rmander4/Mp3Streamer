using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Services;

/// <summary>
/// Re-reads a track's ID3 tags from its file when the file has changed since
/// we last looked, and mirrors them into the DB row. Called on track access
/// (stream / artwork) so metadata edited in any external tag editor shows up
/// the next time the track is used — without the iTunes XML sync or the
/// filesystem scanner having to carry per-field metadata themselves.
/// </summary>
public sealed class TrackMetadataRefresher(LibraryDbContext db, ILogger<TrackMetadataRefresher> logger)
{
    /// <summary>
    /// Best-effort. Cheap no-op (a single file stat) when nothing changed.
    /// Never throws — callers stream/serve the track regardless.
    /// </summary>
    public async Task RefreshIfChangedAsync(Track track, CancellationToken ct = default)
    {
        try
        {
            if (!File.Exists(track.FilePath))
                return;

            var fileInfo = new FileInfo(track.FilePath);
            if (track.FileModifiedUtc == fileInfo.LastWriteTimeUtc)
                return;

            using (var tagFile = TagLib.File.Create(track.FilePath))
            {
                TrackTagMapper.Apply(track, tagFile, fileInfo);
            }

            track.FileModifiedUtc = fileInfo.LastWriteTimeUtc;
            track.IsMissing = false;
            await db.SaveChangesAsync(ct);

            logger.LogInformation("Refreshed ID3 metadata for track {TrackId} from {Path}", track.Id, track.FilePath);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not refresh ID3 metadata for track {TrackId} ({Path})", track.Id, track.FilePath);
        }
    }
}
