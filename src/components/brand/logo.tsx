import Image from "next/image";
import { brand } from "@/lib/brand";

type LogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
};

// Theme-aware brand mark. The light SVG (cream/silver rings, white planet)
// is shown in light mode; the dark SVG (gold ring, slate planet) takes over
// in dark mode. Both ship as static SVGs in /public so they're cached at
// the CDN edge and never hit Sharp.
export function Logo({ size = 28, className, priority = false }: LogoProps) {
  const alt = `${brand.name} logo`;
  return (
    <span
      className={
        "inline-flex shrink-0 items-center justify-center " + (className ?? "")
      }
      style={{ width: size, height: size }}
      aria-hidden={false}
    >
      <Image
        src="/logo-light.svg"
        alt={alt}
        width={size}
        height={size}
        priority={priority}
        className="block dark:hidden"
      />
      <Image
        src="/logo-dark.svg"
        alt=""
        width={size}
        height={size}
        priority={priority}
        className="hidden dark:block"
      />
    </span>
  );
}
