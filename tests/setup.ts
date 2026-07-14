import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

// UX-15: uiStore now persists a slice to localStorage — clear it between tests so one
// test's persisted settings can't leak into the next.
afterEach(() => {
  localStorage.clear();
});
