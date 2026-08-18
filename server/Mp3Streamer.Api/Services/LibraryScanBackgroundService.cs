namespace Mp3Streamer.Api.Services;

/// <summary>
/// Periodically rescans the library so new/changed/removed files are picked
/// up without needing a manual POST /api/library/scan. Also covers the
/// "scan on startup" case, since the first scan runs immediately.
/// </summary>
public class LibraryScanBackgroundService(
    IServiceScopeFactory scopeFactory,
    IConfiguration config,
    ILogger<LibraryScanBackgroundService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var scanner = scope.ServiceProvider.GetRequiredService<LibraryScanner>();
                var result = await scanner.ScanAsync(stoppingToken);
                logger.LogInformation(
                    "Background library scan: {Added} added, {Updated} updated, {Removed} removed",
                    result.Added, result.Updated, result.Removed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Never let a scan failure (or bad config, below) take down the whole host —
                // BackgroundService's default behavior on an unhandled exception is to stop
                // the entire app, which would be a wildly disproportionate outcome here.
                logger.LogError(ex, "Background library scan failed");
            }

            var interval = GetConfiguredInterval();
            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private TimeSpan GetConfiguredInterval()
    {
        const double defaultMinutes = 5;
        try
        {
            var minutes = config.GetValue("LibraryScanIntervalMinutes", defaultMinutes);
            return TimeSpan.FromMinutes(Math.Max(minutes, 0.1));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Invalid LibraryScanIntervalMinutes config value, defaulting to {Minutes} minutes", defaultMinutes);
            return TimeSpan.FromMinutes(defaultMinutes);
        }
    }
}
