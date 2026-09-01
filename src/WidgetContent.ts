// widget-content-template — Default widget-content view-model (behaviour /
// view-model layer; NO pixels).
//
// Spec: ui-template-foundation/spec.md § "Default Template Widget 內容 view-model
// 暴露". Design: design.md D1 (thin-wrapper, option B) / D2 (mirrors core, single
// source of truth stays in core `LivebuyWidget`) / D3 (`minimized` derived from
// floating `isClosed`) / D4 (colors bind `widget-bridge-color-core`, missing →
// core defaults) / D7 (RN host-wired typed source).
//
// core stays headless: it owns `LivebuyWidget` (videos / mode / currentPage /
// lastPage / liveVideo / isClosed), `loadFirstPage` / `requestLoadMore`, and the
// `POST /sdk/widget` fetch. This model only MIRRORS that public state into a
// host-bindable snapshot so reference-ui / the host can draw `widgets.jsx`
// (`LBPCarousel` / `LBPCarouselCard` / `LBPVideoShop` / `LBPFloatingWidget`).
// The template never renders any card / row / floating window / minimized bubble.
//
// RN wiring note (design D7 — host-wired typed source): on iOS / Android the
// widget template binds the core `LivebuyWidget` instance directly and reacts to
// its callbacks. On RN the JS template layer cannot hold the native widget, so —
// parity with the moment-state host-wired precedent — the HOST forwards the
// widget's typed content (videos / pagination / mode / isClosed) into
// `handleWidgetSnapshot`, and the `/sdk/widget` response-root settings (the
// fields not derivable from the widget instance — the web-embed colors from
// `widget-bridge-color-core` plus `product_card` from
// `widget-product-card-bridge-rn`, bridged as the `LBWidgetResponse` event →
// camelCase `LBWidgetSettings`) into `handleWidgetColors`. The template owns the
// mapping + the `minimized` derivation + the missing-value fallback on all
// platforms — only the host-wired seam differs (inherent to RN's host-owned
// widget UI).
//
// widget-product-card-content-template — `productCard` rides that SAME colors
// channel (no new data path); it is raw passthrough and this layer NEVER
// substitutes the backend default `'inside'`.

import type { LBVideoItem, LBWidgetColors } from 'livebuy-react-native';

/**
 * Host-bindable widget layout mode for `widgets.jsx`. `carousel` / `grid` /
 * `floating` map one-to-one to core `WidgetMode`; `minimized` is a TEMPLATE-
 * DERIVED state (core has no such enum) produced when a floating widget's
 * `isClosed == true` (user closed the floating window, sticky for the session) —
 * aligned to the design `LBPMinimizedWidget` bubble (D3).
 */
export enum LBWidgetContentMode {
  Carousel = 'carousel',
  Grid = 'grid',
  Floating = 'floating',
  Minimized = 'minimized',
}

/**
 * One host-bindable widget-content snapshot. Mirrors core `LivebuyWidget` public
 * state + the `widget-bridge-color-core` colors. The host re-reads this on each
 * change notification and draws the card row / grid / floating / minimized
 * bubble itself (the template renders nothing).
 */
export interface LBWidgetContent {
  /** Card-row data (core `LivebuyWidget.videos`, read-only mirror). */
  readonly videos: readonly LBVideoItem[];
  /** Layout mode (carousel / grid / floating / minimized — D3). */
  readonly mode: LBWidgetContentMode;
  /** Pagination cursor (core `LivebuyWidget.currentPage`). */
  readonly currentPage: number;
  /** Last page (core `LivebuyWidget.lastPage`); host gates "load more". */
  readonly lastPage: number;
  /** Floating single live card (core `LivebuyWidget.liveVideo`), or null. */
  readonly liveVideo: LBVideoItem | null;
  /**
   * web-embed text color RAW PASSTHROUGH (1=black / 2=white). Bound from
   * `widget-bridge-color-core`; the template MUST NOT interpret the semantics.
   * Missing → core default `1` (D4).
   */
  readonly widgetColor: number;
  /**
   * web-embed background color RAW PASSTHROUGH (Int 1=transparent → "1",
   * otherwise hex). Bound from `widget-bridge-color-core`; missing → `null` (D4).
   */
  readonly widgetBgcolor: string | null;
  /**
   * Carousel card's product-card display mode (`product_card`) RAW PASSTHROUGH.
   * Backend domain `'below'` / `'inside'` / `'hidden'`, backend default
   * `'inside'`; an unrecognized value is kept verbatim.
   *
   * `null` means THE BACKEND SENT NOTHING (the linetv branch omits it,
   * `/sdk/widget/live` does not carry it, and nothing has loaded yet) — a
   * DIFFERENT fact from the backend sending `'inside'`, so this layer never
   * substitutes the backend default. Applying a default is the reference-ui
   * layer's job (widget-product-card-content-template D2).
   */
  readonly productCard: string | null;
}

