// auth-gate-template-state — auth-gate + identity-label view-models
// (behaviour / view-model layer; NO pixels). Mirrors `ErrorState.ts`.
//
// Spec: ui-template-foundation/spec.md
//   § "Default Template Auth-Gate 狀態暴露"
//   § "Default Template Identity-Label 狀態暴露"
// Design: design.md D2 / D3.
//
// core stays headless: it owns `AUTH_REQUIRED` (sync_interceptor), the
// `PendingAuthStore` + 30s replay, `AUTH_STATE_CHANGED` (notification) and the
// `GUEST_NAME_EDIT_REQUEST` exit. These models map those events into
// host-bindable state so the host can draw a「請先登入」prompt / identity label.
// The template never renders them.
//
// RN wiring note (design D6 + host-takeover gap): RN receives both events on the
// unified `registerListener` channel (OBSERVATION-only — no interception-result
// flag, handler returns void). The host's PRIMARY interceptable listener's
// `true`/`false` return is resolved natively and is NOT surfaced back to JS.
// So the unified router passes `hostIntercepted = false` (it cannot do
// otherwise without touching core / bridge, which is forbidden). The exclusion
// API (`recordRequired(params, hostIntercepted)`) is kept for four-platform
// parity and unit-tested at the model level (parity with the RN award-claim /
// event-join host-takeover-by-convention precedent).

/**
 * Host-bindable auth-gate trigger category. Mirrors core
 * `AUTH_REQUIRED.params.trigger_action`; the host picks copy per action.
 */
export enum LBAuthTriggerAction {
  CartAdd = 'cartAdd',
  CommentSend = 'commentSend',
  CouponClaim = 'couponClaim',
  /** 未登入點訂閱觸發登入（後端 `trigger_action == "subscribe"`）。iOS `.subscribe` / Android `SUBSCRIBE` parity. */
  Subscribe = 'subscribe',
  /** Forward-compat bucket for any un-enumerated `trigger_action` string. */
  Other = 'other',
}

/**
 * Pure mapping of the snake_case `trigger_action` wire string → enum (spec
 * table). ANY other string — including `undefined` — falls back to
 * {@link LBAuthTriggerAction.Other} (forward-compatible, never throws).
 */
export function triggerActionFromString(s: string | undefined): LBAuthTriggerAction {
  switch (s) {
    case 'cart_add':
      return LBAuthTriggerAction.CartAdd;
    case 'comment_send':
      return LBAuthTriggerAction.CommentSend;
    case 'coupon_claim':
      return LBAuthTriggerAction.CouponClaim;
    case 'subscribe':
      return LBAuthTriggerAction.Subscribe;
    default:
      return LBAuthTriggerAction.Other;
  }
}

/** One host-bindable「請先登入」snapshot. null until the first un-intercepted event. */
export interface LBAuthGateState {
  readonly triggerAction: LBAuthTriggerAction;
  readonly productId: string | null;
  readonly videoId: string | null;
}

/**
 * Auth-gate view-model. The owning template feeds it {@link recordRequired} (an
 * un-intercepted `AUTH_REQUIRED`) and {@link clearOnLogin} (a `logged_in`
 * `AUTH_STATE_CHANGED`); the host reads {@link current} and re-renders on the
 * template's change notification. Each mutator returns whether it changed state
 * so the template coalesces exactly one notification.
 */
export class DefaultAuthGate {
  private _current: LBAuthGateState | null = null;

  /** Latest un-intercepted「請先登入」snapshot, or null. Single value, NOT a queue. */
  get current(): LBAuthGateState | null {
    return this._current;
  }

  /**
   * Record an `AUTH_REQUIRED`. When the host's primary listener intercepted it
   * (`hostIntercepted`), EXCLUDE: do NOT set state, return false. Otherwise set
   * the latest single value (new overwrites prior) and return true.
   */
  recordRequired(params: Record<string, unknown>, hostIntercepted: boolean): boolean {
    if (hostIntercepted) return false;
    const triggerAction = triggerActionFromString(
      typeof params.trigger_action === 'string' ? params.trigger_action : undefined,
    );
    this._current = {
      triggerAction,
      productId: typeof params.product_id === 'string' ? params.product_id : null,
      videoId: typeof params.video_id === 'string' ? params.video_id : null,
    };
    return true;
  }

  /** Login success clears the gate (prompt disappears). Returns whether it cleared. */
  clearOnLogin(): boolean {
    if (this._current === null) return false;
    this._current = null;
    return true;
  }

  /** Host-dismiss clear (symmetric with error-state `clear`). Returns whether it cleared. */
  clear(): boolean {
    if (this._current === null) return false;
    this._current = null;
    return true;
  }
}

/** Host-bindable identity label for `PlayerHeader` / `ChatView`. */
export interface LBIdentityLabel {
  readonly displayName: string;
  readonly isLoggedIn: boolean;
}

/**
 * Identity-label view-model. Single source = `AUTH_STATE_CHANGED`; {@link
 * current} is null until the first such event (template MUST NOT seed from
 * configure identity). `resumed_action` is never stored.
 */
export class DefaultIdentityLabel {
  private _current: LBIdentityLabel | null = null;

  /** Identity label, or null before the first `AUTH_STATE_CHANGED`. */
  get current(): LBIdentityLabel | null {
    return this._current;
  }

  /**
   * Map `AUTH_STATE_CHANGED`. `logged_in` → `{displayName, true}`; any other
   * state (`logged_out` / unknown) → `{displayName ?? '', false}`. Returns
   * whether the state changed.
   */
  update(state: string, displayName: string | undefined): boolean {
    const next: LBIdentityLabel = {
      displayName: displayName ?? '',
      isLoggedIn: state === 'logged_in',
    };
    if (
      this._current !== null &&
      this._current.displayName === next.displayName &&
      this._current.isLoggedIn === next.isLoggedIn
    ) {
      return false;
    }
    this._current = next;
    return true;
  }
}
