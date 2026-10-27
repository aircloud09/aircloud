import type { Locale as DateFnsLocale } from "date-fns";
import { es, ko, ptBR } from "date-fns/locale";
import type { Locale } from "./index";

// English uses the date-fns default, so it has no entry.
const dateFnsLocales: Partial<Record<Locale, DateFnsLocale>> = {
  "pt-BR": ptBR,
  es,
  ko,
};

/** date-fns locale for relative times such as "3 minutes ago". */
export function dateFnsLocaleFor(language: Locale): DateFnsLocale | undefined {
  return dateFnsLocales[language];
}
