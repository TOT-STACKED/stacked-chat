export interface VideoInfo { type: 'youtube' | 'vimeo' | 'mp4'; yt_id: string | null; thumbnail: string }

/** What the chat needs to show a video. Mirrors the legacy rules (YouTube gets a thumbnail; anything else plays as a file). */
export function describeVideoUrl(url: string): VideoInfo {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/.exec(url);
  if (yt) return { type: 'youtube', yt_id: yt[1]!, thumbnail: `https://img.youtube.com/vi/${yt[1]}/mqdefault.jpg` };
  if (/vimeo\.com\//.test(url)) return { type: 'vimeo', yt_id: null, thumbnail: '' };
  return { type: 'mp4', yt_id: null, thumbnail: '' };
}

/** Only web links are accepted for videos (never javascript:, data:, file: and so on). */
export const isHttpUrl = (s: string) => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };
