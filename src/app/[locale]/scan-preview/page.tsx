// TEMPORARY dev-only harness for eyeballing the camera scanner outside the
// token-gated portal. DELETE BEFORE COMMITTING.
"use client";

import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { CameraCapture } from "@/components/portal/camera-capture";
import en from "../../../../messages/en.json";

export default function ScanPreviewPage() {
  const [open, setOpen] = useState(false);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <div className="p-10">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Open scanner
        </button>
        {open && (
          <CameraCapture
            onClose={() => setOpen(false)}
            onCapture={(f) => console.log("captured", f.name, f.size)}
            onChooseFile={() => console.log("fallback to file picker")}
          />
        )}
      </div>
    </NextIntlClientProvider>
  );
}
