// swipe-navigate-rn-template — read-only prev/next adjacent-video navigation
// sub-state for the Default Player template (React Native parity of the iOS
// `swipe-navigate-template`, archived).
//
// The two ids come from the public core channel (`channel.prev[0]?.id` /
// `channel.next[0]?.id`, `LBNavItem.id`). RN has NO `ingestChannel()`; the host
// resolves them from the channel and forwards them via the template's host-fed
// `handleNavTargets(...)` (parity with `handleHeaderChrome`). This model only
// holds + diffs the pair — it owns NO loader reference (one-way data flow); the
// `navigateToPrev()` / `navigateToNext()` forwarders live on the template and
// delegate to an injected `loadVideo`.

/**
 * Read-only navigation snapshot: the adjacent-video ids the host binds to drive
 * a vertical-swipe-to-switch-video gesture. `null` when there is no adjacent
 * video in that direction.
 */
export interface LBPlayerNavigationState {
  /** `channel.prev[0]?.id` — the previous adjacent video, or `null`. */
  readonly prevVideoId: string | null;
  /** `channel.next[0]?.id` — the next adjacent video, or `null`. */
  readonly nextVideoId: string | null;
}

/**
 * Diff-then-notify navigation sub-state (mirrors `DefaultPlayerHeaderState`):
 * a `current` snapshot getter + an `apply(...)` that returns whether either id
 * actually changed so the template coalesces ONE host-facing `onChange`.
 */
export class DefaultPlayerNavigation {
  private _prevVideoId: string | null = null;
  private _nextVideoId: string | null = null;

  /** Read-only snapshot the host binds. */
  get current(): LBPlayerNavigationState {
    return { prevVideoId: this._prevVideoId, nextVideoId: this._nextVideoId };
  }

  /**
   * Apply the host-fed adjacent-video ids (resolved from `channel.prev[0]?.id` /
   * `channel.next[0]?.id`, `undefined`→`null`). Pure diff: returns `true` only
   * when either id actually changed. @internal
   */
  apply(prevVideoId: string | null, nextVideoId: string | null): boolean {
    if (this._prevVideoId === prevVideoId && this._nextVideoId === nextVideoId) {
      return false;
    }
    this._prevVideoId = prevVideoId;
    this._nextVideoId = nextVideoId;
    return true;
  }

  /** Reset to `(null, null)` on teardown / new video. Returns whether it changed. @internal */
  clear(): boolean {
    return this.apply(null, null);
  }
}
