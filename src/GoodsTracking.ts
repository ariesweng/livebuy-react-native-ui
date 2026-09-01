// await-toggle-and-notice-tab-template-state — goods-tracking dual-switch model
// (behaviour / view-model layer; NO pixels).
//
// Spec: ui-template-foundation/spec.md
//   § "Default Template 到貨追蹤與補貨通知雙開關狀態行為".
// Design: design.md D1 / D2 / D3.
//
// core stays headless: it owns the two independent endpoints (`setAwaitGoods`
// type=1 / `setNoticeGoods` type=2), the `LBProduct.isAwait` / `isAwaitNotice`
// source flags, and the authoritative `AWAIT_GOODS_CHANGED` /
// `NOTICE_GOODS_CHANGED` broadcasts. This model maps them into a per-`goodsGpn`
// host-bindable pair of INDEPENDENT (non-mutually-exclusive) flags so the host
// can draw two product-detail switches.
//
// RN wiring note (parity with the moment-state / auth-gate seam): the SDK
// delegation (`LivebuySDK.setAwaitGoods` / `setNoticeGoods`) is injected as
// callbacks (default no-op) EXACTLY like iOS's `setAwait` / `setNotice` ctor
// params — so the model itself never builds an HTTP request and stays unit-
// testable headless in jest (no native bridge required). The authoritative
// broadcasts arrive on the unified `registerListener` channel and the owning
// template feeds them to `applyAwaitBroadcast` / `applyNoticeBroadcast`.
//
// Mutators RETURN `boolean` (= "did this actually change") so the owning template
// coalesces exactly ONE notification per single goods-tracking mutation (parity
// with `MomentState` / `ErrorState`).

/** Host-wired delegate for a toggle → core `setAwaitGoods` / `setNoticeGoods`. */
export type GoodsTrackingSetter = (goodsGpn: string, enabled: boolean) => void;

/**
 * One host-bindable per-product flag pair. The two flags are INDEPENDENT — the
 * backend keeps two separate rows; toggling one MUST NOT move the other.
 */
export interface LBGoodsTrackingFlags {
  /** 到貨追蹤 (await, type=1) — mirrors `LBProduct.isAwait`. */
  readonly awaitEnabled: boolean;
  /** 補貨通知 (notice, type=2) — mirrors `LBProduct.isAwaitNotice`. */
  readonly noticeEnabled: boolean;
}

const BOTH_OFF: LBGoodsTrackingFlags = { awaitEnabled: false, noticeEnabled: false };

/**
 * Maps the core's goods-tracking endpoints + broadcasts into per-`goodsGpn`
 * host-bindable `{ awaitEnabled, noticeEnabled }`. The owning template seeds
 * initial flags from products, forwards toggle intents to the injected core
 * delegates, and corrects flags from the authoritative broadcasts. Each mutator
 * returns whether it actually changed so the template coalesces ONE notify.
 */
export class DefaultGoodsTracking {
  private readonly flagsByGpn = new Map<string, LBGoodsTrackingFlags>();
  private readonly setAwait: GoodsTrackingSetter;
  private readonly setNotice: GoodsTrackingSetter;

  /**
   * Injected core delegates (default no-op for headless unit tests). The wiring
   * fills them with `LivebuySDK.setAwaitGoods / setNoticeGoods` so the model
   * never builds an HTTP request itself (headless: writes go via core).
   */
  constructor(setAwait?: GoodsTrackingSetter, setNotice?: GoodsTrackingSetter) {
    this.setAwait = setAwait ?? (() => {});
    this.setNotice = setNotice ?? (() => {});
  }

  // --- Read surface (public) ---

  /**
   * Current flag pair for `goodsGpn` (both false when unseen — single source of
   * truth defaults to off until a seed / toggle / broadcast).
   */
  flags(goodsGpn: string): LBGoodsTrackingFlags {
    return this.flagsByGpn.get(goodsGpn) ?? BOTH_OFF;
  }

