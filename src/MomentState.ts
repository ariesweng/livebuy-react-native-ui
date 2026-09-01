// expose-player-moment-state-template — five player "moment" view-models
// (behaviour / view-model layer; NO pixels).
//
// Spec: ui-template-foundation/spec.md § "Default Template Player Moment-State 暴露".
// Design: design.md D1–D8.
//
// core (expose-player-moment-state-core) stays headless: it owns the player
// state machine, the /sdk/video + /sdk/video/goods polls, subtitle / subscribe /
// mute. This file maps that typed moment-state into five host-bindable
// view-models (StartScreen / EndScreen / ProductOverlay / PlayerHeader /
// SubtitleTrack) so a host can draw `moments.jsx`. The template never renders.
//
// RN wiring note (design D8 — host-wired typed sources): momentState is NOT
// bridged to RN (intentional, parity with the error-state `type`). Only
// StartScreen.phase is partly auto-fed because VIDEO_STATE_CHANGE already routes
// on the unified channel; products / end-screen countdown / header / subtitle /
// start-availability all arrive via host-wired typed `handle*` methods the host
// calls, EXACTLY like the host wires the bridge `LBError` event to `handleError`.
//
// Each view-model mirrors `PlayerErrorStateModel`: a small class with private
// snapshot state, a PUBLIC read getter, and mutators that RETURN `boolean`
// (= "did this actually change") so the owning template coalesces exactly ONE
// notification per single moment-state mutation.

import type { LBProduct } from 'livebuy-react-native';

// ---------------------------------------------------------------------------
// Canonical shape — identical across iOS / Android / Flutter / RN.
// ---------------------------------------------------------------------------

/**
 * StartScreen splash phase (design `LBPStartScreen` `phase`). `splash` is the
 * opening MP4 (`channel.start`); `done` lets the host dismiss the splash once
 * the player reaches the main flow.
 */
export enum StartScreenPhase {
  Loading = 'loading',
  Splash = 'splash',
  Buffering = 'buffering',
  Done = 'done',
}

/** Auto-next countdown ring values (design `LBPEndScreen` 圓環倒數). */
export interface EndScreenCountdown {
  readonly remain: number;
  readonly total: number;
}

/**
 * Lightweight EndScreen `next[]` row. The bridge does NOT export `LBNavItem`, so
 * the canonical shape declares its own row interface (parity with how
 * `ErrorState` declares its own enums). The host folds the core nav row into it.
 */
export interface EndScreenNavRow {
  readonly id: string;
  readonly title: string;
  readonly cover: string;
  /**
   * Shop name + duration (seconds) for the design's「{shopName} · {duration}」preview
   * meta line (`LBPEndScreen`, moments.jsx:321) — parity with the iOS template's
   * `LBNavItem`. Host-fed (the host folds the core nav row into this), default '' / 0
   * so existing call sites stay source-compatible (purely additive).
   */
  readonly shopName?: string;
  readonly duration?: number;
}

/**
 * Lightweight EndScreen `hot[]` row. The bridge does NOT export `LBHotItem`
 * (only a reduced `LBBridgeHotItem`); the canonical shape declares its own row.
 */
export interface EndScreenHotRow {
  readonly id: string;
  readonly title: string;
  readonly cover: string;
}

/** Host-bindable StartScreen snapshot. */
export interface StartScreenState {
  readonly phase: StartScreenPhase;
}

/** Host-bindable EndScreen snapshot. `countdown` nil unless auto-next is active. */
export interface EndScreenState {
  readonly next: readonly EndScreenNavRow[];
  readonly hot: readonly EndScreenHotRow[];
  readonly countdown: EndScreenCountdown | null;
  /**
   * 結束畫面是否該顯示 — 鏡像 core「player 進 endScreenShown sub-state」（live_end 時為
   * true，不論 next/hot）。與 {@link countdown} 正交：`endScreenVisible == true &&
   * countdown == null` ⟺ 無倒數的「直播已結束」結束畫面；`countdown != null` ⟹
   * `endScreenVisible == true`。reference-ui 在此為 true 時顯示結束畫面
   * (end-screen-no-countdown)。預設 false。Parity iOS / Android `endScreenVisible`.
   */
  readonly endScreenVisible: boolean;
}

