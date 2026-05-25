"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { signInWithGoogleAction } from "@/app/actions/auth";

// Shared OAuth button used on /login and /signup. Posts to the
// signInWithGoogleAction server action which redirects to Google's
// consent screen. We pass `locale` so the action can build a
// locale-aware `next` URL for the post-OAuth landing.
export function GoogleSignInButton({
  locale,
  label,
}: {
  locale: "fr" | "en";
  label: string;
}) {
  return (
    <form action={signInWithGoogleAction}>
      <input type="hidden" name="locale" value={locale} />
      <SubmitButton label={label} />
    </form>
  );
}

// Pulled into its own component so useFormStatus can see the form
// context (the hook only works inside a <form action={...}>).
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="lg"
      className="w-full gap-3"
      disabled={pending}
    >
      <GoogleLogo className="size-5" aria-hidden />
      {label}
    </Button>
  );
}

// Inline Google "G" mark using Google's official brand colors. Kept
// in-file (rather than a public SVG file) so dark-mode + sizing flow
// from the parent without extra wiring.
function GoogleLogo({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
