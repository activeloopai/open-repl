import { describe, it, expect } from 'vitest';
import { PreviewManager, pickPreview, type PreviewSource } from './preview.js';

/** A mounted session: has a PreviewManager, with a detected port or not. */
function mounted(port: number | null): PreviewSource {
  const preview = new PreviewManager();
  if (port != null) preview.setPort(port);
  return { getPreview: () => preview };
}
/** An unmounted session: no project open yet, so no preview at all. */
function unmounted(): PreviewSource {
  return { getPreview: () => null };
}

describe('pickPreview', () => {
  it('prefers the session whose app is running over the newest connection', () => {
    // The app runs in `withApp`; `current` is a newer tab that never ran anything.
    const withApp = mounted(5000);
    const current = mounted(null);
    const chosen = pickPreview([withApp, current], current);
    expect(chosen?.getPort()).toBe(5000);
  });

  it('falls back to the current session when no app has a port yet', () => {
    const current = mounted(null);
    const chosen = pickPreview([current], current);
    // Same PreviewManager instance, no port — proxy shows the "no dev server" hint.
    expect(chosen).toBe(current.getPreview());
    expect(chosen?.getPort()).toBeNull();
  });

  it('returns null when the current session has no project mounted', () => {
    const current = unmounted();
    expect(pickPreview([current], current)).toBeNull();
  });

  it('returns null when there are no sessions and no current', () => {
    expect(pickPreview([], null)).toBeNull();
  });

  it('a second connection cannot steal the proxy from the running app', () => {
    // Reproduces the bug: app started in session A, then B connects and becomes
    // current. The proxy must still resolve to A's running preview.
    const a = mounted(5000);
    const b = unmounted();
    expect(pickPreview([a, b], b)?.getPort()).toBe(5000);
  });
});