/** Host-bindable ProductOverlay snapshot. `activeProduct` = the narrate_status==2 item. */
export interface ProductOverlayState {
  readonly products: readonly LBProduct[];
  readonly activeProduct: LBProduct | null;
  /**
   * The currently-introducing product's id (= `activeProduct?.id`; null when none).
   * Pure derivation — the reference-ui product LIST draws the「介紹中」banner on the
   * matching row. Parity iOS / Android `introducingProductId`.
   */
  readonly introducingProductId: string | null;
  /**
   * `products` with the currently-introducing product moved to the FRONT (rest keep
   * relative order); equals `products` unchanged when no active product. Pure
   * derivation — reference-ui binds it so the introducing item sorts first (MUST NOT
   * re-sort). Parity iOS / Android `productsIntroducingFirst`.
   */
  readonly productsIntroducingFirst: readonly LBProduct[];
}

/**
 * Host-bindable PlayerHeader snapshot (design `LBPHostBadge`). The original
 * three fields (`isSubscribed` / `viewerCount` / `muted`) are joined by the
 * player-chrome-template top-bar chrome fields (`title` / `hostName` /
 * `shopLogo` / `shareUrl`), fed from the channel (design D3). The top-bar fields
 * default to empty strings so an unfed header behaves exactly as before.
 */
export interface PlayerHeaderState {
  readonly isSubscribed: boolean;
  readonly viewerCount: number;
  readonly muted: boolean;
  // player-chrome-template — top-bar chrome (LBLiveTopBar / LBPHostBadge).
  readonly title: string;
  readonly hostName: string;
  readonly shopLogo: string;
  readonly shareUrl: string;
  /** LIVE/VOD flag (`channel.liveStatus == 1`, host-fed). Gates LIVE vs VOD chrome
   *  (the reference-ui LIVE bottom bar vs the VOD side rail). Default `false`. */
  readonly isLive: boolean;
  /** 回放（已結束直播）flag — host-fed (`channel.type === 3 || (type === 2 && liveStatus === 3)`,
   *  via {@link isFinishedLiveReplay}). 與 [isLive] 並列但語意分離且互斥（`liveStatus` 不可能同時
   *  1 與 3）：[isLive] 嚴格 `liveStatus === 1`（正在直播），`isFinishedLiveReplay` 標示「回放」。
   *  下游（host app 自組的 reference-ui）讀此把回放渲染成 LIVE 版型 + 「聊天室已關閉」留言態；純
   *  VOD（`type === 1`）兩旗標皆 `false` → VOD 版型。Default `false`. parity iOS/Android. */
  readonly isFinishedLiveReplay: boolean;
}

/**
 * Host-bindable VOD playback-progress snapshot (VOD-2). `duration === 0` ⇒ live
 * (no scrubbable timeline); `isReplay` = a LIVE stream scrubbed behind the live
 * edge (`live_status == 1` only) — drives the LIVE bottom bar's "聊天室已關閉"
 * variant. Host-fed (the host echoes the native progress).
 */
export interface PlaybackProgressState {
  readonly position: number;
  readonly duration: number;
  readonly isPlaying: boolean;
  readonly isReplay: boolean;
}

/** Host-bindable SubtitleTrack snapshot. */
export interface SubtitleState {
  readonly available: boolean;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// View-models. READ getters public; mutators @internal (template-fed).
// ---------------------------------------------------------------------------

/**
 * StartScreen phase view-model. The template owns the player-state → phase
 * mapping (D2): `loading`→loading; `startScreenPlaying`→splash (ONLY when
 * `channel.start` is non-empty); `buffering`→buffering; any main state
 * (playing/paused/ended/endScreenShown)→done. When start is empty, splash is
 * never reached (loading→done only).
 */
export class DefaultStartScreenState {
  private _phase: StartScreenPhase = StartScreenPhase.Loading;
  private _hasStart = false;

  /** Current splash phase. */
  get phase(): StartScreenPhase {
    return this._phase;
  }

