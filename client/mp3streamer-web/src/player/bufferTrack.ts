import type { Track } from '../api/types';
import { streamUrl } from '../api/client';

// How much of a track to pre-buffer into memory before starting playback:
// the whole file for anything shorter than this, otherwise just this many
// seconds' worth as a cushion against a temporary connection drop. Beyond
// that cushion, playback hands off to normal network streaming (see the
// handoff logic in NowPlayingBar) — the resumed portion is streamed and
// still relies on the connection being back by the time it's reached, per
// the trade-off Ryan asked for.
const BUFFER_CAP_SECONDS = 300;

export interface BufferedTrack {
  blobUrl: string;
  // True if only a leading portion of the track was buffered (it was
  // longer than BUFFER_CAP_SECONDS), meaning playback will need to hand
  // off to live streaming partway through.
  isPartial: boolean;
  // How many seconds of actual playable audio the blob is expected to
  // contain. NOT the same as what the <audio> element's own `.duration`
  // will report once it loads the blob — mp3s commonly carry a VBR header
  // (e.g. Xing) declaring the *original* file's total duration, which the
  // browser reports even for a truncated blob that only physically
  // contains the first slice of frames. Callers must use this value, not
  // audio.duration, to know when the buffered portion is about to run out.
  bufferedSeconds: number;
}

// A 1-byte range request is a cheap way to learn the file's total size from
// the Content-Range response header, without a HEAD request (the /stream
// endpoint only maps GET) and without downloading the file twice.
async function getTotalBytes(url: string, signal?: AbortSignal): Promise<number | null> {
  const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal });
  const contentRange = res.headers.get('Content-Range');
  await res.arrayBuffer(); // drain the 1-byte body
  const total = contentRange ? Number(contentRange.split('/')[1]) : NaN;
  return Number.isFinite(total) ? total : null;
}

export async function bufferTrack(track: Track, signal?: AbortSignal): Promise<BufferedTrack> {
  const url = streamUrl(track.id);
  const duration = track.durationSeconds;

  let rangeHeader: string | undefined;
  let isPartial = false;
  let bufferedSeconds = duration;

  if (duration > BUFFER_CAP_SECONDS) {
    const totalBytes = await getTotalBytes(url, signal);
    if (totalBytes) {
      // Average bitrate estimate (works fine for CBR; a reasonable
      // approximation for VBR too — this only needs to be close, not exact,
      // since the handoff logic that consumes bufferedSeconds leaves its
      // own safety margin).
      const targetBytes = Math.min(totalBytes, Math.ceil(totalBytes * (BUFFER_CAP_SECONDS / duration)));
      if (targetBytes < totalBytes) {
        rangeHeader = `bytes=0-${targetBytes - 1}`;
        isPartial = true;
        bufferedSeconds = BUFFER_CAP_SECONDS;
      }
    }
  }

  const res = await fetch(url, { signal, headers: rangeHeader ? { Range: rangeHeader } : undefined });
  const blob = await res.blob();
  return { blobUrl: URL.createObjectURL(blob), isPartial, bufferedSeconds };
}
