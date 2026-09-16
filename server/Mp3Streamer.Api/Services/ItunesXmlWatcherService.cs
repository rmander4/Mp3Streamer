namespace Mp3Streamer.Api.Services;

/// <summary>
/// Keeps the catalog in step with a real iTunes / Apple Music installation by
/// watching its Library XML file and reconciling <b>track add/remove</b>
/// whenever iTunes rewrites it — no manual "import" click needed. Per-track
/// metadata is deliberately not synced here; <see cref="TrackMetadataRefresher"/>
/// re-reads each file's ID3 tags on access instead.
///
/// Only active when <c>CatalogSource</c> is <c>ItunesXml</c> and
/// <c>ItunesXml:LibraryXmlPath</c> is configured. Complements
/// <see cref="LibraryWatcherService"/>, which sits out iTunes-XML mode.
///
/// <para><b>The real Library XML is treated as read-only and precious.</b>
/// It is never opened for write, never moved, never locked, never handed to
/// any external command. Each sync copies it byte-for-byte to a private temp
/// file, parses the copy, and deletes the copy. The watcher itself only ever
/// observes it through <see cref="FileSystemWatcher"/> and a last-write-time
/// stat.</para>
/// </summary>
public sealed class ItunesXmlWatcherService(
    IServiceScopeFactory scopeFactory,
    IConfiguration config,
    ILogger<ItunesXmlWatcherService> logger) : BackgroundService
{
    // iTunes rewrites the whole file (temp file + rename); give the write a
    // moment to settle, and coalesce the burst of events it produces.
    private static readonly TimeSpan DebounceDelay = TimeSpan.FromSeconds(10);

    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private Timer? _debounceTimer;
    private FileSystemWatcher? _watcher;
    private string _xmlPath = "";
    private DateTime _lastSyncedWriteUtc = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!string.Equals(config["CatalogSource"], "ItunesXml", StringComparison.OrdinalIgnoreCase))
            return;

        _xmlPath = config["ItunesXml:LibraryXmlPath"]?.Trim() ?? "";
        if (string.IsNullOrEmpty(_xmlPath))
        {
            logger.LogWarning("CatalogSource is ItunesXml but ItunesXml:LibraryXmlPath is not set — automatic iTunes sync disabled");
            return;
        }

        var directory = Path.GetDirectoryName(Path.GetFullPath(_xmlPath));
        if (directory is null || !Directory.Exists(directory))
        {
            logger.LogWarning("iTunes Library XML folder does not exist: {Directory} — automatic iTunes sync disabled", directory);
            return;
        }

        logger.LogInformation("Watching iTunes Library XML for changes: {Path}", _xmlPath);
        await RunSyncAsync(stoppingToken);

        _watcher = new FileSystemWatcher(directory)
        {
            Filter = Path.GetFileName(_xmlPath),
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.CreationTime,
            InternalBufferSize = 64 * 1024,
        };
        _watcher.Changed += OnXmlChanged;
        _watcher.Created += OnXmlChanged;
        _watcher.Renamed += OnXmlChanged;
        _watcher.Error += OnWatcherError;
        _watcher.EnableRaisingEvents = true;

        // Safety net for dropped filesystem events (a known FileSystemWatcher
        // failure mode): periodically compare the file's last-write time
        // against what we last synced and catch up if it moved.
        var intervalMinutes = Math.Max(1, config.GetValue("ItunesXml:SyncIntervalMinutes", 15));
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(intervalMinutes));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                if (File.Exists(_xmlPath) && File.GetLastWriteTimeUtc(_xmlPath) > _lastSyncedWriteUtc)
                {
                    logger.LogInformation("Periodic check found the iTunes Library XML changed since the last sync");
                    ScheduleSync();
                }
            }
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
    }

    private void OnXmlChanged(object sender, FileSystemEventArgs e) => ScheduleSync();

    private void OnWatcherError(object sender, ErrorEventArgs e)
    {
        logger.LogWarning(e.GetException(), "iTunes Library XML watcher error — will resync");
        ScheduleSync();
    }

    private void ScheduleSync()
    {
        _debounceTimer ??= new Timer(_ => _ = RunSyncAsync(CancellationToken.None));
        _debounceTimer.Change(DebounceDelay, Timeout.InfiniteTimeSpan);
    }

    private async Task RunSyncAsync(CancellationToken ct)
    {
        // Skip rather than queue if a sync is already running — any change
        // that lands meanwhile re-arms the debounce timer.
        if (!await _syncLock.WaitAsync(0, ct))
            return;

        string? tempCopy = null;
        try
        {
            if (!File.Exists(_xmlPath))
            {
                logger.LogWarning("iTunes Library XML not found at {Path}; skipping sync", _xmlPath);
                return;
            }

            var writeUtc = File.GetLastWriteTimeUtc(_xmlPath);

            // Work off a private copy — never read the original beyond this
            // one copy, never write to it.
            tempCopy = Path.Combine(Path.GetTempPath(), $"mp3streamer-itunes-{Guid.NewGuid():N}.xml");
            try
            {
                File.Copy(_xmlPath, tempCopy, overwrite: true);
            }
            catch (IOException ex)
            {
                // Most likely iTunes is mid-write. Leave the original alone;
                // the next event or the periodic check will retry.
                logger.LogWarning(ex, "Could not copy the iTunes Library XML (in use?); will retry on the next change");
                return;
            }

            await using var stream = new FileStream(tempCopy, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var scope = scopeFactory.CreateScope();
            var importer = scope.ServiceProvider.GetRequiredService<ItunesXmlImporter>();
            var result = await importer.ImportAsync(stream, removeMissing: true, ct);

            _lastSyncedWriteUtc = writeUtc;
            logger.LogInformation(
                "iTunes XML sync: {Imported} present, {Removed} removed, {Skipped} skipped",
                result.Imported, result.Removed, result.Skipped);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "iTunes XML sync failed");
        }
        finally
        {
            if (tempCopy is not null)
            {
                try { File.Delete(tempCopy); }
                catch (Exception ex) { logger.LogWarning(ex, "Could not delete temp iTunes XML copy {Path}", tempCopy); }
            }
            _syncLock.Release();
        }
    }

    public override void Dispose()
    {
        _watcher?.Dispose();
        _debounceTimer?.Dispose();
        _syncLock.Dispose();
        base.Dispose();
    }
}