  /** Host-wired `channel.start` presence (gates splash). @internal */
  setStartAvailability(hasStart: boolean): boolean {
    if (this._hasStart === hasStart) return false;
    this._hasStart = hasStart;
    return false; // availability alone changes no exposed value; phase re-maps on next state.
  }

  /** Map a canonical player-state name → phase. Returns whether phase changed. @internal */
  handleStateChange(canonicalName: string): boolean {
    const next = this.mapPhase(canonicalName);
    if (next === this._phase) return false;
    this._phase = next;
    return true;
  }

  private mapPhase(name: string): StartScreenPhase {
    switch (name) {
      case 'loading':
        return StartScreenPhase.Loading;
      case 'buffering':
        return StartScreenPhase.Buffering;
      case 'startScreenPlaying':
        return this._hasStart ? StartScreenPhase.Splash : StartScreenPhase.Done;
      default:
        // playing / paused / ended / endScreenShown / awaitingLive / error → done.
        return StartScreenPhase.Done;
    }
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (this._phase === StartScreenPhase.Loading && !this._hasStart) return false;
    this._phase = StartScreenPhase.Loading;
    this._hasStart = false;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Upcoming (直播預告) — parity iOS DefaultUpcomingState (eaa14c5 / 544d284),
// Android (2091bd4), Flutter (887f06d).
// ---------------------------------------------------------------------------

/**
 * Host-bindable Upcoming (直播預告 awaiting-live) snapshot:
 *
 *   • `active`          = awaiting-live countdown (直播預告, NOT playing a video) —
 *                         `lastState === "awaitingLive"`.
 *   • `introPlaying`    = the upcoming opening MP4 (intro preroll, `channel.start`)
 *                         is playing → the reference-ui wears LIVE chrome over the
 *                         intro video (VOD intro keeps `introPlaying == false`).
 *   • `scheduledStartAt`= `channel.publishAt` verbatim (the template MUST NOT parse).
 *   • `cover`           = `channel.cover` verbatim (the template MUST NOT load it;
 *                         the reference-ui paints it as the countdown background).
 */
export interface UpcomingState {
  readonly active: boolean;
  readonly introPlaying: boolean;
  readonly scheduledStartAt: string;
  readonly cover: string;
}

/**
 * Upcoming (直播預告) view-model. Host-fed via `DefaultPlayerTemplate.handleUpcoming`
 * (RN does NOT bridge the full `LBChannel`; `upcoming-intro-core-rn` forwards only
 * the upcoming fields as `LBPlayerChannelInfo`). diff-then-return-changed mutator
 * (mirrors `DefaultPlayerHeaderState`), so the owning template coalesces exactly ONE
 * notification per single mutation. Parity with iOS / Android / Flutter
 * `DefaultUpcomingState`.
 */
export class DefaultUpcomingState {
  private _active = false;
  private _introPlaying = false;
  private _scheduledStartAt = '';
  private _cover = '';

  get current(): UpcomingState {
    return {
      active: this._active,
      introPlaying: this._introPlaying,
      scheduledStartAt: this._scheduledStartAt,
      cover: this._cover,
    };
  }

  /**
   * Apply a derived upcoming snapshot. Returns whether at least one of the four
   * fields actually changed (diff-then-changed). @internal
   */
  apply(fields: {
    active: boolean;
    introPlaying: boolean;
    scheduledStartAt: string;
    cover: string;
  }): boolean {
    if (
      this._active === fields.active &&
      this._introPlaying === fields.introPlaying &&
      this._scheduledStartAt === fields.scheduledStartAt &&
      this._cover === fields.cover
    ) {
      return false;
    }
    this._active = fields.active;
    this._introPlaying = fields.introPlaying;
    this._scheduledStartAt = fields.scheduledStartAt;
    this._cover = fields.cover;
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (!this._active && !this._introPlaying && this._scheduledStartAt === '' && this._cover === '') {
      return false;
    }
    this._active = false;
    this._introPlaying = false;
    this._scheduledStartAt = '';
    this._cover = '';
    return true;
  }
}

/**
 * Pure helper: whether `s` (backend `publish_at`, UTC+8 `"yyyy-MM-dd HH:mm:ss"`)
 * parses to a FUTURE instant. Empty / unparseable → false. `now` is injectable for
 * deterministic tests. Mirrors the iOS / Android / Flutter template `publishAtInFuture`
 * (the core player's same-named helper is internal + unreachable from the template,
 * so the template carries its own copy). Pure string parse → timezone-independent
 * (the stamp is interpreted as UTC+8, shifted back 8h to the real UTC instant).
 */
export function publishAtInFuture(s: string, now: Date = new Date()): boolean {
  if (s.trim().length === 0) return false;
  const parts = s.split(' ');
  if (parts.length !== 2) return false;
  const date = parts[0]!.split('-');
  const time = parts[1]!.split(':');
  if (date.length !== 3 || time.length !== 3) return false;
  const y = Number.parseInt(date[0]!, 10);
  const mo = Number.parseInt(date[1]!, 10);
  const d = Number.parseInt(date[2]!, 10);
  const h = Number.parseInt(time[0]!, 10);
  const mi = Number.parseInt(time[1]!, 10);
  const se = Number.parseInt(time[2]!, 10);
  if ([y, mo, d, h, mi, se].some((n) => Number.isNaN(n))) return false;
  // Interpret the stamp as UTC+8: build the wall-clock instant in UTC then shift
  // back 8h to the real UTC instant (so the comparison is timezone-independent).
  const utcPlus8WallMs = Date.UTC(y, mo - 1, d, h, mi, se);
  const instantMs = utcPlus8WallMs - 8 * 60 * 60 * 1000;
  return instantMs > now.getTime();
}

/**
 * Pure helper: whether a channel is a 直播預告 (upcoming / scheduled-live) — `liveStatus
 * === 0` AND the backend `type === 2` (scheduled-live channel). rb-rn-upcoming-channel-
 * type（問題 6）: replaces the prior `publishAtInFuture` wall-clock heuristic, which both
 * depended on the current time AND misclassified a scheduled live whose start time had
 * passed but was still `liveStatus === 0` as VOD. `type === 2` is the canonical backend
 * signal (regular VOD is `type === 1`); decoupled from the clock → deterministic. Mirrors
 * iOS / Android / Flutter `isUpcomingChannel(liveStatus, type)`.
 */
export function isUpcomingChannel(liveStatus: number, type: number): boolean {
  return liveStatus === 0 && type === 2;
}

/**
 * Pure helper: whether a channel is a 回放 (一場已結束的直播). 型別語意（與 iOS / Android 一致，
 * 實測校正影片 `W4pqqM` 為 `type === 3` / `liveStatus === 3`）：**`type === 3` = 回放（已結束直播）**、
 * `type === 2` = 直播（預告 + 進行中）、`type === 1` = 點播 VOD。`liveStatus`：0=未直播 / 1=直播中 /
 * 3=已結束/回放。回 `true` 當且僅當 `type === 3`（回放型別，與 `liveStatus` 無關）OR
 * `type === 2 && liveStatus === 3`（剛結束、仍標記直播型別的邊界）；其餘 `false`（直播中
 * `liveStatus === 1`、預告 `type === 2 && liveStatus === 0`、純 VOD `type === 1`）。與 `isLive`
 * （`liveStatus === 1`）互斥。host / bridge 由 channel 計算後經 `handleHeaderChrome({ isFinishedLiveReplay })`
 * 餵入。Mirrors iOS / Android `isFinishedLiveReplay(type, liveStatus)`.
 */
export function isFinishedLiveReplay(type: number, liveStatus: number): boolean {
  return type === 3 || (type === 2 && liveStatus === 3);
}

/**
 * EndScreen view-model. `next`/`hot` populated on `endScreenShown` (host-wired);
 * `countdown` mirrors the core auto-next countdown (D3): the template captures
 * `total` at the instant the countdown flips inactive→active and holds it
 * constant while `remain` decrements. `countdown` becomes null when the
 * countdown is inactive, `next` is empty, or the user cancels.
 */
export class DefaultEndScreenState {
  private _next: readonly EndScreenNavRow[] = [];
  private _hot: readonly EndScreenHotRow[] = [];
  private _countdown: EndScreenCountdown | null = null;
  private _active = false;
  private _visible = false;

  get next(): readonly EndScreenNavRow[] {
    return this._next;
  }
  get hot(): readonly EndScreenHotRow[] {
    return this._hot;
  }
  get countdown(): EndScreenCountdown | null {
    return this._countdown;
  }

  /**
   * Whether the end screen should be shown (mirrors the player entering the
   * `endScreenShown` sub-state). ORTHOGONAL to {@link countdown}: live end sets
   * this true REGARDLESS of next/hot, so the no-countdown「直播已結束」end screen
   * can render. `countdown != null` ⟹ `visible == true`. Parity iOS / Android
   * `endScreenVisible`. @internal
   */
  get visible(): boolean {
    return this._visible;
  }

  /**
   * Set the end-screen visibility (the template drives this from the player
   * state: `state === 'endScreenShown'`). ORTHOGONAL to the countdown — leaving
   * the end state hides it. Returns whether it changed. @internal
   */
  setVisible(visible: boolean): boolean {
    if (this._visible === visible) return false;
    this._visible = visible;
    return true;
  }

  /** Populate `next`/`hot` (on `endScreenShown`). Returns whether it changed. @internal */
  setLists(next: readonly EndScreenNavRow[], hot: readonly EndScreenHotRow[]): boolean {
    this._next = next.slice();
    this._hot = hot.slice();
    return true;
  }

  /**
   * Mirror a core countdown tick. `total` is captured on inactive→active and
   * held constant; countdown is null when inactive or `next` is empty. Returns
   * whether the exposed countdown changed. @internal
   */
  handleCountdown(remain: number, active: boolean): boolean {
    if (!active || this._next.length === 0) {
      this._active = false;
      if (this._countdown === null) return false;
      this._countdown = null;
      return true;
    }
    const total = this._active && this._countdown ? this._countdown.total : remain;
    this._active = true;
    if (this._countdown && this._countdown.remain === remain && this._countdown.total === total) {
      return false;
    }
    this._countdown = { remain, total };
    return true;
  }

  /** User cancelled auto-next: countdown→null, keep next/hot. Returns whether changed. @internal */
  cancelCountdown(): boolean {
    this._active = false;
    if (this._countdown === null) return false;
    this._countdown = null;
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (
      this._next.length === 0 &&
      this._hot.length === 0 &&
      this._countdown === null &&
      !this._visible
    ) {
      return false;
    }
    this._next = [];
    this._hot = [];
    this._countdown = null;
    this._active = false;
    this._visible = false;
    return true;
  }
}

/**
 * ProductOverlay view-model. Snapshot of the core `products` list + the single
 * `narrate_status==2` `activeProduct` (D4). DIFF-then-notify: only reports a
 * change when the product ids OR the active id actually differ — products
 * refresh every 5s, so an unchanged list MUST NOT trigger a notification.
 */
export class DefaultProductOverlayState {
  private _products: readonly LBProduct[] = [];
  private _activeProduct: LBProduct | null = null;

  get products(): readonly LBProduct[] {
    return this._products;
  }
  get activeProduct(): LBProduct | null {
    return this._activeProduct;
  }

  /**
   * The currently-introducing product's id (= `activeProduct?.id`; LIVE
   * `narrate_status == 2`, null when none). The reference-ui product LIST draws
   * the「介紹中」banner on the row whose id matches this. Pure computed (no second
   * state). Parity iOS / Android `introducingProductId`.
   */
  get introducingProductId(): string | null {
    return this._activeProduct?.id ?? null;
  }

  /**
   * `products` with the currently-introducing product (`activeProduct`) moved to
   * the FRONT, preserving the relative order of the rest. When there is no active
   * product (VOD / nothing introducing) this equals `products` unchanged. Pure
   * computed (no second state). The reference-ui product LIST binds THIS so the
   * introducing item sorts first — ORDERING is a data-layer responsibility;
   * reference-ui MUST NOT re-sort. Parity iOS / Android `productsIntroducingFirst`.
   */
  get productsIntroducingFirst(): readonly LBProduct[] {
    const id = this._activeProduct?.id;
    if (id == null) return this._products;
    const idx = this._products.findIndex((p) => p.id === id);
    if (idx < 0) return this._products;
    const ordered = this._products.slice();
    const [item] = ordered.splice(idx, 1);
    ordered.unshift(item!);
    return ordered;
  }

  /**
   * Apply a fresh products snapshot. `active` is the narrate_status==2 item the
   * host/bridge resolved (narrate_status is a poll/raw field NOT on LBProduct).
   * Returns whether the snapshot actually changed (id-diff). @internal
   */
  handleSnapshot(products: readonly LBProduct[], active: LBProduct | null): boolean {
    const sameList = idsEqual(this._products, products);
    const sameActive = (this._activeProduct?.id ?? null) === (active?.id ?? null);
    if (sameList && sameActive) return false;
    this._products = products.slice();
    this._activeProduct = active;
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (this._products.length === 0 && this._activeProduct === null) return false;
    this._products = [];
    this._activeProduct = null;
    return true;
  }
}

/** True when both product lists hold the same ids in the same order. */
function idsEqual(a: readonly LBProduct[], b: readonly LBProduct[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.id !== b[i]!.id) return false;
  }
  return true;
}

/**
 * PlayerHeader view-model (D5). `isSubscribed` mirrors `channel.shop.is_subscribe`
 * (synced after subscribe success), `viewerCount` mirrors `pv_num`, `muted`
 * mirrors the player mute flag (unmuted / sound on by default — matching the core
 * default-unmuted main playback, player-default-unmuted-core; flips on first mute).
 */
export class DefaultPlayerHeaderState {
  private _isSubscribed = false;
  private _viewerCount = 0;
  private _muted = false; // unmuted / sound on by default (player-default-unmuted-{core,template}).
  // player-chrome-template — top-bar chrome (channel-fed; design D3). The single
  // `isSubscribed` truth lives HERE; the info-tab mirrors it (R2 single-source).
  private _title = '';
  private _hostName = '';
  private _shopLogo = '';
  private _shareUrl = '';
  private _isLive = false; // channel.liveStatus == 1 (host-fed); default VOD.
  // 回放（已結束直播）flag — host-fed (`type === 3 || (type === 2 && liveStatus === 3)`). 與 _isLive
  // 並列、語意分離、互斥。下游 host 讀此把回放渲染成 LIVE 版型 + 「聊天室已關閉」留言態。Default false.
  private _isFinishedLiveReplay = false;

