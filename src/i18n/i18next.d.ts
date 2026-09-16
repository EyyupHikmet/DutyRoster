import "i18next";
import { tr } from "./locales/tr";

// The Turkish locale is the shape of the interface's vocabulary: t() accepts a
// key only if tr.ts has it, so a typo or a forgotten key is a type error rather
// than a raw "step3.approve" on screen.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof tr };
  }
}