/**
 * What the template accepts for the `/sdk/widget` response-root settings feed.
 *
 * It is the core bridge's `LBWidgetColors` WIDENED with an optional
 * `productCard`, rather than the bridge's `LBWidgetSettings` (which requires
 * `productCard`), so BOTH call shapes stay legal: the bridge's
 * `LBWidgetSettings` is assignable here, and an existing host that still passes
 * a bare `{ widgetColor, widgetBgcolor }` object keeps compiling. Narrowing the
 * parameter to `LBWidgetSettings` would have broken every existing caller
 * (parameter positions are contravariant) — see design D3.
 */
export type LBWidgetSettingsInput = LBWidgetColors & {
  readonly productCard?: string | null;
};

/** A raw core `WidgetMode`-like value (the host forwards the widget's mode). */
export type LBWidgetCoreMode = 'carousel' | 'grid' | 'floating';

/** Host-forwarded widget-content snapshot (the typed source, design D7). */
export interface LBWidgetSnapshot {
  videos?: readonly LBVideoItem[];
  mode?: LBWidgetCoreMode;
  currentPage?: number;
  lastPage?: number;
  liveVideo?: LBVideoItem | null;
  /** Floating closed flag → `minimized` derivation (D3). */
  isClosed?: boolean;
}

/**
 * Pure mapping of a core `WidgetMode` + floating `isClosed` → the host-bindable
 * {@link LBWidgetContentMode} (D3). `carousel` / `grid` map directly. `floating`
 * derives `minimized` when `isClosed == true`, else `floating`. Any unknown /
 * not-applicable combo falls back to {@link LBWidgetContentMode.Carousel} (the
 * default core mode) — never throws, never corrupts the state model.
 */
export function widgetContentMode(
  coreMode: LBWidgetCoreMode | string,
  isClosed: boolean,
): LBWidgetContentMode {
  switch (coreMode) {
    case 'carousel':
      return LBWidgetContentMode.Carousel;
    case 'grid':
      return LBWidgetContentMode.Grid;
    case 'floating':
      return isClosed ? LBWidgetContentMode.Minimized : LBWidgetContentMode.Floating;
    default:
      return LBWidgetContentMode.Carousel;
  }
}

/**
 * Decode a snake_case widget-content wire snapshot (design D7 / R4: the wire
 * contract is snake_case `videos` / `current_page` / `last_page` / `mode` /
 * `live_video` / `is_closed`) into the typed {@link LBWidgetSnapshot} the model
 * consumes. Provided so a host that receives a raw snake_case payload (parity
 * with the player template's `routeEvent` snake_case decode) can forward it
 * directly; only present keys are decoded (omitted keys stay `undefined` → the
 * model keeps the prior facet). The widget COLORS (`widget_color` /
 * `widget_bgcolor`) are NOT decoded here — they arrive already mapped to
 * camelCase `LBWidgetColors` from `widget-bridge-color-core`'s bridge mapper
 * (`onWidgetResponse`), the correct layer boundary.
 */
export function decodeWidgetSnapshot(params: Record<string, unknown>): LBWidgetSnapshot {
  const out: LBWidgetSnapshot = {};
  if (Array.isArray(params.videos)) out.videos = params.videos as readonly LBVideoItem[];
  if (params.mode === 'carousel' || params.mode === 'grid' || params.mode === 'floating') {
    out.mode = params.mode;
  }
  if (typeof params.current_page === 'number') out.currentPage = params.current_page;
  if (typeof params.last_page === 'number') out.lastPage = params.last_page;
  if (params.live_video !== undefined) {
    out.liveVideo = (params.live_video as LBVideoItem | null) ?? null;
  }
  if (typeof params.is_closed === 'boolean') out.isClosed = params.is_closed;
  return out;
}

/**
 * Widget-content view-model. The owning {@link DefaultWidgetTemplate} feeds it
 * {@link handleSnapshot} (host forwards the core widget's typed videos /
 * pagination / mode / isClosed) and {@link handleColors} (the bridge
 * `LBWidgetResponse` → `LBWidgetColors`, the only field not on the widget
 * instance). The host reads {@link current} and re-renders on the template's
 * change notification. Each mutator returns whether it actually changed state so
 * the template coalesces EXACTLY ONE notification per single change (D6).
 *
 * D2 — this model does NOT hold a second copy of the truth: it mirrors the
 * core-forwarded snapshot. The single source of truth stays in core
 * `LivebuyWidget` (videos / pagination / mode / isClosed) + the
 * `widget-bridge-color-core` color snapshot.
 */
