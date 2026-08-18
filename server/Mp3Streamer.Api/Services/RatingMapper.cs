namespace Mp3Streamer.Api.Services;

/// <summary>
/// Maps a 0-5 star rating to/from the ID3v2 POPM "Rating" byte (0-255), using
/// the de facto Windows Media Player scale that most other players also honor.
/// </summary>
public static class RatingMapper
{
    private static readonly byte[] StarToByte = [0, 1, 64, 128, 196, 255];

    public static byte StarsToByte(int stars) => StarToByte[Math.Clamp(stars, 0, 5)];

    public static int ByteToStars(byte value)
    {
        if (value == 0) return 0;

        var closest = 0;
        var closestDiff = int.MaxValue;
        for (var i = 0; i < StarToByte.Length; i++)
        {
            var diff = Math.Abs(StarToByte[i] - value);
            if (diff < closestDiff)
            {
                closestDiff = diff;
                closest = i;
            }
        }
        return closest;
    }
}
