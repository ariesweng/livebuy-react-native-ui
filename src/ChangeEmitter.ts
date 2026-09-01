// expose-default-template-bindable-state §B (D1 / D3) — coalesced "state
// changed" notification primitive for the Default template's host-bindable
// state (merged feed items / unclaimed count + winners / award-claim result
// state). Behaviour / view-model layer only — NO pixels.
//
// Parity invariants (four-platform shared semantics):
//   - COALESCED notification: emit carries NO diff payload. The host re-reads
//     all bindable state after each notification (iOS/Android `onChange`,
//     Flutter `ChangeNotifier.notifyListeners`, RN this emitter).
//   - EXACTLY ONCE per single state-change event (no redraw storm): each
//     `handle*` / `clear` on the template emits at most one notification.
//   - PURELY ADDITIVE: when the host registers no listener, behaviour is
//     unchanged (no throw, existing state values untouched).
//
// Threading: the RN template consumes core events on the JS thread (the unified
// bridge listener delivers on the JS thread), so emitting synchronously inside
// the handlers already dispatches the notification on the JS/UI thread — the
// host can safely `setState` in its listener. No extra thread hop is needed
// (parity intent with iOS main / Android main / Flutter platform thread).

/** A coalesced "state changed" listener. Receives no diff; re-reads state. */
export type ChangeListener = () => void;

/** Unsubscribe handle returned from {@link ChangeEmitter.subscribe}. */
export type Unsubscribe = () => void;

/**
 * Multi-listener coalesced change emitter. The Default template owns one and
 * fires it once per single state mutation; the host subscribes to re-read the
 * bindable state and re-render.
 */
export class ChangeEmitter {
  private readonly listeners = new Set<ChangeListener>();

  /**
   * Register a coalesced change listener. Returns an idempotent unsubscribe
   * (mirrors the core `registerListener` contract). Same function may be added
   * once (Set-deduped); the returned unsubscribe removes that registration.
   */
  subscribe(listener: ChangeListener): Unsubscribe {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  /** Notify every listener once (coalesced; no payload). */
  emit(): void {
    // Snapshot so a listener that unsubscribes mid-iteration cannot skip a peer.
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** Number of active listeners (test-visible). */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
