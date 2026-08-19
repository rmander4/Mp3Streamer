using Microsoft.EntityFrameworkCore;
using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Data;

public class LibraryDbContext(DbContextOptions<LibraryDbContext> options) : DbContext(options)
{
    public DbSet<Track> Tracks => Set<Track>();
    public DbSet<Playlist> Playlists => Set<Playlist>();
    public DbSet<PlaylistTrack> PlaylistTracks => Set<PlaylistTrack>();
    public DbSet<PlayHistoryEntry> PlayHistory => Set<PlayHistoryEntry>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Track>()
            .HasIndex(t => t.FilePath)
            .IsUnique();

        modelBuilder.Entity<AppSetting>()
            .HasKey(s => s.Key);

        modelBuilder.Entity<PlayHistoryEntry>()
            .HasOne(h => h.Track)
            .WithMany()
            .HasForeignKey(h => h.TrackId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PlayHistoryEntry>()
            .HasIndex(h => h.PlayedAtUtc);

        modelBuilder.Entity<PlaylistTrack>()
            .HasOne(pt => pt.Playlist)
            .WithMany(p => p.PlaylistTracks)
            .HasForeignKey(pt => pt.PlaylistId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PlaylistTrack>()
            .HasOne(pt => pt.Track)
            .WithMany(t => t.PlaylistTracks)
            .HasForeignKey(pt => pt.TrackId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
