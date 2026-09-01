// player-chrome-template — OperationPanel side-rail view-model
// (behaviour / view-model layer; NO pixels). Mirrors `MomentState.ts`.
//
// Spec: ui-template-foundation/spec.md
//   § "Default Template OperationPanel Side-Rail 狀態暴露".
// Design: design.md D2 / D6.
//
// core stays headless: it owns the 10 `simulate*` exits, the 250ms like throttle
// and the `LIKE_PERFORMED` exit. This model maps the REACHABLE flags into a
// host-bindable side-rail (ordered `{ kind, enabled }` items + bag-count +
// heart-burst tick + muted) so a host can draw `LBLiveBottomBar` / `LBPSideRail`.
// The template never renders a button / badge / heart animation, and NEVER fires
// like itself — the actual action goes through the existing `simulate*`.
//
// RN wiring note (design D6 — host-wired / host-fed sources, parity with
// moment-state): the `channel`-derived enabled flags (chat / serviceLink /
// guestNameEdit) are HOST-FED (the host reads its channel and calls
// `handleEnablement`, exactly like notice-tab `injectNotices`); `subtitle` /
// `hasStart` come from the moment snapshot; `bagCount` is host-wired from
// `products.count`; heart-burst is fed from the unified `VIDEO_LIKE` event
// (snake_case wire `video_id`) or a host-wired tick. The actual action goes
// through the player ref's `simulate*` the host already holds.
//
// Mutators RETURN `boolean` (= "did this actually change") so the owning template
// coalesces exactly ONE notification per single side-rail mutation.

/**
 * Side-rail action kind. Each value corresponds to an EXISTING core `simulate*`
 * exit (a subset of the 10 — design `live-chrome.jsx` `LBLiveBottomBar` +
 * `LBPSideRail`). The template MUST NOT add a kind with no core `simulate*`.
 */
export enum LBSideRailKind {
  Goods = 'goods',
  Chat = 'chat',
  Like = 'like',
  Share = 'share',
  Subtitle = 'subtitle',
  ServiceLink = 'serviceLink',
  GuestNameEdit = 'guestNameEdit',
  More = 'more',
}

/** One ordered side-rail action item. `enabled` is DERIVED from reachable flags. */
export interface LBSideRailItem {
  readonly kind: LBSideRailKind;
  readonly enabled: boolean;
}

/** Reachable enabled flags fed into the side-rail (host-fed / derived on native). */
export interface LBSideRailEnablement {
  /** `live_status==1 && !(isGuest && guest_comment==0)` (channel-derived). */
  readonly chatEnabled: boolean;
  /** `momentState.subtitleAvailable` (`is_subtitle`). */
  readonly subtitleAvailable: boolean;
  /** `channel.shop.service_link` non-empty (channel-derived; NO live_status gate — the
   *  side rail only renders in the non-live layout, so the prior `&& live_status==0`
   *  over-restricted 聯繫商家; parity with iOS/Android). */
  readonly serviceLinkAvailable: boolean;
  /** Guest-rename allowed (channel-derived). */
  readonly guestEditAvailable: boolean;
  /** `momentState.startUrl` non-empty (existing derived usage). */
  readonly hasStart: boolean;
}

/**
 * Canonical ORDER of the side-rail items (design `LBLiveBottomBar`: bag / share /
 * like / comment / nickname / CC, plus serviceLink + more). The list is always
 * exposed in this order; only `enabled` varies.
 */
const RAIL_ORDER: readonly LBSideRailKind[] = [
  LBSideRailKind.Goods,
  LBSideRailKind.Chat,
  LBSideRailKind.Like,
  LBSideRailKind.Share,
  LBSideRailKind.Subtitle,
  LBSideRailKind.ServiceLink,
  LBSideRailKind.GuestNameEdit,
  LBSideRailKind.More,
];

/**
 * OperationPanel side-rail view-model. Holds the enabled flags + bag-count +
 * heart-burst tick + muted, and DERIVES the ordered `items` list. The owning
 * template feeds it; the host reads {@link items} / {@link bagCount} /
 * {@link heartBurstTick} / {@link muted} and re-renders on the change
 * notification. Each mutator returns whether it changed so the template
 * coalesces ONE notify.
 */
export class DefaultOperationRail {
  private _chatEnabled = false;
  private _subtitleAvailable = false;
  private _serviceLinkAvailable = false;
  private _guestEditAvailable = false;
  private _hasStart = false;
  private _bagCount = 0;
  private _heartBurstTick = 0;
  // Reuse the existing PlayerHeader muted source semantics (unmuted / sound on by
  // default — player-default-unmuted-{core,template}; mirrors core default-unmuted).
  private _muted = false;

  // --- Read surface (public) ---

  /**
   * Ordered side-rail action items. `goods` / `like` / `share` / `more` are
   * ALWAYS enabled; `chat` / `subtitle` / `serviceLink` / `guestNameEdit` are
   * derived from the reachable flags. Computed (never stored) so it can never
   * drift from the flags.
   */
  get items(): readonly LBSideRailItem[] {
    return RAIL_ORDER.map((kind) => ({ kind, enabled: this.isEnabled(kind) }));
  }

