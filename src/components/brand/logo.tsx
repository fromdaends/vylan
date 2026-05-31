import Image from "next/image";
import { brand } from "@/lib/brand";

type LogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
};

// Brand mark — the firm's blue "V". A single transparent PNG (the white
// background keyed out of the source art) so the same mark sits cleanly on both
// the light surfaces and the pitch-black dark mode.
export function Logo({ size = 28, className, priority = false }: LogoProps) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center justify-center " + (className ?? "")
      }
      style={{ width: size, height: size }}
    >
      <Image
        src="/logo-v.png"
        alt={`${brand.name} logo`}
        width={size}
        height={size}
        priority={priority}
        className="block h-full w-full object-contain"
      />
    </span>
  );
}
