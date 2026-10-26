import { ptPT, type Dictionary } from "./pt-PT";

export const LOCALES = ["pt-PT", "pt-BR", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

// Idiomas com tradução disponível. Os restantes recorrem ao pt-PT até serem traduzidos.
const dictionaries: Partial<Record<Locale, Dictionary>> = {
  "pt-PT": ptPT,
};

export function getDictionary(locale: Locale = "pt-PT"): Dictionary {
  return dictionaries[locale] ?? ptPT;
}

/** Dicionário por defeito (a interface está, nesta fase, em pt-PT). */
export const t = getDictionary("pt-PT");
