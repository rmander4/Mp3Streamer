namespace Mp3Streamer.Api.Models;

// Small generic key/value store for simple app-wide settings (e.g. whether
// play history tracking is enabled) that don't warrant their own dedicated
// table or a config-file round-trip. Not tied to any one track/playlist.
public class AppSetting
{
    public required string Key { get; set; }
    public required string Value { get; set; }
}