  get current(): PlayerHeaderState {
    return {
      isSubscribed: this._isSubscribed,
      viewerCount: this._viewerCount,
      muted: this._muted,
      title: this._title,
      hostName: this._hostName,
      shopLogo: this._shopLogo,
      shareUrl: this._shareUrl,
      isLive: this._isLive,
      isFinishedLiveReplay: this._isFinishedLiveReplay,
    };
  }

  /** The single subscribe truth (the info-tab mirrors this, never stores its own). */
  get isSubscribed(): boolean {
    return this._isSubscribed;
  }

  /** Apply subscribe + viewer-count from the moment snapshot. Returns whether changed. @internal */
  handleHeader(isSubscribed: boolean, viewerCount: number): boolean {
    if (this._isSubscribed === isSubscribed && this._viewerCount === viewerCount) return false;
    this._isSubscribed = isSubscribed;
    this._viewerCount = viewerCount;
    return true;
  }

  /**
   * player-chrome-template — apply the top-bar chrome fields (channel-fed). Only
   * provided keys are written; omitted keys keep their current value. Returns
   * whether any field changed. @internal
   */
  handleHeaderChrome(fields: {
    title?: string;
    hostName?: string;
    shopLogo?: string;
    shareUrl?: string;
    isLive?: boolean;
    isFinishedLiveReplay?: boolean;
  }): boolean {
    let changed = false;
    if (fields.title !== undefined && this._title !== fields.title) {
      this._title = fields.title;
      changed = true;
    }
    if (fields.hostName !== undefined && this._hostName !== fields.hostName) {
      this._hostName = fields.hostName;
      changed = true;
    }
    if (fields.shopLogo !== undefined && this._shopLogo !== fields.shopLogo) {
      this._shopLogo = fields.shopLogo;
      changed = true;
    }
    if (fields.shareUrl !== undefined && this._shareUrl !== fields.shareUrl) {
      this._shareUrl = fields.shareUrl;
      changed = true;
    }
    if (fields.isLive !== undefined && this._isLive !== fields.isLive) {
      this._isLive = fields.isLive;
      changed = true;
    }
    if (
      fields.isFinishedLiveReplay !== undefined &&
      this._isFinishedLiveReplay !== fields.isFinishedLiveReplay
    ) {
      this._isFinishedLiveReplay = fields.isFinishedLiveReplay;
      changed = true;
    }
    return changed;
  }

