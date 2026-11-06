import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import type { ProjectPhotoRow } from "@/types/database";

async function SignedThumb({
  path,
  alt,
}: {
  path: string;
  alt: string;
}) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("project-photos")
    .createSignedUrl(path, 60 * 60);

  if (error !== null || data === null) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-xs text-zinc-500">
        Unable to load image
      </div>
    );
  }

  return (
    <div className="relative h-40 w-full overflow-hidden rounded-md border border-zinc-800 bg-black">
      <Image
        src={data.signedUrl}
        alt={alt}
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, 33vw"
        unoptimized
      />
    </div>
  );
}

export async function ProjectPhotoGallery({ photos }: { photos: ProjectPhotoRow[] }) {
  if (photos.length === 0) {
    return <div className="text-sm text-zinc-500">No photos yet.</div>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {photos.map((photo) => (
        <div key={photo.id} className="space-y-2">
          <SignedThumb path={photo.photo_url} alt={photo.caption ?? "Project photo"} />
          {photo.caption !== null && photo.caption.length > 0 ? (
            <div className="text-sm text-zinc-300">{photo.caption}</div>
          ) : null}
          <div className="text-xs text-zinc-500">{formatDateTime(photo.created_at)}</div>
        </div>
      ))}
    </div>
  );
}
