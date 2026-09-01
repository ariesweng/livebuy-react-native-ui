// await-toggle-and-notice-tab-template-state — VideoInfoPanel notice-tab model
// (behaviour / view-model layer; NO pixels).
//
// Spec: ui-template-foundation/spec.md
//   § "Default Template VideoInfoPanel 公告分頁 open-state 行為".
// Design: design.md D4.
//
// core stays headless: it owns the `sys_notice` / `notice` data on the channel
// and the "公告分頁任一不為空才開放" contract. This model holds a snapshot of the
// two texts + an explicit `isOpen`, and DERIVES `canOpen` (either text
// non-empty) so it can never drift from the texts. On RN the texts are HOST-FED
// (the host reads its channel and calls `injectNotices`, like moment-state).
//
// Mutators RETURN `boolean` (= "did this actually change") so the owning template
// coalesces exactly ONE notification per single notice-tab mutation (parity with
// `MomentState` / `ErrorState`).

/**
 * One host-bindable notice-tab snapshot. `canOpen` is DERIVED (never stored
 * separately) so it can never drift from the texts.
 */
export interface LBNoticeTabState {
  /** Whether the panel may open at all — `true` iff either text is non-empty. */
  readonly canOpen: boolean;
  /** Whether the panel is currently expanded (only ever true when `canOpen`). */
  readonly isOpen: boolean;
  /** System notice text (`sys_notice`). */
  readonly systemNotice: string;
  /** Shop / video notice text (`notice`). */
  readonly notice: string;
}

/**
 * Maps the core's `sys_notice` / `notice` channel data into a host-bindable
 * notice-tab open-state. The owning template injects the latest texts (host-fed
 * from its channel) and the host toggles `isOpen` via `openNoticeTab` /
 * `closeNoticeTab`. Each mutator returns whether it changed so the template
 * coalesces ONE notify.
 */
export class DefaultNoticeTab {
  private _systemNotice = '';
  private _notice = '';
  private _isOpen = false;

  // --- Read surface (public) ---

  /** System notice text (`sys_notice`). */
  get systemNotice(): string {
    return this._systemNotice;
  }

  /** Shop / video notice text (`notice`). */
  get notice(): string {
    return this._notice;
  }

  /** Whether the panel is currently expanded. */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * DERIVED: the panel may open iff either notice text is non-empty (aligns with
   * core "公告分頁任一不為空才開放"). Never stored — always computed from texts.
   */
  get canOpen(): boolean {
    return this._systemNotice.length > 0 || this._notice.length > 0;
  }

  /** Host-bindable snapshot. */
  get current(): LBNoticeTabState {
    return {
      canOpen: this.canOpen,
      isOpen: this._isOpen,
      systemNotice: this._systemNotice,
      notice: this._notice,
    };
  }

  // --- Mutators ---

  /**
   * Inject the latest notice texts (host-fed from its channel). If the texts
   * change such that the panel becomes un-openable while open, `isOpen` is forced
   * false (no illegal "open but not openable" state, D4). Returns whether
   * anything changed. @internal
   */
  injectNotices(systemNotice: string, notice: string): boolean {
    if (systemNotice === this._systemNotice && notice === this._notice) return false;
    this._systemNotice = systemNotice;
    this._notice = notice;
    if (!this.canOpen) this._isOpen = false;
    return true;
  }

  /**
   * Host opens the panel — only honoured when `canOpen` (un-openable → no-op).
   * Returns whether `isOpen` flipped. @internal
   */
  openNoticeTab(): boolean {
    if (!this.canOpen || this._isOpen) return false;
    this._isOpen = true;
    return true;
  }

  /** Host closes the panel. Returns whether `isOpen` flipped. @internal */
  closeNoticeTab(): boolean {
    if (!this._isOpen) return false;
    this._isOpen = false;
    return true;
  }

  /** Reset on teardown / new video. Returns whether anything was present. @internal */
  clear(): boolean {
    if (this._systemNotice.length === 0 && this._notice.length === 0 && !this._isOpen) {
      return false;
    }
    this._systemNotice = '';
    this._notice = '';
    this._isOpen = false;
    return true;
  }
}
