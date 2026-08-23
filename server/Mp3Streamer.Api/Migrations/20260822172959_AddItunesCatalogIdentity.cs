using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mp3Streamer.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddItunesCatalogIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CatalogSource",
                table: "Tracks",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PersistentId",
                table: "Tracks",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CatalogSource",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "PersistentId",
                table: "Tracks");
        }
    }
}
