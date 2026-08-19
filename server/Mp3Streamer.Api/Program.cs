using Microsoft.EntityFrameworkCore;
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

// No-ops when run normally (dotnet run, console); wires up proper start/stop
// lifecycle handling with the Service Control Manager when actually running
// as a Windows Service, so the same published exe works both ways.
builder.Host.UseWindowsService();

builder.Services.AddOpenApi();

builder.Services.AddDbContext<LibraryDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Library")));

builder.Services.AddScoped<LibraryScanner>();
builder.Services.AddHostedService<LibraryWatcherService>();

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

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/api/library/scan", async (LibraryScanner scanner, CancellationToken ct) =>
{
    var result = await scanner.ScanAsync(ct);
    return Results.Ok(result);
});

app.MapLibraryEndpoints();
app.MapPlaylistEndpoints();
app.MapHistoryEndpoints();

app.Run();