  /** Apply the player mute flag (host-wired; no RN mute callback exists). @internal */
  handleMuted(muted: boolean): boolean {
    if (this._muted === muted) return false;
    this._muted = muted;
    return true;
  }

  /**
   * Reset to initial. Returns whether it changed. `_muted` is PRESERVED across
   * clear (mute-preference-persist-across-switch): clear() is the VIDEO_SWITCH
   * in-place reset, NOT a teardown, so it MUST NOT reset the user's mute preference
   * — `_muted` is excluded from the isInitial check AND never reset here (mirrors
   * the `heartBurstTick` monotonic-preserve pattern). @internal
   */
  clear(): boolean {
    if (
      !this._isSubscribed &&
      this._viewerCount === 0 &&
      this._title.length === 0 &&
      this._hostName.length === 0 &&
      this._shopLogo.length === 0 &&
      this._shareUrl.length === 0 &&
      !this._isLive &&
      !this._isFinishedLiveReplay
    ) {
      return false;
    }
    this._isSubscribed = false;
    this._viewerCount = 0;
    // _muted intentionally NOT reset (preserved across in-place switch — see kdoc).
    this._title = '';
    this._hostName = '';
    this._shopLogo = '';
    this._shareUrl = '';
    this._isLive = false;
    this._isFinishedLiveReplay = false;
    return true;
  }
}

/**
 * VOD playback-progress view-model (VOD-2). `isReplay` = a LIVE stream scrubbed
 * behind the live edge — drives the LIVE bottom bar's "聊天室已關閉" variant. Host-fed
 * (the host echoes the native progress snapshot). diff-then-return-changed.
 */
export class DefaultPlaybackProgressState {
  private _position = 0;
  private _duration = 0;
  private _isPlaying = false;
  private _isReplay = false;

