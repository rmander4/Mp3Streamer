using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Http.Features;
using Mp3Streamer.Api.Data;
using Mp3Streamer.Api.Endpoints;
using Mp3Streamer.Api.Services;

// Windows Services start with the working directory set to
// %SystemRoot%\System32, not the exe's own folder — pin ContentRootPath to
// the exe's actual location so appsettings.json/wwwroot resolve correctly
// no matter how (or from where) this gets launched.
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
});

builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 1024L * 1024 * 1024;
});
builder.Services.AddAntiforgery();
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 1024L * 1024 * 1024;
});

// No-ops when run normally (dotnet run, console); wires up proper start/stop
// lifecycle handling with the Service Control Manager when actually running
// as a Windows Service, so the same published exe works both ways.
builder.Host.UseWindowsService();

builder.Services.AddOpenApi();

builder.Services.AddDbContext<LibraryDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Library"))
        // The merged migration history (Ryan's PlaybackState migration +
        // Earthwormzim's iTunes-identity/AlbumArtist migrations, landed via
        // a real 3-way git merge) leaves EF's strict model/snapshot parity
        // check believing there's drift, even though every migration in
        // the chain applies cleanly and the resulting schema is correct —
        // confirmed by generating the "fix" it proposes and finding it's
        // just a redundant CreateTable for a table that already exists.
        // Suppressed per EF's own guidance rather than accepting that
        // migration, which would crash on any database where PlaybackState
        // already exists. TODO: pin down the exact snapshot discrepancy
        // and remove this suppression.
        .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));

builder.Services.AddScoped<LibraryScanner>();
builder.Services.AddScoped<ItunesXmlImporter>();
builder.Services.AddHostedService<LibraryWatcherService>();
builder.Services.AddHttpClient();

builder.Services.AddCors(options =>
{
    options.AddPolicy("DevClient", policy =>
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod());
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<LibraryDbContext>();
    db.Database.Migrate();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseCors("DevClient");
}

app.UseAntiforgery();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Without any explicit Cache-Control, ASP.NET Core's default static
    // file handling only sends ETag/Last-Modified — which lets browsers
    // apply their own heuristic caching, and heuristics can decide a page
    // is "fresh" for a long time with zero revalidation. For index.html
    // specifically that's a real problem: after every redeploy it embeds
    // a *new* content-hashed JS/CSS filename, but a browser sitting on a
    // heuristically-cached copy of the old index.html would keep loading
    // the old bundle indefinitely, with no visible sign anything's wrong
    // — confirmed by reproduction (missing Cache-Control on this exact
    // path), and very plausibly the real cause behind several "I tested
    // and it's still broken" reports this session that turned out to
    // actually be fixed server-side already.
    //
    // The content-hashed /assets/* files Vite builds are the opposite
    // case — their filename itself changes whenever their content does,
    // so they're safe to cache aggressively and permanently.
    OnPrepareResponse = ctx =>
    {
        var path = ctx.File.PhysicalPath ?? string.Empty;
        var isHashedAsset = path.Replace('\\', '/').Contains("/assets/");
        ctx.Context.Response.Headers.CacheControl = isHashedAsset
            ? "public,max-age=31536000,immutable"
            : "no-cache";
    },
});

app.MapPost("/api/library/scan", async (LibraryScanner scanner, CancellationToken ct) =>
{
    var result = await scanner.ScanAsync(ct);
    return Results.Ok(result);
});

app.MapPost("/api/library/import-itunes", async (
    IFormFile file,
    ItunesXmlImporter importer,
    CancellationToken ct) =>
{
    if (file.Length == 0 || !Path.GetExtension(file.FileName).Equals(".xml", StringComparison.OrdinalIgnoreCase))
        return Results.BadRequest("Choose an iTunes XML file.");

    await using var stream = file.OpenReadStream();
    var result = await importer.ImportAsync(stream, ct);
    return Results.Ok(result);
}).DisableAntiforgery();

app.MapLibraryEndpoints();
app.MapPlaylistEndpoints();
app.MapHistoryEndpoints();
app.MapPlaybackStateEndpoints();

app.Run();
