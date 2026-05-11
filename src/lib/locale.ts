import { hasLocale } from "next-intl";
import { routing, type AppLocale } from "@/i18n/routing";

export function assertLocale(value: string): AppLocale {
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}
