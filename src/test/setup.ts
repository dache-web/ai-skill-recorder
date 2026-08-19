import '@testing-library/jest-dom/vitest'

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) { this.callback([{ target, contentRect: { width: 1000, height: 562.5 } } as ResizeObserverEntry], this) }
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver
