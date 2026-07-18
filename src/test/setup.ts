// Vitest + Testing Library setup, loaded once per test file via
// vite.config.ts `test.setupFiles`.
import "@testing-library/jest-dom/vitest";

// Mantine's provider touches `window.matchMedia` (color-scheme / viewport
// detection) which jsdom does not implement. Stub it so component tests
// don't need to know about this internal.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Mantine's autosize Textarea listens for `document.fonts` "loadingdone" to
// recalculate height once web fonts load. jsdom does not implement the
// FontFaceSet API at all (`document.fonts` is undefined), which crashes the
// component on mount. Stub the minimal shape it needs.
if (typeof document !== "undefined" && !document.fonts) {
  Object.defineProperty(document, "fonts", {
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  });
}