  get current(): PlaybackProgressState {
    return {
      position: this._position,
      duration: this._duration,
      isPlaying: this._isPlaying,
      isReplay: this._isReplay,
    };
  }

  /** Apply a host-fed progress snapshot. Returns whether any field changed. @internal */
  handleProgress(fields: {
    position: number;
    duration: number;
    isPlaying: boolean;
    isReplay: boolean;
  }): boolean {
    if (
      this._position === fields.position &&
      this._duration === fields.duration &&
      this._isPlaying === fields.isPlaying &&
      this._isReplay === fields.isReplay
    ) {
      return false;
    }
    this._position = fields.position;
    this._duration = fields.duration;
    this._isPlaying = fields.isPlaying;
    this._isReplay = fields.isReplay;
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (this._position === 0 && this._duration === 0 && !this._isPlaying && !this._isReplay) {
      return false;
    }
    this._position = 0;
    this._duration = 0;
    this._isPlaying = false;
    this._isReplay = false;
    return true;
  }
}

/**
 * SubtitleTrack view-model. `available` = `is_subtitle` (momentState
 * .subtitleAvailable); `enabled` = the current toggle (momentState
 * .subtitleEnabled). Host-wired via the moment snapshot.
 */
export class DefaultSubtitleState {
  private _available = false;
  private _enabled = false;

  get current(): SubtitleState {
    return { available: this._available, enabled: this._enabled };
  }

  /** Apply subtitle availability + toggle. Returns whether changed. @internal */
  handleSubtitle(available: boolean, enabled: boolean): boolean {
    if (this._available === available && this._enabled === enabled) return false;
    this._available = available;
    this._enabled = enabled;
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (!this._available && !this._enabled) return false;
    this._available = false;
    this._enabled = false;
    return true;
  }
}
