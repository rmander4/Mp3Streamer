namespace Mp3Streamer.Api.Services;

/// <summary>
/// Watches the configured library root paths for filesystem changes and
/// rescans when something changes, instead of polling on a fixed interval.
/// Also runs one scan immediately on startup, covering the initial load.
///
/// Periodically re-checks that each watcher is still actually connected
/// (the underlying handle can go stale silently, e.g. a network share or
/// external drive dropping and coming back) and reconnects it if not.
/// </summary>
public class LibraryWatcherService(
    IServiceScopeFactory scopeFactory,
    IConfiguration config,
    ILogger<LibraryWatcherService> logger) : BackgroundService
{
    // Coalesces bursts of filesystem events (e.g. dropping in a whole album's
    // worth of files) into a single rescan instead of one per file.
    private static readonly TimeSpan DebounceDelay = TimeSpan.FromSeconds(2);

    // How often to verify each watcher is still alive and reconnect if not.
    private static readonly TimeSpan HealthCheckInterval = TimeSpan.FromMinutes(1);

    private readonly Dictionary<string, FileSystemWatcher> _watchers = [];
    private readonly HashSet<string> _unhealthyRoots = [];
    private readonly object _watchersLock = new();
    private readonly SemaphoreSlim _scanLock = new(1, 1);
    private Timer? _debounceTimer;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunScanAsync(stoppingToken);

        foreach (var root in GetConfiguredRoots())
        {
            lock (_watchersLock)
            {
                if (Directory.Exists(root))
                {
                    StartWatcher(root);
                }
                else
                {
                    logger.LogWarning("Library root path does not exist, not watching yet: {Root}", root);
                }
            }
        }

        using var healthTimer = new PeriodicTimer(HealthCheckInterval);
        try
        {
            while (await healthTimer.WaitForNextTickAsync(stoppingToken))
            {
                CheckWatcherHealth();
            }
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
    }

    private List<string> GetConfiguredRoots() =>
        (config.GetSection("LibraryRootPaths").Get<string[]>() ?? [])
            .Select(Path.GetFullPath)
            .ToList();

    private void CheckWatcherHealth()
    {
        foreach (var root in GetConfiguredRoots())
        {
            lock (_watchersLock)
            {
                var hasWatcher = _watchers.TryGetValue(root, out var watcher);
                var exists = Directory.Exists(root);

                if (!exists)
                {
                    if (hasWatcher)
                    {
                        logger.LogWarning("Library root path no longer exists, stopping watcher: {Root}", root);
                        watcher!.Dispose();
                        _watchers.Remove(root);
                    }
                    _unhealthyRoots.Remove(root);
                    continue;
                }

                var needsReconnect = !hasWatcher || _unhealthyRoots.Contains(root) || !watcher!.EnableRaisingEvents;
                if (!needsReconnect)
                    continue;

                logger.LogInformation(hasWatcher
                    ? "Library folder watcher for {Root} looks disconnected, reconnecting"
                    : "Library root path now available, starting watcher: {Root}", root);

                if (hasWatcher)
                {
                    watcher!.Dispose();
                    _watchers.Remove(root);
                }
                _unhealthyRoots.Remove(root);

                StartWatcher(root);
            }

            // Catch up on anything that may have changed while disconnected.
            ScheduleScan();
        }
    }

    // Must be called with _watchersLock held.
    private void StartWatcher(string root)
    {
        var watcher = new FileSystemWatcher(root)
        {
            IncludeSubdirectories = true,
            Filter = "*.mp3",
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
            // Default (8KB) can overflow — and silently drop events — during
            // a large bulk change (e.g. adding several new artists' worth of
            // albums at once). 64KB is the practical max Windows honors.
            InternalBufferSize = 64 * 1024
        };
        watcher.Created += OnLibraryChanged;
        watcher.Deleted += OnLibraryChanged;
        watcher.Changed += OnLibraryChanged;
        watcher.Renamed += OnLibraryChanged;
        watcher.Error += (_, e) => OnWatcherError(root, e);
        watcher.EnableRaisingEvents = true;
        _watchers[root] = watcher;

        logger.LogInformation("Watching library root for changes: {Root}", root);
    }

    private void OnLibraryChanged(object sender, FileSystemEventArgs e) => ScheduleScan();

    private void OnWatcherError(string root, ErrorEventArgs e)
    {
        // Most commonly an internal buffer overflow when too many changes
        // happen at once (e.g. copying a huge library) — the watcher can
        // silently drop events after this. Flag it so the next health check
        // reconnects it, and rescan now to resync in the meantime.
        logger.LogWarning(e.GetException(), "Library folder watcher error on {Root}, will reconnect on next health check", root);
        lock (_watchersLock)
        {
            _unhealthyRoots.Add(root);
        }
        ScheduleScan();
    }

    private void ScheduleScan()
    {
        _debounceTimer ??= new Timer(_ => _ = RunScanAsync(CancellationToken.None));
        _debounceTimer.Change(DebounceDelay, Timeout.InfiniteTimeSpan);
    }

    private async Task RunScanAsync(CancellationToken ct)
    {
        // If a scan is already running, skip rather than queue — any change
        // that arrives during it will re-arm the debounce timer and trigger
        // another scan afterward, so nothing gets lost.
        if (!await _scanLock.WaitAsync(0, ct))
            return;

        try
        {
            using var scope = scopeFactory.CreateScope();
            var scanner = scope.ServiceProvider.GetRequiredService<LibraryScanner>();
            var result = await scanner.ScanAsync(ct);
            logger.LogInformation(
                "Library scan: {Added} added, {Updated} updated, {Removed} removed",
                result.Added, result.Updated, result.Removed);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Never let a scan failure take down the whole host —
            // BackgroundService's default behavior on an unhandled exception
            // is to stop the entire app, which would be disproportionate here.
            logger.LogError(ex, "Library scan failed");
        }
        finally
        {
            _scanLock.Release();
        }
    }

    public override void Dispose()
    {
        lock (_watchersLock)
        {
            foreach (var watcher in _watchers.Values)
                watcher.Dispose();
            _watchers.Clear();
        }
        _debounceTimer?.Dispose();
        _scanLock.Dispose();
        base.Dispose();
    }
}
