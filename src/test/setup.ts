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

// Mantine's SegmentedControl positions its sliding indicator with a
// ResizeObserver, which jsdom does not implement. A no-op is enough: the
// indicator is decoration, and every test here asserts on the control's value
// and its rendered options, never on where the highlight sits.
if (typeof globalThis !== "undefined" && !("ResizeObserver" in globalThis)) {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    NoopResizeObserver as unknown as typeof globalThis.ResizeObserver;
}

// Mantine's Combobox scrolls the selected option into view when a Select opens
// with a value already chosen. jsdom does not implement `scrollIntoView`, and
// the call happens in an effect, so the TypeError escapes the test as an
// UNHANDLED error — every assertion passes and `vitest run` still exits 1. A
// no-op is enough: no test asserts on scroll position.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
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
