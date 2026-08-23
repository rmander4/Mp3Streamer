// Generates an iTunes-Library-XML-compatible file directly from a folder of
// MP3s, using the same TagLibSharp tag-reading the main app already relies
// on — no real iTunes involved. Built so Ryan and his brother can both use
// the ItunesXmlImporter.cs import path for consistency, without Ryan having
// to fight real iTunes (which was leaking 100+ GB of RAM on his machine for
// a library of well under 100 songs — see DEVLOG.md, 2026-08-22).
//
// Usage: dotnet run -- <music-folder> [output-xml-path]
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using TagLib.Id3v2;
using File = System.IO.File;

if (args.Length < 1)
{
    Console.WriteLine("Usage: dotnet run -- <music-folder> [output-xml-path]");
    return 1;
}

var musicFolder = Path.GetFullPath(args[0]);
var outputPath = args.Length > 1 ? Path.GetFullPath(args[1]) : Path.Combine(Directory.GetCurrentDirectory(), "iTunes Library.xml");

if (!Directory.Exists(musicFolder))
{
    Console.WriteLine($"Folder not found: {musicFolder}");
    return 1;
}

var mp3Files = Directory.EnumerateFiles(musicFolder, "*.mp3", SearchOption.AllDirectories).OrderBy(f => f).ToList();
Console.WriteLine($"Found {mp3Files.Count} MP3 file(s) under {musicFolder}");

var settings = new XmlWriterSettings { Indent = true, Encoding = new UTF8Encoding(false) };
using (var writer = XmlWriter.Create(outputPath, settings))
{
    writer.WriteStartDocument();
    writer.WriteDocType("plist", "-//Apple//DTD PLIST 1.0//EN", "http://www.apple.com/DTDs/PropertyList-1.0.dtd", null);
    writer.WriteStartElement("plist");
    writer.WriteAttributeString("version", "1.0");
    writer.WriteStartElement("dict");

    WriteKeyValue(writer, "Major Version", "1", "integer");
    WriteKeyValue(writer, "Minor Version", "1", "integer");
    WriteKeyValue(writer, "Application Version", "1.0 (Mp3Streamer generator)");
    WriteKeyValue(writer, "Date", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"), "date");

    writer.WriteElementString("key", "Tracks");
    writer.WriteStartElement("dict");

    var trackId = 1000;
    var written = 0;
    foreach (var path in mp3Files)
    {
        try
        {
            WriteTrack(writer, path, trackId);
            trackId++;
            written++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Skipping {path}: {ex.Message}");
        }
    }

    writer.WriteEndElement(); // Tracks dict
    writer.WriteEndElement(); // root dict
    writer.WriteEndElement(); // plist
    writer.WriteEndDocument();

    Console.WriteLine($"Wrote {written} track(s) to {outputPath}");
}

return 0;

static void WriteKeyValue(XmlWriter w, string key, string value, string type = "string")
{
    w.WriteElementString("key", key);
    w.WriteElementString(type, value);
}

// Real iTunes assigns a random Persistent ID; this derives a stable one
// from the file path instead, so re-running the generator later updates
// existing rows (matched via ItunesXmlImporter.cs's PersistentId lookup)
// rather than creating duplicates.
static string ToPersistentId(string path)
{
    var hash = SHA1.HashData(Encoding.UTF8.GetBytes(path.ToLowerInvariant()));
    return Convert.ToHexString(hash)[..16];
}

// Mirrors Services/RatingMapper.cs's byte<->star mapping — duplicated
// rather than referenced, since this is a standalone tool with no
// dependency on the main API project.
static int ByteToStars(byte value)
{
    if (value == 0) return 0;
    byte[] starToByte = [0, 1, 64, 128, 196, 255];
    var closest = 0;
    var closestDiff = int.MaxValue;
    for (var i = 0; i < starToByte.Length; i++)
    {
        var diff = Math.Abs(starToByte[i] - value);
        if (diff < closestDiff)
        {
            closestDiff = diff;
            closest = i;
        }
    }
    return closest;
}

static void WriteTrack(XmlWriter w, string path, int trackId)
{
    using var tagFile = TagLib.File.Create(path);
    var tag = tagFile.Tag;
    var props = tagFile.Properties;
    var info = new FileInfo(path);

    w.WriteElementString("key", trackId.ToString());
    w.WriteStartElement("dict");

    WriteKeyValue(w, "Track ID", trackId.ToString(), "integer");
    WriteKeyValue(w, "Persistent ID", ToPersistentId(path));
    WriteKeyValue(w, "Name", string.IsNullOrWhiteSpace(tag.Title) ? Path.GetFileNameWithoutExtension(path) : tag.Title);

    if (!string.IsNullOrWhiteSpace(tag.FirstPerformer))
        WriteKeyValue(w, "Artist", tag.FirstPerformer);

    var albumArtist = tag.FirstAlbumArtist;
    if (!string.IsNullOrWhiteSpace(albumArtist))
        WriteKeyValue(w, "Album Artist", albumArtist);

    if (!string.IsNullOrWhiteSpace(tag.Album))
        WriteKeyValue(w, "Album", tag.Album);

    if (!string.IsNullOrWhiteSpace(tag.FirstGenre))
        WriteKeyValue(w, "Genre", tag.FirstGenre);

    if (tag.Track > 0)
        WriteKeyValue(w, "Track Number", tag.Track.ToString(), "integer");

    if (tag.Year > 0)
        WriteKeyValue(w, "Year", tag.Year.ToString(), "integer");

    WriteKeyValue(w, "Total Time", ((int)props.Duration.TotalMilliseconds).ToString(), "integer");
    WriteKeyValue(w, "Size", info.Length.ToString(), "integer");

    if (tag.Pictures.Length > 0)
        WriteKeyValue(w, "Artwork Count", tag.Pictures.Length.ToString(), "integer");

    if (tagFile.GetTag(TagLib.TagTypes.Id3v2, false) is Tag id3v2)
    {
        var popm = PopularimeterFrame.Get(id3v2, string.Empty, false);
        if (popm is not null && popm.Rating > 0)
        {
            var stars = ByteToStars(popm.Rating);
            if (stars > 0)
                WriteKeyValue(w, "Rating", (stars * 20).ToString(), "integer");
        }
    }

    WriteKeyValue(w, "Location", new Uri(path).AbsoluteUri);

    w.WriteEndElement(); // track dict
}
