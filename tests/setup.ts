import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's automatic per-test cleanup only self-registers when it
// detects Jest-style globals; this project's vitest config does not set
// `test.globals: true`, so cleanup() must be wired explicitly or every render()
// across a test file accumulates in the same jsdom document (causing false
// "multiple elements found" failures in later tests within a file).
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia; several components/CSS rely on it
// indirectly through libraries that feature-detect it. Stub it so component
// tests don't crash on import.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
