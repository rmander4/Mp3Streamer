using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mp3Streamer.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTrackIsMissing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsMissing",
                table: "Tracks",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsMissing",
                table: "Tracks");
        }
    }
}
