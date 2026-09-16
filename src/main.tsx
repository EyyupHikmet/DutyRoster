import React from "react";
import ReactDOM from "react-dom/client";
// Registers the interface language before anything renders (ADR-0004).
import { i18n } from "./i18n";
import { getLanguage } from "./db";
import App from "./App";

// The saved language is applied BEFORE the first paint, so an English
// installation never flashes Turkish on the way in. A database that cannot be
// read is not a reason to refuse to start: the app opens in Turkish, the
// default, and says so through its own error handling.
async function start() {
  try {
    const saved = await getLanguage();
    if (saved && saved !== i18n.language) await i18n.changeLanguage(saved);
  } catch (err) {
    console.error("Could not read the saved language:", err);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start();
