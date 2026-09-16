using Mp3Streamer.Api.Models;

namespace Mp3Streamer.Api.Services;

/// <summary>
/// Copies the metadata we care about out of a file's ID3 tags onto a
/// <see cref="Track"/> row. Shared by the filesystem scanner
/// (<see cref="LibraryScanner"/>) and the on-access refresher
/// (<see cref="TrackMetadataRefresher"/>) so the file stays the single
/// source of truth for these fields — an edit made in any external tag
/// editor lands the same way whether the scanner or a stream request
/// notices it first.
/// </summary>
public static class TrackTagMapper
{
    public static void Apply(Track track, TagLib.File tagFile, FileInfo fileInfo)
    {
        var tag = tagFile.Tag;

        track.Title = string.IsNullOrWhiteSpace(tag.Title)
            ? Path.GetFileNameWithoutExtension(track.FilePath)
            : tag.Title;
        track.Artist = tag.FirstPerformer;
        track.AlbumArtist = tag.FirstAlbumArtist ?? tag.FirstPerformer;
        track.Album = tag.Album;
        track.Genre = tag.FirstGenre;
        track.TrackNumber = tag.Track == 0 ? null : (int)tag.Track;
        track.Year = tag.Year == 0 ? null : (int)tag.Year;
        track.DurationSeconds = tagFile.Properties?.Duration.TotalSeconds ?? track.DurationSeconds;
        track.FileSizeBytes = fileInfo.Length;
        track.HasEmbeddedArt = tag.Pictures.Length > 0;
        track.Rating = ReadRating(tagFile);
    }

    public static int ReadRating(TagLib.File tagFile)
    {
        if (tagFile.GetTag(TagLib.TagTypes.Id3v2) is not TagLib.Id3v2.Tag id3v2)
            return 0;

        var popm = id3v2.GetFrames<TagLib.Id3v2.PopularimeterFrame>().FirstOrDefault();
        return popm is null ? 0 : RatingMapper.ByteToStars(popm.Rating);
    }
}
