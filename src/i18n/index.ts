import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { tr } from "./locales/tr";
import { en } from "./locales/en";

/** The languages the interface offers, Turkish first. */
export const LANGUAGES = ["tr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "tr";

// One bundle, loaded at build time: the app is offline, so there is nothing to
// fetch and no detection to do. The saved preference is applied by the app.
i18next.use(initReactI18next).init({
  resources: { tr: { translation: tr }, en: { translation: en } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export const i18n = i18next;

/** Looks up a string in the active language. */
export const t = i18next.t.bind(i18next);
