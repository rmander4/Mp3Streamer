using System.Globalization;
using System.Xml;
using Microsoft.EntityFrameworkCore;
using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Services;

public sealed class ItunesXmlImporter(
    LibraryDbContext db,
    ILogger<ItunesXmlImporter> logger)
{
    public async Task<ImportResult> ImportAsync(Stream xml, CancellationToken ct = default)
    {
        logger.LogInformation("iTunes XML import started");
        var settings = new XmlReaderSettings
        {
            IgnoreComments = true,
            IgnoreWhitespace = true,
            DtdProcessing = DtdProcessing.Ignore,
            XmlResolver = null,
            Async = true
        };
        var imported = 0;
        var skipped = 0;
        var existingByPath = await db.Tracks.ToDictionaryAsync(t => t.FilePath, StringComparer.OrdinalIgnoreCase, ct);
        var existingByPersistentId = await db.Tracks
            .Where(t => t.PersistentId != null)
            .ToDictionaryAsync(t => t.PersistentId!, StringComparer.OrdinalIgnoreCase, ct);
        var importedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        logger.LogInformation("Reading iTunes XML catalog");
        using var progressStream = new ProgressLoggingStream(xml, logger);
        using var reader = XmlReader.Create(progressStream, settings);
        await MoveToElementAsync(reader, "dict", ct);
        await reader.ReadAsync();
        while (reader.ReadToFollowing("key"))
        {
            ct.ThrowIfCancellationRequested();
            var key = await reader.ReadElementContentAsStringAsync();
            if (key == "Tracks")
                logger.LogInformation("Found iTunes Tracks dictionary");
            if (key != "Tracks")
            {
                await reader.MoveToContentAsync();
                reader.Skip();
                continue;
            }

            await reader.MoveToContentAsync();
            if (reader.NodeType != XmlNodeType.Element || reader.Name != "dict")
                throw new InvalidDataException("The iTunes XML Tracks value is not a dictionary.");

            await reader.ReadAsync();
            while (reader.NodeType != XmlNodeType.EndElement || reader.Name != "dict")
            {
                ct.ThrowIfCancellationRequested();
                await reader.MoveToContentAsync();
                if (reader.NodeType == XmlNodeType.EndElement && reader.Name == "dict")
                    break;
                if (reader.NodeType != XmlNodeType.Element || reader.Name != "key")
                {
                    await reader.ReadAsync();
                    continue;
                }

                await reader.ReadElementContentAsStringAsync(); // Numeric dictionary key.
                if (imported == 0)
                    logger.LogInformation("Reading first iTunes track dictionary");
                await reader.MoveToContentAsync();
                if (reader.NodeType != XmlNodeType.Element || reader.Name != "dict")
                {
                    await reader.ReadAsync();
                    skipped++;
                    continue;
                }

                var track = await ReadTrackAsync(reader, ct);
                if (track is null || string.IsNullOrWhiteSpace(track.FilePath))
                {
                    skipped++;
                    await reader.ReadAsync();
                    continue;
                }

                importedPaths.Add(track.FilePath);
                if (track.PersistentId is not null && existingByPersistentId.TryGetValue(track.PersistentId, out var existingById))
                    Apply(existingById, track);
                else if (existingByPath.TryGetValue(track.FilePath, out var existingByFile))
                    Apply(existingByFile, track);
                else
                {
                    db.Tracks.Add(track);
                    existingByPath[track.FilePath] = track;
                    if (track.PersistentId is not null)
                        existingByPersistentId[track.PersistentId] = track;
                }

                imported++;
                if (imported % 1000 == 0)
                    logger.LogInformation("Imported {Count} iTunes tracks", imported);

                await reader.ReadAsync();
            }

            break;
        }

        foreach (var track in existingByPath.Values.Where(t => t.CatalogSource == "ItunesXml" && !importedPaths.Contains(t.FilePath)))
            track.IsMissing = true;

        logger.LogInformation("Saving {Count} imported iTunes tracks to the database", imported);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("iTunes XML import finished: {Imported} imported, {Skipped} skipped", imported, skipped);
        return new ImportResult(imported, skipped);
    }

    private static async Task<Track?> ReadTrackAsync(XmlReader reader, CancellationToken ct)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        await reader.ReadAsync();
        while (reader.NodeType != XmlNodeType.EndElement || reader.Name != "dict")
        {
            await reader.MoveToContentAsync();
            if (reader.NodeType == XmlNodeType.EndElement && reader.Name == "dict")
                break;
            if (reader.NodeType != XmlNodeType.Element || reader.Name != "key")
            {
                await reader.ReadAsync();
                continue;
            }

            var key = await reader.ReadElementContentAsStringAsync();
            await reader.MoveToContentAsync();
            if (reader.NodeType != XmlNodeType.Element)
                continue;
            if (reader.Name is "string" or "integer" or "real" or "date")
                values[key] = await reader.ReadElementContentAsStringAsync();
            else if (reader.Name is "true" or "false")
            {
                values[key] = reader.Name;
                await reader.ReadAsync();
            }
            else
                reader.Skip();
        }

        var filePath = values.TryGetValue("Location", out var location) ? ToLocalPath(location) : null;
        if (string.IsNullOrWhiteSpace(filePath))
            return null;

        return new Track
        {
            FilePath = filePath,
            PersistentId = Get(values, "Persistent ID"),
            CatalogSource = "ItunesXml",
            Title = Get(values, "Name") ?? Path.GetFileNameWithoutExtension(filePath),
            Artist = Get(values, "Artist"),
            AlbumArtist = Get(values, "Album Artist") ?? Get(values, "Artist"),
            Album = Get(values, "Album"),
            Genre = Get(values, "Genre"),
            TrackNumber = GetInt(values, "Track Number"),
            Year = GetInt(values, "Year"),
            DurationSeconds = GetDouble(values, "Total Time") / 1000d,
            FileSizeBytes = GetLong(values, "Size"),
            DateAdded = DateTime.UtcNow,
            HasEmbeddedArt = GetInt(values, "Artwork Count") > 0,
            Rating = ToStars(GetInt(values, "Rating")),
            IsMissing = !File.Exists(filePath)
        };
    }

    private static void Apply(Track target, Track source)
    {
        target.FilePath = source.FilePath;
        target.PersistentId = source.PersistentId;
        target.CatalogSource = source.CatalogSource;
        target.Title = source.Title;
        target.Artist = source.Artist;
        target.AlbumArtist = source.AlbumArtist;
        target.Album = source.Album;
        target.Genre = source.Genre;
        target.TrackNumber = source.TrackNumber;
        target.Year = source.Year;
        target.DurationSeconds = source.DurationSeconds;
        target.FileSizeBytes = source.FileSizeBytes;
        target.HasEmbeddedArt = source.HasEmbeddedArt;
        target.Rating = source.Rating;
        target.IsMissing = source.IsMissing;
    }

    private static async Task MoveToElementAsync(XmlReader reader, string name, CancellationToken ct)
    {
        while (reader.NodeType != XmlNodeType.Element || reader.Name != name)
        {
            if (!await reader.ReadAsync())
                throw new InvalidDataException($"The iTunes XML file is missing its {name} element.");
            ct.ThrowIfCancellationRequested();
        }
    }

    private static string? ToLocalPath(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !uri.IsFile)
            return null;

        var path = Uri.UnescapeDataString(uri.AbsolutePath);
        if (path.Length >= 3 && path[0] == '/' && char.IsLetter(path[1]) && path[2] == ':')
            path = path[1..];
        else if (!string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) && uri.Host.Length > 0)
            path = $"\\\\{uri.Host}{path}";

        return path.Replace('/', Path.DirectorySeparatorChar);
    }

    private static string? Get(Dictionary<string, string> values, string key) => values.GetValueOrDefault(key);
    private static int ToStars(int? rating) => rating is null or <= 1 ? 0 : Math.Clamp(rating.Value / 20, 0, 5);
    private static int? GetInt(Dictionary<string, string> values, string key) => int.TryParse(Get(values, key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : null;
    private static long GetLong(Dictionary<string, string> values, string key) => long.TryParse(Get(values, key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : 0;
    private static double GetDouble(Dictionary<string, string> values, string key) => double.TryParse(Get(values, key), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : 0;

    private sealed class ProgressLoggingStream(Stream inner, ILogger logger) : Stream
    {
        private long bytesRead;
        private DateTime lastLogUtc = DateTime.UtcNow;

        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => inner.CanSeek;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override void Flush() => inner.Flush();
        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override int Read(byte[] buffer, int offset, int count)
        {
            var read = inner.Read(buffer, offset, count);
            Report(read);
            return read;
        }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            var read = await inner.ReadAsync(buffer, cancellationToken);
            Report(read);
            return read;
        }

        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            var read = await inner.ReadAsync(buffer, offset, count, cancellationToken);
            Report(read);
            return read;
        }

        private void Report(int read)
        {
            bytesRead += read;
            var now = DateTime.UtcNow;
            if (now - lastLogUtc < TimeSpan.FromSeconds(30) && bytesRead < Length)
                return;

            lastLogUtc = now;
            var percent = Length == 0 ? 100 : bytesRead * 100d / Length;
            logger.LogInformation("Reading iTunes XML: {Percent:0.0}% ({BytesRead:N0} of {TotalBytes:N0} bytes)", percent, bytesRead, Length);
        }
    }
}

public record ImportResult(int Imported, int Skipped);