  /** 到貨追蹤 (type=1) flag for `goodsGpn`. */
  awaitEnabled(goodsGpn: string): boolean {
    return this.flags(goodsGpn).awaitEnabled;
  }

  /** 補貨通知 (type=2) flag for `goodsGpn`. */
  noticeEnabled(goodsGpn: string): boolean {
    return this.flags(goodsGpn).noticeEnabled;
  }

  // --- Seed (initial value; non-clobbering) ---

  /**
   * Seed the INITIAL flags for `goodsGpn` from `LBProduct.isAwait` /
   * `isAwaitNotice` (0/1 → bool). Non-clobbering: a key already known (seeded /
   * toggled / broadcast-corrected) is NOT overwritten — re-seeding from a stale
   * product snapshot MUST NOT clobber an optimistic / authoritative value (D3).
   * Returns true iff it set a new key. @internal
   */
  seed(goodsGpn: string, isAwait: number, isAwaitNotice: number): boolean {
    if (this.flagsByGpn.has(goodsGpn)) return false;
    this.flagsByGpn.set(goodsGpn, {
      awaitEnabled: isAwait !== 0,
      noticeEnabled: isAwaitNotice !== 0,
    });
    return true;
  }

  // --- Toggle intents (optimistic → delegate to core) ---

  /**
   * Toggle 到貨追蹤 (type=1): optimistically flip ONLY the await flag, then
   * delegate to `setAwaitGoods` with the new value. MUST NOT touch the notice
   * flag (non-mutual-exclusion). Returns true (a single optimistic flip always
   * changes the await flag). @internal
   */
  toggleAwait(goodsGpn: string): boolean {
    const cur = this.flags(goodsGpn);
    const next = !cur.awaitEnabled;
    this.flagsByGpn.set(goodsGpn, { awaitEnabled: next, noticeEnabled: cur.noticeEnabled });
    this.setAwait(goodsGpn, next);
    return true;
  }

  /**
   * Toggle 補貨通知 (type=2): optimistically flip ONLY the notice flag, then
   * delegate to `setNoticeGoods` with the new value. MUST NOT touch the await
   * flag. Returns true. @internal
   */
  toggleNotice(goodsGpn: string): boolean {
    const cur = this.flags(goodsGpn);
    const next = !cur.noticeEnabled;
    this.flagsByGpn.set(goodsGpn, { awaitEnabled: cur.awaitEnabled, noticeEnabled: next });
    this.setNotice(goodsGpn, next);
    return true;
  }

  // --- Broadcast correction (authoritative) ---

  /**
   * Correct the await flag from `AWAIT_GOODS_CHANGED` (authoritative). Touches
   * ONLY the await flag for `goodsGpn`; returns whether it changed. @internal
   */
  applyAwaitBroadcast(goodsGpn: string, enabled: boolean): boolean {
    const cur = this.flags(goodsGpn);
    if (cur.awaitEnabled === enabled) return false;
    this.flagsByGpn.set(goodsGpn, { awaitEnabled: enabled, noticeEnabled: cur.noticeEnabled });
    return true;
  }

  /**
   * Correct the notice flag from `NOTICE_GOODS_CHANGED` (authoritative). Touches
   * ONLY the notice flag for `goodsGpn`; returns whether it changed. @internal
   */
  applyNoticeBroadcast(goodsGpn: string, enabled: boolean): boolean {
    const cur = this.flags(goodsGpn);
    if (cur.noticeEnabled === enabled) return false;
    this.flagsByGpn.set(goodsGpn, { awaitEnabled: cur.awaitEnabled, noticeEnabled: enabled });
    return true;
  }

  /** Reset on teardown / new video. Returns whether anything was present. @internal */
  clear(): boolean {
    if (this.flagsByGpn.size === 0) return false;
    this.flagsByGpn.clear();
    return true;
  }
}
