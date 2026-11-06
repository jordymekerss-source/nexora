"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { sanitizeFilename } from "@/lib/validation";

type Props = {
  projectId: string;
  tenantId: string;
  userId: string;
};

export function ProjectPhotoUploader({ projectId, tenantId, userId }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("photo") as HTMLInputElement | null;
    const captionInput = form.elements.namedItem("caption") as HTMLTextAreaElement | null;

    const file = fileInput?.files?.[0];
    if (file === undefined) {
      setStatus("error");
      setMessage("Choose a photo to upload.");
      return;
    }

    setStatus("uploading");
    setMessage("");

    const safeName = sanitizeFilename(file.name);
    const objectPath = `${tenantId}/${projectId}/${userId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("project-photos")
      .upload(objectPath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type.length > 0 ? file.type : "application/octet-stream",
      });

    if (uploadError !== null) {
      setStatus("error");
      setMessage(uploadError.message);
      return;
    }

    const caption = captionInput?.value.trim();
    const { error: insertError } = await supabase.from("project_photos").insert({
      tenant_id: tenantId,
      project_id: projectId,
      user_id: userId,
      photo_url: objectPath,
      caption: caption !== undefined && caption.length > 0 ? caption : null,
    });

    if (insertError !== null) {
      await supabase.storage.from("project-photos").remove([objectPath]);
      setStatus("error");
      setMessage(insertError.message);
      return;
    }

    setStatus("done");
    setMessage("Photo uploaded.");
    form.reset();
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus("error");
      setMessage("Max file size is 10MB.");
      return;
    }
    setStatus("idle");
    setMessage("");
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <Input name="photo" type="file" accept="image/*" label="Photo" onChange={onFileChange} />
      <Textarea name="caption" label="Caption (optional)" rows={3} />
      <Button type="submit" disabled={status === "uploading"}>
        {status === "uploading" ? "Uploading…" : "Upload"}
      </Button>
      {message.length > 0 ? (
        <div
          className={
            status === "error"
              ? "text-sm text-red-300"
              : "text-sm text-emerald-300"
          }
        >
          {message}
        </div>
      ) : null}
    </form>
  );
}
