// player-chrome-template — VideoInfoPanel info-tab + two-tab switching view-model
// (behaviour / view-model layer; NO pixels). Mirrors `NoticeTab.ts`.
//
// Spec: ui-template-foundation/spec.md
//   § "Default Template VideoInfoPanel Info-Tab 與分頁切換狀態暴露".
// Design: design.md D4 / D6.
//
// core stays headless: it owns the `channel` data + the subscribe API. This model
// holds the info-tab `{ title, publishAt, shopName, shopIntro, shopLogo,
// isSubscribed }` and the two-tab switch `{ activeTab: info | notice }` so a host
// can draw `LBPSheetHeader` / `LBPBottomSheet`. The template never renders a tab.
//
// `isSubscribed` is NOT stored here — it MUST mirror the SAME truth as the
// PlayerHeader / moment-state subscribe value (component-contracts §Subscribe
// 雙處同步). The owning template injects it from the single PlayerHeader source,
// so the two never diverge (design R2). `description` is deliberately EXCLUDED
// (LBChannel has no such field — depending on it would force a core split).
//
// `info` is ALWAYS selectable; `notice` is selectable ONLY when the existing
// notice-tab `canOpen == true`. `selectTab(notice)` when un-openable is a no-op;
// when `canOpen` flips true→false while active, `activeTab` auto-falls back to
// `info` (no illegal "on an unselectable tab" state, design D4 / R4).
//
// RN wiring note (design D6): on RN the info-tab fields are HOST-FED (the host
// reads its channel and calls `handleInfo`, like notice-tab `injectNotices`).
//
// Mutators RETURN `boolean` (= "did this actually change") so the owning template
// coalesces exactly ONE notification per single info-tab mutation.

/** The two VideoInfoPanel tabs. */
export enum LBInfoPanelTab {
  Info = 'info',
  Notice = 'notice',
}

/**
 * Host-bindable info-tab "直播資訊" snapshot. `isSubscribed` mirrors the single
 * PlayerHeader / moment-state subscribe truth. `description` is intentionally
 * absent (LBChannel has no such field).
 */
export interface LBInfoTabState {
  readonly title: string;
  readonly publishAt: string;
  readonly shopName: string;
  readonly shopIntro: string;
  readonly shopLogo: string;
  readonly isSubscribed: boolean;
}

/**
 * info-tab + two-tab-switch view-model. Holds the info fields (host-fed) and the
 * active tab; the host reads {@link current} / {@link activeTab} and re-renders
 * on the change notification. `isSubscribed` is supplied by the owning template
 * from the single PlayerHeader source (not stored here). Each mutator returns
 * whether it changed so the template coalesces ONE notify.
 */
export class DefaultInfoTab {
  private _title = '';
  private _publishAt = '';
  private _shopName = '';
  private _shopIntro = '';
  private _shopLogo = '';
  private _activeTab: LBInfoPanelTab = LBInfoPanelTab.Info;

  // --- Read surface (public) ---

  /** Currently selected tab (initial `info`). */
  get activeTab(): LBInfoPanelTab {
    return this._activeTab;
  }

  /**
   * Host-bindable info-tab snapshot. `isSubscribed` is passed in (single
   * PlayerHeader / moment-state truth) — NOT stored here, so it can never drift.
   */
  currentWith(isSubscribed: boolean): LBInfoTabState {
    return {
      title: this._title,
      publishAt: this._publishAt,
      shopName: this._shopName,
      shopIntro: this._shopIntro,
      shopLogo: this._shopLogo,
      isSubscribed,
    };
  }

  // --- Mutators ---

  /**
   * Inject the info-tab fields (host-fed from the channel; native reads public
   * `channel`). `description` is intentionally not accepted. Returns whether any
   * field actually changed. @internal
   */
  handleInfo(fields: {
    title?: string;
    publishAt?: string;
    shopName?: string;
    shopIntro?: string;
    shopLogo?: string;
  }): boolean {
    let changed = false;
    if (fields.title !== undefined && this._title !== fields.title) {
      this._title = fields.title;
      changed = true;
    }
    if (fields.publishAt !== undefined && this._publishAt !== fields.publishAt) {
      this._publishAt = fields.publishAt;
      changed = true;
    }
    if (fields.shopName !== undefined && this._shopName !== fields.shopName) {
      this._shopName = fields.shopName;
      changed = true;
    }
    if (fields.shopIntro !== undefined && this._shopIntro !== fields.shopIntro) {
      this._shopIntro = fields.shopIntro;
      changed = true;
    }
    if (fields.shopLogo !== undefined && this._shopLogo !== fields.shopLogo) {
      this._shopLogo = fields.shopLogo;
      changed = true;
    }
    return changed;
  }

  /**
   * Select a tab. `info` is ALWAYS honoured. `notice` is honoured ONLY when the
   * notice-tab can open (`noticeCanOpen`); otherwise it is a no-op (activeTab
   * unchanged). Returns whether `activeTab` actually changed. @internal
   */
  selectTab(tab: LBInfoPanelTab, noticeCanOpen: boolean): boolean {
    if (tab === LBInfoPanelTab.Notice && !noticeCanOpen) return false; // no-op
    if (this._activeTab === tab) return false;
    this._activeTab = tab;
    return true;
  }

  /**
   * Notice-tab open-ability changed. If the active tab is `notice` and it can no
   * longer open (公告轉空), auto-fall-back to `info` (no illegal state, D4).
   * Returns whether `activeTab` changed. @internal
   */
  reconcileNoticeAvailability(noticeCanOpen: boolean): boolean {
    if (this._activeTab === LBInfoPanelTab.Notice && !noticeCanOpen) {
      this._activeTab = LBInfoPanelTab.Info;
      return true;
    }
    return false;
  }

  /** Reset on teardown / new video. Returns whether anything was non-initial. @internal */
  clear(): boolean {
    const isInitial =
      this._title.length === 0 &&
      this._publishAt.length === 0 &&
      this._shopName.length === 0 &&
      this._shopIntro.length === 0 &&
      this._shopLogo.length === 0 &&
      this._activeTab === LBInfoPanelTab.Info;
    if (isInitial) return false;
    this._title = '';
    this._publishAt = '';
    this._shopName = '';
    this._shopIntro = '';
    this._shopLogo = '';
    this._activeTab = LBInfoPanelTab.Info;
    return true;
  }
}
