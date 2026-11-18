import type { QuizMedia } from "@/lib/db/schema";

// Pictures and videos on questions. Only files QuizoTab stored itself are accepted, so a quiz
// can't be used to show (or track people with) a file from somewhere else on the internet.

export const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const MEDIA_MAX_BYTES = { image: 10 << 20, video: 35 << 20 } as const;

const EXTENSIONS = /\.(jpg|png|gif|webp|mp4|webm|mov)$/;
const isVideo = (src: string) => /\.(mp4|webm|mov)$/.test(src);

// Where uploaded files live. MEDIA_HOSTS is a comma-separated list of host names (set once file
// uploads are switched on), e.g. "abc123.public.blob.vercel-storage.com".
function allowedHosts() {
  return (process.env.MEDIA_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
}

// The media as it should be stored, or null if it isn't one of ours
export function mediaAllowed(media: QuizMedia): QuizMedia | null {
  const src = media.src;
  if (!EXTENSIONS.test(src)) return null;
  const type = isVideo(src) ? "video" : "image";

  // Files moved over from the PHP site's uploads/quiz folder keep their plain names
  if (/^[0-9a-f]{32}\.[a-z0-9]+$/.test(src)) return { type, src };

  try {
    const url = new URL(src);
    if (url.protocol === "https:" && allowedHosts().includes(url.hostname.toLowerCase())) return { type, src: url.toString() };
  } catch {
    // Not a web address
  }
  return null;
}