export class DefaultWidgetContent {
  // Mirrored raw core state. `_coreMode` / `_isClosed` are kept so a colors-only
  // or a partial snapshot re-derives `mode` consistently (D3).
  private _videos: readonly LBVideoItem[] = [];
  private _coreMode: LBWidgetCoreMode | string = 'carousel';
  private _isClosed = false;
  private _currentPage = 0;
  private _lastPage = 0;
  private _liveVideo: LBVideoItem | null = null;
  // D4 — color defaults align the core DTO fallback (widgetColor = 1 /
  // widgetBgcolor = nil) so the model is correct even before
  // `widget-bridge-color-core` delivers a value.
  private _widgetColor = 1;
  private _widgetBgcolor: string | null = null;
  // widget-product-card-content-template D2 — the seed is `null` ("backend sent
  // nothing"), NOT the backend default 'inside'.
  private _productCard: string | null = null;

  /** Current host-bindable widget-content snapshot. */
  get current(): LBWidgetContent {
    return {
      videos: this._videos,
      mode: widgetContentMode(this._coreMode, this._isClosed),
      currentPage: this._currentPage,
      lastPage: this._lastPage,
      liveVideo: this._liveVideo,
      widgetColor: this._widgetColor,
      widgetBgcolor: this._widgetBgcolor,
      productCard: this._productCard,
    };
  }

  /**
   * Apply a host-forwarded core-widget snapshot (videos / mode / pagination /
   * liveVideo / isClosed). Only the supplied facets are updated; omitted facets
   * keep their last value. Returns whether ANY facet actually changed (so the
   * template coalesces ONE notification for the whole snapshot, D6).
   */
  handleSnapshot(snapshot: LBWidgetSnapshot): boolean {
    let changed = false;
    if (snapshot.videos !== undefined && snapshot.videos !== this._videos) {
      this._videos = snapshot.videos;
      changed = true;
    }
    if (snapshot.mode !== undefined && snapshot.mode !== this._coreMode) {
      this._coreMode = snapshot.mode;
      changed = true;
    }
    if (snapshot.isClosed !== undefined && snapshot.isClosed !== this._isClosed) {
      this._isClosed = snapshot.isClosed;
      changed = true;
    }
    if (snapshot.currentPage !== undefined && snapshot.currentPage !== this._currentPage) {
      this._currentPage = snapshot.currentPage;
      changed = true;
    }
    if (snapshot.lastPage !== undefined && snapshot.lastPage !== this._lastPage) {
      this._lastPage = snapshot.lastPage;
      changed = true;
    }
    if (snapshot.liveVideo !== undefined && snapshot.liveVideo !== this._liveVideo) {
      this._liveVideo = snapshot.liveVideo;
      changed = true;
    }
    return changed;
  }

  /**
   * Apply the `/sdk/widget` response-root settings (the camelCase
   * `LBWidgetSettings` / `LBWidgetColors` the bridge maps from the snake_case
   * `LBWidgetResponse` event / `fetchWidget` map). RAW PASSTHROUGH — the template
   * MUST NOT interpret the color or display-mode semantics. Returns whether any
   * field actually changed.
   *
   * The argument is ONE response's complete root-settings snapshot, not a patch:
   * an omitted `productCard` therefore lands on `null` ("this response carried no
   * `product_card`"), which is exactly what an existing colors-only caller means.
   * The backend default `'inside'` is NEVER substituted here (D2 / D4).
   */
  handleColors(settings: LBWidgetSettingsInput): boolean {
    let changed = false;
    if (settings.widgetColor !== this._widgetColor) {
      this._widgetColor = settings.widgetColor;
      changed = true;
    }
    if (settings.widgetBgcolor !== this._widgetBgcolor) {
      this._widgetBgcolor = settings.widgetBgcolor;
      changed = true;
    }
    const nextProductCard = settings.productCard ?? null;
    if (nextProductCard !== this._productCard) {
      this._productCard = nextProductCard;
      changed = true;
    }
    return changed;
  }

  /**
   * Floating widget closed (user closed the floating window). Derives
   * `mode == minimized` while `coreMode == floating` (D3). Returns whether the
   * derived mode actually changed.
   */
  handleClose(): boolean {
    if (this._isClosed) return false;
    this._isClosed = true;
    return true;
  }

  /** Reset to core defaults (parity with the player template `clear()`). */
  clear(): boolean {
    const wasDefault =
      this._videos.length === 0 &&
      this._coreMode === 'carousel' &&
      !this._isClosed &&
      this._currentPage === 0 &&
      this._lastPage === 0 &&
      this._liveVideo === null &&
      this._widgetColor === 1 &&
      this._widgetBgcolor === null &&
      this._productCard === null;
    this._videos = [];
    this._coreMode = 'carousel';
    this._isClosed = false;
    this._currentPage = 0;
    this._lastPage = 0;
    this._liveVideo = null;
    this._widgetColor = 1;
    this._widgetBgcolor = null;
    this._productCard = null;
    return !wasDefault;
  }
}
