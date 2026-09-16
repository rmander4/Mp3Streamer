using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mp3Streamer.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTrackFileModifiedUtc : Migration
    {
        // NOTE: `dotnet ef migrations add` also emitted a redundant
        // CreateTable("PlaybackState") here — the same known model-snapshot
        // false positive documented in Program.cs and DEVLOG 2026-08-23
        // (PlaybackState already exists on every database). Removed by hand;
        // this migration only adds the one new column.

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "FileModifiedUtc",
                table: "Tracks",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FileModifiedUtc",
                table: "Tracks");
        }
    }
}
