"use client";

import { useRef, useState, useTransition } from "react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";

// Choosing a picture for a thing — a person, or a client.
//
// EXTRACTED, NOT COPIED. This markup lived inside the profile page's
// PictureSection and nowhere else, so when the founder asked for client
// pictures ("theres no way for a client to upload a pfp or even the accountant.
// Its a redudant circle") the tempting move was to paste it into the client
// form and trim it. That is precisely the drift CLAUDE.md's cohesion rule names:
// two copies that are identical the day they are written, and silently diverge
// the first time one is touched. Restyling "pick a picture" must be ONE edit.
//
// What it deliberately does NOT own: the server call. The two surfaces write to
// different columns through different actions with different permission gates
// (your own profile versus clients.manage on someone else's record), so the
// caller passes `onUpload` / `onRemove` and this component owns only the
// interaction — pick, preview, uploading state, error, remove.
//
// The accepted MIME list is duplicated from the server's allow-list on purpose:
// this one is a file-picker HINT and the server's is the ACTUAL gate. They are
// allowed to disagree in the safe direction — the picker being narrower than
// the validator only ever means a nicer dialog.
export type AvatarPickerResult = { ok: boolean; signedUrl?: string | null };

export function AvatarPicker({
  currentUrl,
  name,
  size = 64,
  color,
  onUpload,
  onRemove,
  labels,
  className,
}: {
  currentUrl?: string | null;
  /** Drives the initials fallback when there is no picture. */
  name: string;
  size?: number;
  color?: string;
  onUpload: (fd: FormData) => Promise<AvatarPickerResult>;
  onRemove: () => Promise<AvatarPickerResult>;
  labels: {
    change: string;
    uploading: string;
    remove: string;
    /** Turns a server error code into a sentence. */
    error: (code: string) => string;
  };
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await onUpload(fd);
      if (!res.ok) {
        setError(labels.error("upload_failed"));
        return;
      }
      if (res.signedUrl) setPreview(res.signedUrl);
    });
    // Clear the input so picking the SAME file again still fires a change —
    // the common case after a failed upload is retrying the identical file.
    e.target.value = "";
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await onRemove();
      if (!res.ok) {
        setError(labels.error("save_failed"));
        return;
      }
      setPreview(null);
    });
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-4">
        <AvatarInitials
          src={preview ?? undefined}
          name={name}
          size={size}
          color={color}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            {pending ? labels.uploading : labels.change}
          </Button>
          {preview && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={pending}
            >
              {labels.remove}
            </Button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={onChange}
        />
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}