  /** Bag badge count (= products.count, host-wired; never a 2nd products copy). */
  get bagCount(): number {
    return this._bagCount;
  }

  /** Monotonic heart-burst tick (+1 per `likePerformed`); host plays the animation. */
  get heartBurstTick(): number {
    return this._heartBurstTick;
  }

  /** Player mute flag (mirrors the PlayerHeader muted source; no 2nd source). */
  get muted(): boolean {
    return this._muted;
  }

  /**
   * host-bindable「LIVE 留言對訪客開放」signal (`live_status==1 && !(isGuest && guest_comment==0)`),
   * the SAME source as the `.chat` rail item's `enabled` flag. reference-ui reads it (via
   * `DefaultTemplate.operationRailState.chatEnabled`) to gate the LIVE「留言」pill to a「請先登入」
   * modal when a guest taps it on a `guest_comment==0` live (rb-rn-live-comment-login-gate).
   */
  get chatEnabled(): boolean {
    return this._chatEnabled;
  }

  private isEnabled(kind: LBSideRailKind): boolean {
    switch (kind) {
      case LBSideRailKind.Chat:
        return this._chatEnabled;
      case LBSideRailKind.Subtitle:
        return this._subtitleAvailable;
      case LBSideRailKind.ServiceLink:
        return this._serviceLinkAvailable;
      case LBSideRailKind.GuestNameEdit:
        return this._guestEditAvailable;
      // goods / like / share / more are always enabled (spec).
      default:
        return true;
    }
  }

  // --- Mutators ---

  /**
   * Apply the reachable enabled flags (host-fed / native channel-derived). `chat`
   * ← chatEnabled, `subtitle` ← subtitleAvailable, `serviceLink` ←
   * serviceLinkAvailable, `guestNameEdit` ← guestEditAvailable, plus `hasStart`.
   * Returns whether any flag actually changed. @internal
   */
  handleEnablement(flags: Partial<LBSideRailEnablement>): boolean {
    let changed = false;
    if (flags.chatEnabled !== undefined && this._chatEnabled !== flags.chatEnabled) {
      this._chatEnabled = flags.chatEnabled;
      changed = true;
    }
    if (flags.subtitleAvailable !== undefined && this._subtitleAvailable !== flags.subtitleAvailable) {
      this._subtitleAvailable = flags.subtitleAvailable;
      changed = true;
    }
    if (
      flags.serviceLinkAvailable !== undefined &&
      this._serviceLinkAvailable !== flags.serviceLinkAvailable
    ) {
      this._serviceLinkAvailable = flags.serviceLinkAvailable;
      changed = true;
    }
    if (flags.guestEditAvailable !== undefined && this._guestEditAvailable !== flags.guestEditAvailable) {
      this._guestEditAvailable = flags.guestEditAvailable;
      changed = true;
    }
    if (flags.hasStart !== undefined && this._hasStart !== flags.hasStart) {
      this._hasStart = flags.hasStart;
      changed = true;
    }
    return changed;
  }

  /** Apply the bag count (= products.count). Returns whether it changed. @internal */
  handleBagCount(count: number): boolean {
    if (this._bagCount === count) return false;
    this._bagCount = count;
    return true;
  }

  /**
   * A core `likePerformed` (like API actually succeeded) arrived → bump the
   * monotonic heart-burst tick by 1. ALWAYS reports a change (a like firing is a
   * real animation beat). The template NEVER fires like itself. @internal
   */
  handleLikePerformed(): boolean {
    this._heartBurstTick += 1;
    return true;
  }

  /** Apply the player mute flag (mirrors PlayerHeader muted). Returns whether it changed. @internal */
  handleMuted(muted: boolean): boolean {
    if (this._muted === muted) return false;
    this._muted = muted;
    return true;
  }

  /**
   * Reset to initial. Returns whether anything was non-initial. `_muted` is
   * PRESERVED across clear (mute-preference-persist-across-switch): clear() is the
   * VIDEO_SWITCH in-place reset, NOT a teardown, so it MUST NOT reset the user's
   * mute preference — `_muted` is excluded from the isInitial check AND never reset
   * here (mirrors the existing `heartBurstTick` monotonic-preserve rationale). @internal
   */
  clear(): boolean {
    const isInitial =
      !this._chatEnabled &&
      !this._subtitleAvailable &&
      !this._serviceLinkAvailable &&
      !this._guestEditAvailable &&
      !this._hasStart &&
      this._bagCount === 0 &&
      this._heartBurstTick === 0;
    if (isInitial) return false;
    this._chatEnabled = false;
    this._subtitleAvailable = false;
    this._serviceLinkAvailable = false;
    this._guestEditAvailable = false;
    this._hasStart = false;
    this._bagCount = 0;
    this._heartBurstTick = 0;
    // _muted intentionally NOT reset (preserved across in-place switch — see kdoc).
    return true;
  }
}
