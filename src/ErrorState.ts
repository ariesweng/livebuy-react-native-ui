// livebuy-ui-event-join-and-error-state-template — Player error-state exposure
// (behaviour / view-model layer; NO pixels).
//
// Spec: ui-template-foundation/spec.md § "Default Template Player Error-State 暴露".
// Design: design.md Decision 3 / Decision 4.
//
// core stays headless: it owns the player state machine, the LBError
// classification, and the 3×/3s HLS retry. This model maps a cross-platform
// error `type` string into a host-bindable `{ kind, phase }` so the host can
// draw the `moments.jsx` `LBPErrorScreen`. The template never renders it.
//
// RN wiring note (design — host-wired typed error): the RN UI template
// subscribes to the unified bridge listener, where `VIDEO_ERROR` carries only a
// platform-dependent `description` (NOT a cross-platform type). The typed,
// cross-platform error `type` string is emitted on the bridge's `LBError`
// NativeEventEmitter event, which the HOST consumes. So the host wires that
// event → `DefaultPlayerTemplate.handleError(type)`; error CLEARING is auto-
// driven from the unified `VIDEO_STATE_CHANGE` (see `handlePlayerStateChange`).
// The template owns the mapping + state + clearing on all platforms — only the
// typed-error subscription seam differs (inherent to RN's host-owned-player UI).

/**
 * Host-bindable error category for `LBPErrorScreen`. Mirrors the design's three
 * error visuals; the host picks copy / artwork per kind.
 */
export enum PlayerErrorKind {
  /** Stream / playback failure — also the GENERIC bucket for any error `type`
   *  not otherwise mapped (networkError / restricted / invalidSignature / …). */
  Stream = 'stream',
  /** `videoNotFound` — the video does not exist / was removed. */
  NotFound = 'notFound',
  /** `sdk_version_unsupported` — this SDK build is no longer accepted (426). */
  Outdated = 'outdated',
}

/**
 * Error lifecycle phase. Only {@link Failed} (terminal) is in scope — `retrying`
 * is NOT exposed by core (retries stay `buffering`), deferred to a follow-up
 * core change (see proposal Follow-up).
 */
export enum PlayerErrorPhase {
  Failed = 'failed',
}

/** One host-bindable error snapshot. null when the player is not in `error`. */
export interface PlayerErrorState {
  readonly kind: PlayerErrorKind;
  readonly phase: PlayerErrorPhase;
}

/**
 * Pure mapping of the bridge error `type` string → {@link PlayerErrorKind}
 * (design Decision 3 / spec table). The bridge emits a cross-platform-consistent
 * `type` (iOS `LivebuyRNBridge.emitError` / Android parity): `videoNotFound`,
 * `sdk_version_unsupported`, `networkError`, `restricted`, `invalidSignature`,
 * … `signatureExpired` was removed from core. Anything not listed falls back to
 * {@link PlayerErrorKind.Stream} (generic playback failure).
 */
export function errorKindFromType(type: string): PlayerErrorKind {
  switch (type) {
    case 'videoNotFound':
      return PlayerErrorKind.NotFound;
    case 'sdk_version_unsupported':
      return PlayerErrorKind.Outdated;
    // networkError / restricted / invalidSignature / business errors / unknown.
    default:
      return PlayerErrorKind.Stream;
  }
}

/**
 * Player error-state view-model. The owning template feeds it
 * {@link recordError} (host wires the bridge `LBError` event) and
 * {@link handleStateChange} (from the unified `VIDEO_STATE_CHANGE`); the host
 * reads {@link current} and re-renders on the template's change notification.
 * Each mutator returns whether it changed state so the template can coalesce
 * exactly one notification.
 */
export class PlayerErrorStateModel {
  private _current: PlayerErrorState | null = null;

  /** Current error snapshot, or null when the player is not in `error`. */
  get current(): PlayerErrorState | null {
    return this._current;
  }

  /** Record a terminal player error from the bridge `type` string. Always
   *  `phase = Failed`; `kind` per the mapping table. Returns true (a change). */
  recordError(type: string): boolean {
    this._current = { kind: errorKindFromType(type), phase: PlayerErrorPhase.Failed };
    return true;
  }

  /**
   * React to a player state change (canonical name). When an error is shown and
   * the player LEAVES `error` (host re-loaded → core transitions out of error),
   * clear it. Returns whether it cleared (no-op while not in error / still in
   * error).
   */
  handleStateChange(canonicalName: string): boolean {
    if (this._current === null || canonicalName === 'error') return false;
    this._current = null;
    return true;
  }

  /** Explicit reset (e.g. video reload). Returns whether it cleared. */
  clear(): boolean {
    if (this._current === null) return false;
    this._current = null;
    return true;
  }
}
