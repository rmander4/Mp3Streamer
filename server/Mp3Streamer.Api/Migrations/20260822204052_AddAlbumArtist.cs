using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mp3Streamer.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAlbumArtist : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AlbumArtist",
                table: "Tracks",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AlbumArtist",
                table: "Tracks");
        }
    }
}
