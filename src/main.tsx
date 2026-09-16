import React from "react";
import ReactDOM from "react-dom/client";
// Registers the interface language before anything renders (ADR-0004).
import "./i18n";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
