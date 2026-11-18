/* eslint-disable @next/next/no-img-element */
import type { QuizMedia } from "@/lib/db/schema";
import { cn } from "@/lib/cn";

// Files moved over from the PHP site keep their plain names and live under /uploads/quiz;
// newer ones are full web addresses on a host listed in MEDIA_HOSTS (see lib/quiz/media.ts)
export const mediaSrc = (media: QuizMedia) => (/^https?:\/\//.test(media.src) ? media.src : `/uploads/quiz/${media.src}`);

// A question's picture or video
export function MediaView({ media, className, autoPlay = false }: { media?: QuizMedia | null; className?: string; autoPlay?: boolean }) {
  if (!media) return null;
  return (
    <div className={cn("overflow-hidden border border-line bg-studio-deep", className)}>
      {media.type === "video" ? (
        <video src={mediaSrc(media)} playsInline controls autoPlay={autoPlay} muted={autoPlay} className="max-h-[42vh] w-full" />
      ) : (
        <img src={mediaSrc(media)} alt="Picture for this question" className="max-h-[42vh] w-full object-contain" />
      )}
    </div>
  );
}
