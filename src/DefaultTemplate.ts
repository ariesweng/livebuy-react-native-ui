import type {
  SDKConfig,
  LBWinner,
  LBAwardClaimInput,
  LBAwardClaimResultParams,
  LBProduct,
  LBActiveEvent,
} from 'livebuy-react-native';
// url-open-host-routing-template-rn — the URL-open verdict (core `url-open-policy-rn`).
// Imported through the PACKAGE-SCOPED DEEP PATH on purpose (measured, see design.md D-B):
//   • the package ROOT barrel (`livebuy-react-native`) pulls in `LivebuySDK` → `react-native`,
//     which a value import cannot resolve under this package's jest setup — every test file
//     would fail at import time (the existing type-only import above is erased, so it is fine);
//   • a cross-package RELATIVE path (`../../react-native/src/...`) would escape the package
//     boundary and stop resolving once this package is published to npm.
// `livebuy-react-native` is a peer dependency and ships `src/` in its `files`, so this path
// resolves both in-repo and from the published tarball.
import { LBURLOpenPolicy } from 'livebuy-react-native/src/LBURLOpenPolicy';
import { ConfigMerger } from './ConfigMerger';
import type { LBUIOptions } from './LBUIOptions';
import { ActivityTier, MergedActivityFeed, PRODUCT_PUSH_COLOR } from './ActivityFeed';
import { PlayerErrorStateModel, type PlayerErrorState } from './ErrorState';
import {
  DefaultStartScreenState,
  StartScreenPhase,
  DefaultEndScreenState,
  DefaultProductOverlayState,
  DefaultPlayerHeaderState,
  DefaultPlaybackProgressState,
  DefaultSubtitleState,
  DefaultUpcomingState,
  isUpcomingChannel,
  type StartScreenState,
  type EndScreenState,
  type ProductOverlayState,
  type PlayerHeaderState,
  type PlaybackProgressState,
  type SubtitleState,
  type UpcomingState,
  type EndScreenNavRow,
  type EndScreenHotRow,
} from './MomentState';
import {
  AwardClaimClassification,
  AwardClaimResultState,
  UnclaimedWinSet,
  classifyAward,
  isValidClaimEmail,
  mapAwardClaimResult,
  type RequestAwardClaimWithContact,
} from './AwardClaimFlow';
import {
  DefaultAuthGate,
  DefaultIdentityLabel,
  type LBAuthGateState,
  type LBIdentityLabel,
} from './AuthGate';
import {
  DefaultGoodsTracking,
  type GoodsTrackingSetter,
  type LBGoodsTrackingFlags,
} from './GoodsTracking';
import { DefaultNoticeTab, type LBNoticeTabState } from './NoticeTab';
import {
  DefaultOperationRail,
  type LBSideRailItem,
  type LBSideRailEnablement,
} from './OperationRail';
import {
  DefaultInfoTab,
  LBInfoPanelTab,
  type LBInfoTabState,
} from './InfoTab';
import {
  DefaultProductSheet,
  DefaultVariantPicker,
  DefaultQtyStepper,
  DefaultMiniCart,
  DefaultCartCTA,
  type CartAddRequester,
  type LBProductDetailState,
  type LBVariantState,
  type LBQtyState,
  type LBMiniCartPeek,
  type LBCartCTAState,
} from './ProductSheet';
import { DefaultPlayerNavigation, type LBPlayerNavigationState } from './PlayerNavigation';
import { ChangeEmitter, type ChangeListener, type Unsubscribe } from './ChangeEmitter';
import {
  DefaultWidgetContent,
  LBWidgetContentMode,
  type LBWidgetContent,
  type LBWidgetSnapshot,
  type LBWidgetSettingsInput,
} from './WidgetContent';

/** Marker class identifying the built-in Default template. */
export class DefaultTemplate {}

/**
 * Well-known layout keys each Default template understands (Task 3.1 / D7).
 * Used to detect keys the backend (`sdkConfig.layout`) sends that this
 * template version does not recognise — they are silently ignored (no crash,
 * other keys unaffected) but surfaced via a debug log as an upgrade hint.
 */
const KNOWN_PLAYER_LAYOUT_KEYS: ReadonlySet<string> = new Set([
  'productOverlay_position',
  'productOverlay_style',
]);
const KNOWN_WIDGET_LAYOUT_KEYS: ReadonlySet<string> = new Set([
  'carousel_effect',
  'carousel_autoPlay',
  'grid_columns',
]);

/**
 * Diff the backend-sent layout map against the template's well-known key set
 * and debug-log any key this template does not recognise (Task 3.1 / 3.2).
 * Silent ignore is preserved — this only emits a hint, never throws.
 */
function logUnknownLayoutKeys(
  scope: 'player' | 'widget',
  incoming: Record<string, unknown> | null | undefined,
  known: ReadonlySet<string>,
): void {
  if (incoming == null) return;
  for (const key of Object.keys(incoming)) {
    if (!known.has(key) && __DEV__) {
      console.warn(`[LivebuyUI] unrecognized ${scope} layout key: ${key}`);
    }
  }
}

/**
 * In-app browser opener (Task 2.4 / 2.5). Injectable so unit tests can verify
 * the diversion path with a fake opener. Default delegates to the core RN
 * bridge command `openInAppBrowser` (provided by fix-ui-template-default-parity-core).
 *
 * url-open-host-routing-template-rn — this seam is the **`'inApp'` branch only**.
 * It receives `LBURLOpenDecision.url` (the verdict's URL), NOT the raw
 * `LBProduct.diversionUrl`. The `'external'` branch goes to
 * {@link ExternalUrlOpener} and MUST NOT be loaded here. See
 * {@link DefaultPlayerTemplate.openResolvedUrl} — the single URL exit.
 */
export type InAppBrowserOpener = (url: string) => void;

/**
 * System URL-router opener (url-open-host-routing-template-rn) — the sibling of
 * {@link InAppBrowserOpener} for verdicts whose target is `'external'`.
 *
 * Semantics are a **contract, not a hint**: the URL MUST be handed to the system
 * URL router (`Linking.openURL`); it MUST NOT be loaded into an in-app browser or
 * any WebView (e.g. `react-native-webview`) — that would evaluate an off-site URL
 * under the origin of whatever page is already loaded. The user may leave the App.
 *
 * Kept as a **separate** seam rather than adding a `target` argument to
 * {@link InAppBrowserOpener}: with one seam an injector that forgets to branch on
 * `target` violates the contract silently, whereas two seams make「external sent
 * into the in-app browser」something you have to write on purpose.
 *
 * Injectable so unit tests can observe **which** seam fired and **what value** it
 * received — that pair is the only evidence the routing actually happened.
 * Like {@link InAppBrowserOpener}, this receives the verdict's URL, not the raw
 * `diversionUrl`.
 */
export type ExternalUrlOpener = (url: string) => void;

/**
 * Tolerant `enabled` decode for the unified `AWAIT/NOTICE_GOODS_CHANGED` params.
 * The core wire type is `boolean`, but the JSON decoder fallback (CLAUDE.md) may
 * surface a Bool field as Int 0/1 — accept both, anything else → false.
 */
function asBool(v: unknown): boolean {
  return v === true || v === 1;
}

// Lazy require: the value import of `livebuy-react-native` pulls in the native
// bridge (`NativeModules`), which is unavailable in node/jest. Tests inject a
// fake opener and never reach this; only a real RN runtime evaluates it.
const defaultInAppBrowserOpener: InAppBrowserOpener = (url) => {
  const { LivebuySDK } = require('livebuy-react-native');
  LivebuySDK.openInAppBrowser(url);
};

// url-open-host-routing-template-rn — default `'external'` opener. `Linking` is a
// PUBLIC React Native API usable from any layer, so routing to the system URL
// router needs NO new bridge command and NO core change (core's
// `LBURLOpenPolicy` doc already names `Linking.openURL` as the RN external
// presentation).
//
// Lazy `require` for the SAME reason as `defaultInAppBrowserOpener`, and this is
// MEASURED, not assumed: under this package's jest setup (`ts-jest` +
// `testEnvironment: node`, no react-native preset) a top-level value import of
// `react-native` throws `Cannot use import statement outside a module`, which
// would break EVERY test file that imports this template. Tests inject a fake
// opener and never reach this; only a real RN runtime evaluates it.
//
// `Linking.openURL` returns a Promise that rejects when no handler exists; that
// rejection is deliberately NOT caught here (it is RN-runtime behaviour, and the
// seam is injectable — a host wanting custom error handling injects its own).
const defaultExternalUrlOpener: ExternalUrlOpener = (url) => {
  const { Linking } = require('react-native');
  Linking.openURL(url);
};

// await-toggle-and-notice-tab-template-state — default goods-tracking delegates.
// The template NEVER builds HTTP; it delegates the toggle to the core public
// methods `LivebuySDK.setAwaitGoods` (type=1 → /sdk/goods/await) /
// `setNoticeGoods` (type=2 → /sdk/goods/notice). Lazy-required (same seam as
// `defaultInAppBrowserOpener`): the value import pulls in `NativeModules`, which
// is unavailable in node/jest, so tests inject capturing fakes and never reach
// these; only a real RN runtime evaluates them. The core dispatches the
// authoritative `AWAIT_GOODS_CHANGED` / `NOTICE_GOODS_CHANGED` broadcast once the
// write completes (the template corrects its optimistic flag from that).
const defaultSetAwaitGoods: GoodsTrackingSetter = (goodsGpn, enabled) => {
  const { LivebuySDK } = require('livebuy-react-native');
  LivebuySDK.setAwaitGoods(goodsGpn, enabled);
};
const defaultSetNoticeGoods: GoodsTrackingSetter = (goodsGpn, enabled) => {
  const { LivebuySDK } = require('livebuy-react-native');
  LivebuySDK.setNoticeGoods(goodsGpn, enabled);
};

// product-sheet-stack-template — default add-to-cart requester (route B). Parity
// with the goods-tracking delegates: the template NEVER builds HTTP; it delegates
// the add to the core public `LivebuySDK.addToCart`. The host (which owns the
// configured `shopId`) is expected to inject a requester that supplies `shopId`;
// when omitted, this default rejects (the template's add is then inert) so a
// headless jest test never reaches the native bridge. Injectable so unit tests
// capture the delegated request with a fake.
const defaultAddToCartRequester: CartAddRequester = () =>
  Promise.reject(
    new Error(
      '[LivebuyUI] addToCartRequester not wired — the host must inject it (it owns the configured shopId).',
    ),
  );

/**
 * Pure classifier (parity iOS/Android `isAddToCartAuthRequired`): `true` only for the core
 *「needs login」signal — the documented `LBError` `{ type: 'serverError', code: 401 }` (raised
 * for an empty `buy_no`). `false` for every other rejection (other server codes / network /
 * the「not wired」default / plain Errors). `code` is tolerated as number or numeric string.
 * Extracted so the route-B catch's branching is unit-testable in isolation.
 */
export function isAddToCartAuthRequired(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { type?: unknown; code?: unknown };
  const code = typeof e.code === 'string' ? Number(e.code) : e.code;
  return e.type === 'serverError' && code === 401;
}

/**
 * Pure classifier (cart-add-tier2-unify, parity iOS/Android `LBError.cartAddDeduplicated`):
 * `true` only for the core 30s 重複加購 dedupe-hit — the documented typed `LBError`
 * `{ type: 'cartAddDeduplicated' }`. `false` for every other rejection. Extracted so the
 * route-B catch's branching is unit-testable in isolation.
 */
export function isAddToCartDeduplicated(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  return (error as { type?: unknown }).type === 'cartAddDeduplicated';
}

/**
 * Effective config snapshot for a Player / Widget instance.
 * Read once at instantiate time (D6 — not reactive).
 */
export class EffectiveConfig {
  private readonly sdkConfig: SDKConfig;
  private readonly hostOptions: LBUIOptions | null | undefined;

  constructor(sdkConfig: SDKConfig, hostOptions?: LBUIOptions | null) {
    this.sdkConfig = sdkConfig;
    this.hostOptions = hostOptions;
  }

  layoutValue(key: string, defaultValue: unknown): unknown {
    // templateDefaults always contains `key`, so the merge never returns
    // undefined for a well-known key — the old `result === undefined` warn was
    // dead code (D7). Unknown-key detection now happens once at instantiate
    // time via logUnknownLayoutKeys() in the template constructors.
    const result = ConfigMerger.effectiveLayoutValue(
      key,
      this.sdkConfig.layout?.player,
      this.hostOptions?.layoutPlayer,
      { [key]: defaultValue },
    );
    return result ?? defaultValue;
  }

  widgetLayoutValue(key: string, defaultValue: unknown): unknown {
    const result = ConfigMerger.effectiveLayoutValue(
      key,
      this.sdkConfig.layout?.widget,
      this.hostOptions?.layoutWidget,
      { [key]: defaultValue },
    );
    return result ?? defaultValue;
  }
}

/**
 * Default Player template event handler (Tasks 7.5, 7.7).
 *
 * `DISMISS_REQUEST` → navigationRef.goBack() or provided callback
 *
 * ## Host contract (expose-default-template-bindable-state)
 *
 * This class is the per-Player Default template instance the host obtains via
 * the public accessor {@link attachPlayerTemplate}().{@link
 * PlayerTemplateAttachment.template template}. Its READ surface is part of the
 * public, module-external contract:
 *
 *   - {@link feedItems}            — merged activity+chat feed (oldest→newest)
 *   - {@link unclaimedCount}       — unclaimed-win count
 *   - {@link unclaimedWinners}     — unclaimed winners
 *   - {@link awardClaimResultState}— latest award-claim result-state (or null)
 *   - {@link subscribe}            — coalesced change notification (§B)
 *
 * The host CONSUMES this state and re-reads it on each {@link subscribe}
 * notification. The INTERNAL wiring — the `handle*` event-ingest methods and the
 * `submitAwardClaim` action — exists so the bridge can feed core events; hosts
 * do not construct the instance themselves (use {@link attachPlayerTemplate})
 * nor dispatch events directly.
 */

/**
 * Whether a (non-event-begin, non-product-push) `push[]` row is a SYSTEM / 事件 / 促銷 notice
 * rather than free user chat — used to route it through the DE-DUPED
 * `MergedActivityFeed.appendSystemNotice` path. Flagged by event metadata (`eid > 0`, e.g.
 * event-end / event-tied), OR promo metadata (`ct` / `p`). NOTE: the product-push color
 * ({@link PRODUCT_PUSH_COLOR}, spec §PollManager fan-out) is handled BEFORE this check in
 * `handlePush` (→ the `intro` activity row), so it is NOT part of this predicate. Ordinary user
 * chat carries none of these → stays un-deduped. Exported for tests.
 */
export function isSystemNoticePush(opts?: {
  eid?: number;
  color?: string;
  ct?: string;
  p?: string;
}): boolean {
  return (
    (typeof opts?.eid === 'number' && opts.eid > 0) ||
    (typeof opts?.ct === 'string' && opts.ct.length > 0) ||
    (typeof opts?.p === 'string' && opts.p.length > 0)
  );
}

/**
 * 置頂留言（chat-message-taxonomy ⑤，messages `data.top`，parity iOS `LBPinnedMessage`）。`kind`
 * 為 wire 字串（僅 `comment`（`name` 非空）或 `host`（`name` 空），上游無法細分）。reference-ui 讀
 * {@link DefaultPlayerTemplate.pinnedMessage} 渲染置頂橫幅。
 */
export interface PinnedMessage {
  readonly kind: string;
  readonly text: string;
  readonly name: string;
  readonly id: number;
}

/** Decode a unified POLL_RECEIVED `top` (`{kind, text, name, id}`) → {@link PinnedMessage} | null. */
function decodePinned(raw: unknown): PinnedMessage | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as { kind?: unknown; text?: unknown; name?: unknown; id?: unknown };
  const text = typeof r.text === 'string' ? r.text : '';
  if (text.length === 0) return null; // 無有效置頂文字 → 視為無釘選
  return {
    kind: typeof r.kind === 'string' ? r.kind : 'comment',
    text,
    name: typeof r.name === 'string' ? r.name : '',
    id: typeof r.id === 'number' ? r.id : 0,
  };
}

/** Value-equality for two pinned messages (diff-then-notify). */
function samePinned(a: PinnedMessage | null, b: PinnedMessage | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return a.kind === b.kind && a.text === b.text && a.name === b.name && a.id === b.id;
}

/**
 * activity-sheet-multi-activity-template-rn — pure: clamp a page index into the
 * valid range `[0, length - 1]` for a list of length `length` (design.md D5).
 * `length <= 0` (empty `activities`) clamps to `0` — matches {@link
 * DefaultPlayerTemplate.currentActivity} reading `activities[0]` naturally being
 * `undefined` → `null`. Non-finite input (`NaN` / `±Infinity`) clamps to `0`
 * rather than propagating; this is a UI page index, not a network request, so it
 * MUST NOT throw. `Math.trunc` tolerates a non-integer input. Exported so unit
 * tests can exercise it without constructing a `DefaultPlayerTemplate`
 * (docs/unit-test-discipline.md — pure-function extraction).
 */
export function clampActivityPageIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length - 1);
}

export class DefaultPlayerTemplate {
  private readonly effectiveConfig: EffectiveConfig;
  private readonly onDismiss?: () => void;
  private readonly openInAppBrowser: InAppBrowserOpener;
  /** url-open-host-routing-template-rn — the `'external'` seam (system URL router). */
  private readonly openExternalUrl: ExternalUrlOpener;
  private readonly requestAwardClaim?: RequestAwardClaimWithContact;
  private readonly requestEventJoin?: (eid: number, keyword: string) => void;

  /**
   * Player error-state model (livebuy-ui-event-join-and-error-state-template).
   * Host binds {@link playerErrorState} for `LBPErrorScreen`. The host wires the
   * bridge `LBError` event (carries the cross-platform `type`) → {@link
   * handleError}; clearing is auto-driven from the unified `VIDEO_STATE_CHANGE`
   * via {@link handlePlayerStateChange}.
   */
  private readonly errorState = new PlayerErrorStateModel();

  /**
   * expose-player-moment-state-template — five host-bindable player "moment"
   * view-models. Host binds {@link startScreenState} / {@link endScreenState} /
   * {@link productOverlayState} / {@link playerHeaderState} / {@link
   * subtitleState} to draw `moments.jsx`. momentState is NOT bridged to RN
   * (intentional), so the host wires the player's typed moment sources →
   * {@link handleMomentSnapshot} / {@link handleMutedChange} /
   * {@link handleEndScreenCountdown} / {@link handleAutoNextCancelled}, EXACTLY
   * like the host wires the bridge `LBError` event to {@link handleError}.
   * StartScreen.phase is the only auto-fed facet (driven from the unified
   * `VIDEO_STATE_CHANGE` via {@link handlePlayerStateChange}). Each model
   * reports whether it actually changed so the template coalesces ONE notify.
   */
  private readonly startScreen = new DefaultStartScreenState();
  private readonly endScreen = new DefaultEndScreenState();
  private readonly productOverlay = new DefaultProductOverlayState();
  private readonly playerHeader = new DefaultPlayerHeaderState();
  private readonly playbackProgress = new DefaultPlaybackProgressState();
  private readonly subtitle = new DefaultSubtitleState();

  /**
   * suppress-product-overlay-during-intro-rn-template — the latest REAL
   * products / activeProduct handed to {@link handleMomentSnapshot} (the
   * underlying buffer, distinct from what {@link productOverlay} currently
   * EXPOSES). Retained even while the opening MP4 preroll is playing
   * (StartScreen {@link StartScreenPhase.Splash} phase) so the ProductOverlay
   * view-model can be restored the INSTANT intro playback ends — via
   * {@link applyProductOverlay}, called from {@link handlePlayerStateChange} /
   * {@link handleUpcoming} — without waiting for the next host-fed moment
   * snapshot or re-fetching from the API. Parity iOS / Android (same bug, same
   * fix shape — RN template-layer landing only; this file's scope is
   * `react-native-ui`). Reset by {@link clear}.
   */
  private bufferedOverlayProducts: readonly LBProduct[] = [];
  private bufferedOverlayActiveProduct: LBProduct | null = null;

  /**
   * suppress-product-overlay-during-intro-rn-template — forward the buffered
   * real products/activeProduct into {@link productOverlay}, EXCEPT while the
   * opening MP4 (`channel.start`) is playing: core is correct (RN already
   * derives the equivalent of iOS/Android `startScreenActive` as
   * {@link StartScreenPhase.Splash}), but `handleMomentSnapshot` previously
   * forwarded products unconditionally, making a product card appear OVER the
   * intro video. While `this.startScreen.phase === Splash`, the EXPOSED
   * ProductOverlay view-model is forced to the empty/null shape; the
   * underlying buffer is left untouched (no data loss, no re-fetch needed on
   * restore). Returns whether the EXPOSED view-model actually changed
   * (diff-then-notify, delegated to
   * {@link DefaultProductOverlayState.handleSnapshot}). @internal
   */
  private applyProductOverlay(): boolean {
    const introPlaying = this.startScreen.phase === StartScreenPhase.Splash;
    return this.productOverlay.handleSnapshot(
      introPlaying ? [] : this.bufferedOverlayProducts,
      introPlaying ? null : this.bufferedOverlayActiveProduct,
    );
  }

  /**
   * upcoming-intro-template-rn — host-bindable Upcoming (直播預告 awaiting-live)
   * view-model (`active` / `introPlaying` / `scheduledStartAt` / `cover`). The host /
   * reference-ui draw the upcoming LIVE chrome (countdown background `cover` +
   * `scheduledStartAt`) + the opening-MP4 (`introPlaying`) gate. Parity iOS / Android
   * / Flutter `DefaultUpcomingState`. HOST-FED via {@link handleUpcoming} (the RN core
   * forwards only the upcoming channel fields as `LBPlayerChannelInfo` via
   * `onChannelChange` — `upcoming-intro-core-rn`).
   */
  private readonly upcoming = new DefaultUpcomingState();

  /**
   * upcoming-intro-template-rn — the latest canonical player state, cached by
   * {@link handlePlayerStateChange} so {@link handleUpcoming} (the host calls it on
   * channel load, typically right after the state callback) can derive `upcoming`
   * against it. Parity with the Android / Flutter template's cached `lastState`.
   */
  private lastState = 'loading';

  /**
   * auth-gate-template-state — two host-bindable auth view-models. The host
   * binds {@link authGateState} (draw a「請先登入」prompt) and
   * {@link identityLabelState} (`PlayerHeader` / `ChatView` identity). Both are
   * fed from the unified channel (`AUTH_REQUIRED` / `AUTH_STATE_CHANGED`, see
   * {@link handleAuthRequired} / {@link handleAuthStateChanged}). Each model
   * reports whether it actually changed so the template coalesces ONE notify.
   */
  private readonly authGate = new DefaultAuthGate();
  private readonly identityLabel = new DefaultIdentityLabel();

  /**
   * await-toggle-and-notice-tab-template-state — two host-bindable view-models.
   * The host binds {@link goodsTrackingFlags} (per-product 到貨追蹤 / 補貨通知
   * dual switch — TWO independent, non-mutually-exclusive flags) and
   * {@link noticeTabState} (VideoInfoPanel 公告分頁 open-state). goodsTracking
   * toggles delegate to the injected core setters (`LivebuySDK.setAwaitGoods` /
   * `setNoticeGoods`) and are corrected by the authoritative `AWAIT_GOODS_CHANGED`
   * / `NOTICE_GOODS_CHANGED` broadcasts on the unified channel
   * ({@link handleAwaitGoodsChanged} / {@link handleNoticeGoodsChanged}); the
   * notice texts are host-fed ({@link handleNoticeTexts}). Each model reports
   * whether it actually changed so the template coalesces ONE notify.
   */
  private readonly goodsTracking: DefaultGoodsTracking;
  private readonly noticeTab = new DefaultNoticeTab();

  /**
   * player-chrome-template — two host-bindable player-chrome view-models. The
   * host binds {@link operationRailState} (OperationPanel side-rail: ordered
   * `{ kind, enabled }` items + bag-count + heart-burst tick + muted) and
   * {@link infoTabState} (VideoInfoPanel info-tab + two-tab switch). The
   * PlayerHeader top-bar chrome補欄 folds into the EXISTING {@link
   * playerHeaderState}. Side-rail enabled flags / info-tab fields are HOST-FED
   * (parity with notice-tab `injectNotices`); bag-count is host-wired from
   * `products.count`; heart-burst is fed from the unified `VIDEO_LIKE` event
   * (snake_case `video_id`) or a host-wired tick. The actual side-rail / top-bar
   * actions go through the player ref's EXISTING `simulate*`. Each model reports
   * whether it actually changed so the template coalesces ONE notify.
   */
  private readonly operationRail = new DefaultOperationRail();
  private readonly infoTab = new DefaultInfoTab();

  /**
   * swipe-navigate-rn-template — read-only prev/next adjacent-video navigation
   * sub-state (React Native parity of iOS `swipe-navigate-template`). The two
   * ids come from the public core channel (`channel.prev[0]?.id` /
   * `channel.next[0]?.id`); RN has NO `ingestChannel()`, so they are HOST-FED via
   * {@link handleNavTargets} (parity with `handleHeaderChrome`). Host binds
   * {@link navigationState} to gate/hint a vertical-swipe-to-switch-video gesture.
   * The {@link navigateToPrev} / {@link navigateToNext} forwarders delegate to the
   * injected {@link loadVideo} (the template holds no player ref). Each feed
   * reports whether it changed so the template coalesces ONE notify.
   */
  private readonly navigation = new DefaultPlayerNavigation();
  /**
   * swipe-navigate-rn-template — injected adjacent-video loader. The host wires
   * the player ref's `load(videoId)` (parity with `requestEventJoin` /
   * `requestAwardClaim`). Undefined → {@link navigateToPrev} / {@link
   * navigateToNext} are safe no-ops (the template never touches the bridge).
   */
  private readonly loadVideo?: (videoId: string) => void;

  /**
   * rn-vod-playback-progress-template — three injected VOD control requesters.
   * The RN template holds no player ref (same reason as {@link loadVideo} /
   * `requestEventJoin` / `requestAwardClaim`), so {@link togglePlayPause} /
   * {@link seek} / {@link seekBy} delegate to these host-wired forwarders. The
   * host wires the player ref's `togglePlayPause()` / `seek(seconds)` /
   * `seekBy(delta)` (RN core bridge, `rn-vod-playback-progress-core`). Each is
   * a PURE forwarder — the scrub gate (`vodScrubAllowed`) already lives
   * client-side inside the core bridge's `seek`/`seekBy`, so the template MUST
   * NOT re-derive gating here. Undefined → the three public methods are safe
   * no-ops (no crash).
   */
  private readonly requestTogglePlayPause?: () => void;
  private readonly requestSeek?: (seconds: number) => void;
  private readonly requestSeekBy?: (delta: number) => void;

  /**
   * product-sheet-stack-template — five host-bindable商品 sheet-stack view-models.
   * Host binds {@link productDetailState} (`LBPBottomSheet` + `LBPProductRow`) /
   * {@link variantState} (`LBPVariantPicker`) / {@link qtyState} (`LBPQtyStepper`)
   * / {@link miniCartPeek} (`LBPMiniCart`) / {@link cartCTAState} (`LBPCartCTA`).
   * A `diversion==0` productTap opens the detail sheet (resets variant/qty +
   * recomputes qty bounds); `diversion==1` sets NO detail state and instead routes
   * the URL by `LBURLOpenPolicy` (in-app browser / system URL router / safe no-op —
   * url-open-host-routing-template-rn). The
   * `addToCart()` intent delegates to the injected route-B requester (the template
   * NEVER builds HTTP, parity with the goods-tracking delegate). Each model reports
   * whether it changed so the template coalesces ONE notify (a single add-success
   * coalesces mini-cart + cart-CTA into one).
   */
  private readonly productSheet = new DefaultProductSheet();
  /**
   * 當前 channel 的「更多商品」候選清單(`LBChannel.otherGoods`,
   * expose-other-goods-recommendations-template)。RN 沒有 `ingestChannel()`
   * (parity `handleHeaderChrome` / `handleNavTargets`),由 host 透過
   * {@link handleOtherGoods} 餵入。{@link handleProductTap} 開啟商品詳情時據此算出
   * `LBProductDetailState.recommendations`(排除目前商品、不裁切張數)。未餵入 /
   * headless 單元測試時為空陣列。
   */
  private currentOtherGoods: readonly LBProduct[] = [];
  private readonly variantPicker = new DefaultVariantPicker();
  private readonly qtyStepper = new DefaultQtyStepper();
  private readonly miniCart = new DefaultMiniCart();
  private readonly cartCTA = new DefaultCartCTA();
  private readonly addToCartRequester: CartAddRequester;
  /** cart CTA「開啟購物車」passthrough — host wires its own checkout entry (D4). */
  private readonly onOpenCart?: (productId?: string) => void;
  /**
   * Host-takeover (route A `CART_ADD_REQUEST`) flag. When the host takes over
   * product-tap / add-to-cart, the template MUST NOT delegate route B (avoid the
   * double-write). On RN the unified channel carries no interception-result, so
   * the host sets this explicitly via {@link setHostOwnsCart} (parity with the
   * award-claim / auth-gate host-takeover-by-convention precedent).
   */
  private hostOwnsCart = false;
  /** Add-to-cart failure flag (host shows an error). Cleared on a new sheet / success. */
  private addToCartFailedFlag = false;
  /**
   * Add-to-cart「需登入」flag, orthogonal to {@link addToCartFailedFlag}. Set true when the
   * route-B add rejected with the core「needs login」signal (`{ type: 'serverError', code: 401 }`,
   * raised for an empty `buy_no`) so the reference-ui shows the login gate instead of the failure
   * banner. Cleared alongside the failure flag (new attempt / sheet open / success). parity iOS/Android.
   */
  private addToCartNeedsLoginFlag = false;
  /**
   * 加購「請求中」flag（cart-add-loading-state-rn, parity iOS/Android `addToCartInFlight`）。
   * {@link addToCart} 通過守門、清 transient flags 後、`await addToCartRequester(...)` 前設 true
   * （loading 起點通知），`try`（success / dedupe）與 `catch`（needs-login / failure）兩路皆設回
   * false。與 {@link addToCartFailedFlag} / {@link addToCartNeedsLoginFlag} 正交，驅動 reference-ui
   * 加購 CTA loading（spinner +「加入中…」、鎖 stepper / 規格）。開新詳情（{@link handleProductTap}）/
   * {@link clear} 一併重置。預設 false。
   */
  private addToCartInFlightFlag = false;
  /**
   * 當前影片短碼（cart-add-tier2-unify），由統一 `VIDEO_OPEN` 事件（`params.video_id`）追蹤。
   * 串接進 `addToCart` → `CartAddRequest.videoId`，使 core 的 `CART_ADD_REQUEST` 帶正確
   * `video_id`。RN 無 `ingestChannel()`，故由 `TemplateAttachment` VIDEO_OPEN 呼叫
   * {@link setCurrentVideoId}（iOS / Android 由 `ingestChannel` 衍生）。null until first VIDEO_OPEN.
   */
  private currentVideoIdValue: string | null = null;
  /** "請選規格" flag (host prompts the user to pick a variant before adding). */
  private selectSpecRequiredFlag = false;
  /** Player-bound guest-rename action (host wires the player ref's rename exit). */
  private readonly guestNameEditAction?: () => void;
  /**
   * 會員等級限定旗標（restriction-gate ②），由統一 `VIDEO_OPEN` 事件的 `is_restriction`
   * 衍生（`=== 1` → true）供 reference-ui 疊升級遮罩。**軟性顯示閘門**：core 不擋播放。
   * RN 無 `ingestChannel()`，故由 `TemplateAttachment` 路由 `VIDEO_OPEN` 呼叫 {@link applyRestriction}
   * （iOS / Android 由 `ingestChannel` 衍生）。預設 false（未受限 / 缺欄 fail-open）。
   */
  private _isRestricted = false;
  /**
   * §1 — 置頂留言（chat-message-taxonomy ⑤），由 {@link handlePollReceived} 從 `poll.top` 設定，
   * 供 reference-ui 渲染。冪等：每輪以當前釘選狀態覆蓋，取消釘選 → null。
   */
  private _pinnedMessage: PinnedMessage | null = null;

  /**
   * §B — coalesced "state changed" emitter. Fired EXACTLY ONCE after any single
   * host-bindable state mutation (feed append / unclaimed recordWin / claimed
   * removal / result-state update / {@link clear}). Additive: when the host
   * registers no listener via {@link subscribe}, behaviour is unchanged.
   */
  private readonly changeEmitter = new ChangeEmitter();

  /**
   * Test-visible counter: how many `WIN_RECEIVED` events this template has
   * observed (parity with iOS `TemplateAuxListener.winReceivedCount`).
   */
  winReceivedCount = 0;

  /**
   * §1 — merged activity+chat feed model (newest at tail, tail-retained to the
   * shared Default-template constant N = 7). Host binds {@link feedItems} to
   * draw `LBLiveChatStream`. DATA-LAYER merge only — activity rows are never
   * double-written into the ChatView chat data source.
   */
  private readonly feed = new MergedActivityFeed();

  /**
   * §2 — unclaimed-win set (deduped by winner.id). core stays headless; this
   * template owns the count + winner list and removes a winner on a claimed
   * result.
   */
  private readonly unclaimed = new UnclaimedWinSet();

  /**
   * §4 — latest award-claim result-state (host binds to draw success / failure
   * feedback in `LBWinSheet`). `null` until the first `awardClaimResult`.
   */
  private latestClaimResult: AwardClaimResultState | null = null;

  /**
   * §4 — winner.id of the most recently submitted claim. `awardClaimResult`
   * does not carry the participant ticket id (only `event_id`), so the template
   * correlates a claimed result back to the submitting winner to remove it from
   * the unclaimed set (parity with native, which knows the in-flight winner).
   */
  private lastSubmittedWinnerId: string | null = null;

  /**
   * 領獎「送出中」flag（win-claim-email-submit-rn-template, parity iOS
   * `DefaultWinClaim.submitInFlight` / Android `DefaultPlayerTemplate.submitInFlight`）。
   * reference-ui bind {@link submitInFlight} 繪製設計稿 `LBWinSheet` 的 `submitting` 態
   * （scrim + spinner +「送出中…」）並在期間 disable CTA。
   *
   * 命名與生命週期**刻意鏡像**既有 {@link addToCartInFlightFlag} / {@link addToCartInFlight}
   * （`cart-add-loading-state-rn`）慣例，MUST NOT 另創風格：
   *   • {@link beginSubmit}（兩個提交入口共用）→ `true`（+ 一次 `notifyChange()`）
   *   • guard 擋下（已在飛 / email 不合格）→ **不變**（比照缺貨 / 未選規格 guard 不進 in-flight）
   *   • {@link handleAwardClaimResult}（成功**與**失敗皆是）/ {@link dismissClaim} /
   *     {@link clear} → `false`
   *
   * **已知懸掛情境**：原生 host 攔截 `awardClaimIntent` 時 core **不會** emit
   * `AWARD_CLAIM_RESULT`，故沒有結果可消費 → 由 host 於關閉自家領獎 UI 時呼叫
   * {@link dismissClaim}（或換片 / teardown 的 {@link clear}）歸零。template
   * **MUST NOT** 自行揣測攔截結果。
   */
  private submitInFlightFlag = false;

  /**
   * activity-sheet-multi-activity-template-rn — the full list of currently-running
   * live-shopping activities (backend `event[]`), in intake-arrival order (push
   * upsert / pull snapshot overwrite — see {@link handleActiveEventStarted} /
   * {@link syncActiveEvents}). Empty array = no activity currently running (host
   * hides the entry, same external contract as the pre-existing `currentActivity
   * === null`). Reset to `[]` by {@link clear} (video switch / teardown).
   *
   * **Design reversal (design.md D1)**: this REPLACES the prior single-value
   * field `currentActivityValue: LBActiveEvent | null` from
   * `live-activity-entry-rn-template` (design.md D1 there: "a live only ever runs
   * one activity at a time"). The backend `event[]` CAN return multiple
   * concurrently-running activities; that assumption no longer holds. See
   * {@link currentActivity} for the back-compat single-value read surface.
   */
  private activitiesValue: readonly LBActiveEvent[] = [];

  /**
   * activity-sheet-multi-activity-template-rn — the page index into {@link
   * activitiesValue} that {@link currentActivity} currently reflects. Always
   * clamped into `[0, activitiesValue.length - 1]` (or `0` when
   * `activitiesValue` is empty) via {@link clampActivityPageIndex} — set by
   * {@link handleActiveEventStarted} (jumps to the pushed/updated event),
   * {@link syncActiveEvents} (clamps only, never jumps — design.md D3), {@link
   * setActivityPageIndex} (host-driven paging), and the video-switch cache
   * restore in {@link setCurrentVideoId} (reset to `0`). Defaults to `0`.
   */
  private currentActivityPageIndexValue = 0;

  /**
   * activity-entry-video-switch-cache-and-hide-rn — instance-level, per-videoId
   * snapshot of the {@link currentActivity} getter's value (the "currently
   * displayed page" of {@link activitiesValue}, NOT the full list — design.md D4
   * of activity-sheet-multi-activity-template-rn keeps this data shape
   * unchanged), keyed by videoId. Populated by {@link clear} (the outgoing
   * video's last-known displayed value, saved BEFORE it is wiped to `[]`) and
   * consumed by {@link setCurrentVideoId} (restores the incoming video's value
   * as a one-element list if this session has visited it before), so an
   * in-place switch BACK to an already-seen video shows its (single) activity
   * immediately instead of waiting for the next `syncActiveEvents` poll. Any
   * OTHER activities that were concurrently running when the video was left are
   * NOT restored from this cache — they reappear once the next
   * `syncActiveEvents` poll lands (design.md D4 trade-off).
   *
   * The stored value CAN be `null` — that means "visited, and confirmed no
   * activity was running", which is distinct from "never visited" (no map
   * entry at all). `Map.has()` is used to tell the two apart; `.get() ?? x`
   * would collapse them.
   *
   * Instance-level only — NOT persisted across `DefaultPlayerTemplate`
   * instances (closing the player and reopening it builds a fresh instance
   * with an empty cache; parity with this file's other unbounded
   * instance-level maps, `AwardClaimFlow.byId` / `GoodsTracking.flagsByGpn`).
   * Unbounded by design — see design.md D5.
   */
  private readonly activityByVideoId = new Map<string, LBActiveEvent | null>();

  constructor(params: {
    sdkConfig: SDKConfig;
    hostOptions?: LBUIOptions | null;
    onDismiss?: () => void;
    /**
     * The `'inApp'` seam. Injectable for tests; defaults to the core RN bridge
     * `openInAppBrowser`. Receives the verdict's URL (see {@link InAppBrowserOpener}).
     */
    openInAppBrowser?: InAppBrowserOpener;
    /**
     * url-open-host-routing-template-rn — the `'external'` seam. Injectable for
     * tests; defaults to the RN public `Linking.openURL` (no bridge command is
     * involved). Receives the verdict's URL (see {@link ExternalUrlOpener}).
     */
    openExternalUrl?: ExternalUrlOpener;
    /**
     * §3 — player-bound award-claim action. Host wires the player ref's
     * `requestAwardClaim(winner, contact)`; the contact carries the user-entered
     * email built by {@link DefaultPlayerTemplate.submitAwardClaim} (2-arg overload,
     * win-claim-email-submit-rn-template) and is `undefined` for the DEPRECATED
     * EMAIL-LESS overload. Undefined → submit is a safe no-op (host has not bound
     * the player yet) but the in-flight state machine still runs.
     */
    requestAwardClaim?: RequestAwardClaimWithContact;
    /**
     * Player-bound event-join action. Host wires the player ref's
     * `requestEventJoin` (core emits `eventJoinIntent`). Undefined → `joinEvent`
     * still marks the item optimistically but performs no core call (inert).
     */
    requestEventJoin?: (eid: number, keyword: string) => void;
    /**
     * auth-gate-template-state — player-bound guest-rename action. Host wires
     * the player ref's rename exit (today `operationPanel.simulateGuestNameEditTap`,
     * which emits `GUEST_NAME_EDIT_REQUEST`; passthrough, non-navigation, no
     * auto-PiP). Undefined → {@link requestGuestNameEdit} is a safe no-op.
     */
    requestGuestNameEdit?: () => void;
    /**
     * await-toggle-and-notice-tab-template-state — goods-tracking toggle
     * delegates. Default to the lazy-required core methods
     * `LivebuySDK.setAwaitGoods` (type=1) / `setNoticeGoods` (type=2); the
     * template NEVER builds HTTP itself. Injectable so unit tests capture the
     * delegated calls with a fake (no native bridge).
     */
    setAwaitGoods?: GoodsTrackingSetter;
    setNoticeGoods?: GoodsTrackingSetter;
    /**
     * product-sheet-stack-template — route-B add-to-cart requester. The Default
     * template delegates `addToCart()` to `LivebuySDK.addToCart` (route B → the
     * `LBCartResult`; the template NEVER builds HTTP). The host wires the real
     * requester (it owns the configured `shopId`); when omitted the default
     * rejects (the add is inert). Injectable so unit tests capture the request.
     */
    addToCartRequester?: CartAddRequester;
    /**
     * product-sheet-stack-template — host-takeover (route A `CART_ADD_REQUEST`)
     * flag. When the host takes over add-to-cart, the template MUST NOT delegate
     * route B (avoid the double-write). Defaults to false (template owns route B).
     */
    hostOwnsCart?: boolean;
    /**
     * product-sheet-stack-template / view-cart-event-rn-template — cart CTA
     * 「開啟購物車」passthrough. The template does NOT own the checkout page;
     * `openCart()` forwards here with the current product detail's id (詳情頁
     * CTA) or `undefined` (列表底部 CTA). The host wires this to the player ref's
     * `requestViewCart(productId)` (emit `VIEW_CART`). When omitted, `openCart()`
     * is a safe no-op.
     */
    onOpenCart?: (productId?: string) => void;
    /**
     * swipe-navigate-rn-template — injected adjacent-video loader. The host wires
     * the player ref's `load(videoId)` (the RN template holds no player ref —
     * parity with `requestEventJoin` / `requestAwardClaim`). When omitted,
     * {@link navigateToPrev} / {@link navigateToNext} are safe no-ops.
     */
    loadVideo?: (videoId: string) => void;
    /**
     * rn-vod-playback-progress-template — injected VOD control requesters. The
     * host wires the player ref's `togglePlayPause()` / `seek(seconds)` /
     * `seekBy(delta)` (RN core bridge, `rn-vod-playback-progress-core`); the RN
     * template holds no player ref (parity with `loadVideo` /
     * `requestEventJoin`). When omitted, {@link togglePlayPause} / {@link seek} /
     * {@link seekBy} are safe no-ops. Pure forwarders — the scrub gate
     * (`vodScrubAllowed`) already lives client-side in the core bridge.
     */
    requestTogglePlayPause?: () => void;
    requestSeek?: (seconds: number) => void;
    requestSeekBy?: (delta: number) => void;
  }) {
    this.effectiveConfig = new EffectiveConfig(params.sdkConfig, params.hostOptions);
    this.onDismiss = params.onDismiss;
    this.openInAppBrowser = params.openInAppBrowser ?? defaultInAppBrowserOpener;
    this.openExternalUrl = params.openExternalUrl ?? defaultExternalUrlOpener;
    this.requestAwardClaim = params.requestAwardClaim;
    this.requestEventJoin = params.requestEventJoin;
    this.guestNameEditAction = params.requestGuestNameEdit;
    this.requestTogglePlayPause = params.requestTogglePlayPause;
    this.requestSeek = params.requestSeek;
    this.requestSeekBy = params.requestSeekBy;
    // await-toggle-and-notice-tab-template-state — wire the goods-tracking model
    // to the core setters (default = lazy-required LivebuySDK methods; the model
    // itself never builds HTTP, headless write contract).
    this.goodsTracking = new DefaultGoodsTracking(
      params.setAwaitGoods ?? defaultSetAwaitGoods,
      params.setNoticeGoods ?? defaultSetNoticeGoods,
    );
    // product-sheet-stack-template — wire the route-B add-to-cart requester
    // (default = lazy-required `LivebuySDK.addToCart`; the template itself never
    // builds HTTP, headless write contract) + the host-takeover flag.
    this.addToCartRequester = params.addToCartRequester ?? defaultAddToCartRequester;
    this.hostOwnsCart = params.hostOwnsCart ?? false;
    this.onOpenCart = params.onOpenCart;
    // swipe-navigate-rn-template — wire the injected adjacent-video loader (host
    // forwards the player ref's `load(videoId)`; the template never touches the
    // bridge). Undefined → the navigate forwarders are safe no-ops.
    this.loadVideo = params.loadVideo;
    // #3 — surface backend layout keys this template version doesn't recognise.
    logUnknownLayoutKeys('player', params.sdkConfig.layout?.player, KNOWN_PLAYER_LAYOUT_KEYS);
  }

  /**
   * VIDEO_STATE_CHANGE — SDK is headless; host provides overlay UI. Drives
   * error-state clearing (player LEAVES `error` → dismiss `LBPErrorScreen`) AND
   * the StartScreen phase mapping (D2). Both facets of this single event fan
   * into ONE coalesced notification.
   */
  handlePlayerStateChange(state: string): void {
    if (__DEV__) console.log(`[DefaultTemplate] playerState: ${state}`);
    // upcoming-intro-template-rn — cache the canonical state so handleUpcoming (the
    // host calls it on channel load, right after this state callback) can derive
    // `upcoming`. Parity with the Android / Flutter cached `lastState`.
    this.lastState = state;
    let changed = this.errorState.handleStateChange(state);
    if (this.startScreen.handleStateChange(state)) changed = true;
    // suppress-product-overlay-during-intro-rn-template — the StartScreen phase
    // may have just entered/left splash (the opening MP4); re-derive what
    // ProductOverlay exposes so leaving intro restores the buffered real
    // snapshot IMMEDIATELY (no waiting for the next handleMomentSnapshot / a
    // re-poll), and entering intro suppresses it just as promptly.
    if (this.applyProductOverlay()) changed = true;
    // end-screen-no-countdown — the end screen is visible ⟺ the player is in the
    // `endScreenShown` sub-state (the native core enters it on live end REGARDLESS
    // of next/hot, #3). RN does NOT bridge momentState, so endScreenVisible is
    // derived from the bridged player-state string (equivalent to iOS deriving it
    // from momentState.endScreenShown). ORTHOGONAL to the auto-next countdown.
    if (this.endScreen.setVisible(state === 'endScreenShown')) changed = true;
    if (changed) this.notifyChange();
  }

  /**
   * VIDEO_ERROR — map the bridge error `type` string → host-bindable error-state
   * `{ kind, phase: failed }` for `LBPErrorScreen`. The host wires the bridge
   * `LBError` event here (the unified listener only carries a platform-dependent
   * `description` — see `ErrorState` doc). core stays headless; the template
   * only maps + exposes.
   */
  handleError(type: string): void {
    if (this.errorState.recordError(type)) this.notifyChange();
  }

  /**
   * AUTH_REQUIRED — map an un-intercepted「需登入」into the host-bindable
   * auth-gate state. `hostIntercepted == true` (host primary returned `true`)
   * EXCLUDES it (no state, no notify), per spec host-takeover. On RN the
   * unified channel carries no interception-result, so the router passes
   * `false`; the exclusion is exercised at the model level (see AuthGate doc).
   */
  handleAuthRequired(params: Record<string, unknown>, hostIntercepted: boolean): void {
    if (this.authGate.recordRequired(params, hostIntercepted)) this.notifyChange();
  }

  /**
   * AUTH_STATE_CHANGED — update the identity-label and, on `logged_in`, clear
   * the auth-gate. Both facets of this single event fan into ONE coalesced
   * notification. `resumed_action` is intentionally NOT read into state.
   */
  handleAuthStateChanged(params: Record<string, unknown>): void {
    const state = typeof params.state === 'string' ? params.state : '';
    const dn = typeof params.display_name === 'string' ? params.display_name : undefined;
    let changed = this.identityLabel.update(state, dn);
    if (state === 'logged_in' && this.authGate.clearOnLogin()) changed = true;
    if (changed) this.notifyChange();
  }

  /**
   * Guest 改名意圖 passthrough — calls the injected player-bound rename action
   * (core emits `GUEST_NAME_EDIT_REQUEST`; passthrough, non-navigation, no
   * auto-PiP). The template draws NO rename UI and changes NO event semantics.
   * Safe no-op when the host has not wired the action.
   */
  requestGuestNameEdit(): void {
    this.guestNameEditAction?.();
  }

  /**
   * expose-player-moment-state-template — host-wired moment snapshot (products /
   * active product / header / subtitle / `channel.start` availability). The host
   * wires the player's typed moment sources here (momentState is NOT on the
   * unified channel, parity with the error `type` precedent). A single snapshot
   * MAY touch several facets at once → ONE coalesced notification (D6). `active`
   * is the narrate_status==2 product the host resolved (narrate_status is a
   * poll/raw field NOT on `LBProduct`). `hasStart` gates the splash phase.
   */
  handleMomentSnapshot(snapshot: {
    products?: readonly LBProduct[];
    activeProduct?: LBProduct | null;
    isSubscribed?: boolean;
    viewerCount?: number;
    subtitleAvailable?: boolean;
    subtitleEnabled?: boolean;
    hasStart?: boolean;
    next?: readonly EndScreenNavRow[];
    hot?: readonly EndScreenHotRow[];
  }): void {
    let changed = false;
    if (snapshot.hasStart !== undefined && this.startScreen.setStartAvailability(snapshot.hasStart)) {
      changed = true;
    }
    if (snapshot.products !== undefined || snapshot.activeProduct !== undefined) {
      // suppress-product-overlay-during-intro-rn-template — buffer the REAL
      // snapshot (fallback reads the buffer, NOT `this.productOverlay.products`,
      // which may currently be forced empty by intro suppression) and let
      // applyProductOverlay() decide what to actually expose.
      this.bufferedOverlayProducts = snapshot.products ?? this.bufferedOverlayProducts;
      this.bufferedOverlayActiveProduct = snapshot.activeProduct ?? null;
      if (this.applyProductOverlay()) {
        changed = true;
      }
      // minicart-peek-add-only (tmpl-ios-remove-minicart-peek-fallback): the
      // mini-cart peek is populated ONLY by a successful route-B add (see addToCart),
      // NOT by the narrating `activeProduct`. The 講解中商品 is already shown by the
      // pinned card (LIVE) / now-introducing card (VOD); seeding the peek with it
      // duplicated that surface (same MiniCartView component) and leaked the
      // VOD-only peek into LIVE. The prior narrating `setPeek` fallback is removed.
    }
    if (snapshot.isSubscribed !== undefined || snapshot.viewerCount !== undefined) {
      const cur = this.playerHeader.current;
      if (this.playerHeader.handleHeader(snapshot.isSubscribed ?? cur.isSubscribed, snapshot.viewerCount ?? cur.viewerCount)) {
        changed = true;
      }
    }
    if (snapshot.subtitleAvailable !== undefined || snapshot.subtitleEnabled !== undefined) {
      const cur = this.subtitle.current;
      if (this.subtitle.handleSubtitle(snapshot.subtitleAvailable ?? cur.available, snapshot.subtitleEnabled ?? cur.enabled)) {
        changed = true;
      }
    }
    if (snapshot.next !== undefined || snapshot.hot !== undefined) {
      if (this.endScreen.setLists(snapshot.next ?? this.endScreen.next, snapshot.hot ?? this.endScreen.hot)) {
        changed = true;
      }
    }
    if (changed) this.notifyChange();
  }

  /**
   * Player mute flag change. NO RN mute callback exists on the bridge (only the
   * imperative `setMuted`), so the HOST — which owns the player ref and called
   * `setMuted` — calls this. Host-wired, parity with the error `type` precedent.
   *
   * player-chrome-template — the SAME mute flag also mirrors into the side-rail
   * `muted` (gesture state). ONE host call → both view-models mirror the same
   * value (D2 — no second source) → ONE coalesced notification.
   */
  handleMutedChange(muted: boolean): void {
    let changed = this.playerHeader.handleMuted(muted);
    if (this.operationRail.handleMuted(muted)) changed = true;
    if (changed) this.notifyChange();
  }

  /**
   * upcoming-intro-template-rn — host feeds the upcoming-relevant channel fields
   * (from the core bridge's `LBPlayerChannelInfo` via `onChannelChange`) so the
   * template can derive the {@link upcomingState} view-model. Call on channel load,
   * alongside the state route. Derives (parity iOS / Android / Flutter):
   *   • `active`       = the cached `lastState === "awaitingLive"`;
   *   • `introPlaying` = `lastState === "startScreenPlaying" && hasStart &&
   *     isUpcomingChannel`, where `hasStart = (start 非空)`,
   *     `isUpcomingChannel(liveStatus, type) = liveStatus === 0 && type === 2`
   *     （後端 scheduled-live 訊號，rb-rn-upcoming-channel-type，問題 6——取代舊
   *     `publishAtInFuture` 牆鐘 heuristic：scheduled live 開播時間已過但仍 liveStatus 0
   *     不再誤判為 VOD，regular VOD `type === 1` 不誤判為預告，且去牆鐘依賴 → 決定性）。
   *     `type` 由 host 經 `LBPlayerChannelInfo` 提供；未提供時 default -1 → 不視為預告
   *     （back-compat：舊 host 走 VOD chrome）。`hasStart` 仍由 `channel.start` 取得；
   *   • `scheduledStartAt` = `publishAt` (verbatim — the template MUST NOT parse);
   *   • `cover` = `cover` (verbatim — the reference-ui paints it).
   * `hasStart` is sourced from `channel.start` (parity 4788fae — NOT
   * `momentState.startUrl`): it refreshes the StartScreen `setStartAvailability` AND
   * re-applies the splash phase so a late-arriving start URL surfaces splash. All
   * facets fan into ONE coalesced notification. Inert before any state callback
   * (`lastState === "loading"` → active / introPlaying false).
   */
  handleUpcoming(channel: {
    publishAt: string;
    cover: string;
    start: string;
    liveStatus: number;
    // rb-rn-upcoming-channel-type（問題 6）：後端 `type`（2=直播/預告場、1=一般 VOD）。
    // 未提供 → default -1 → 不視為預告（back-compat：舊 host 走 VOD chrome）。
    type?: number;
  }): void {
    const hasStart = channel.start.trim().length > 0;
    let changed = false;
    // Re-apply the StartScreen splash with the fresh channel.start (parity 4788fae).
    if (this.startScreen.setStartAvailability(hasStart)) changed = true;
    if (this.startScreen.handleStateChange(this.lastState)) changed = true;
    // suppress-product-overlay-during-intro-rn-template — a late-arriving
    // `channel.start` can flip the StartScreen phase here too (see the comment
    // above); keep ProductOverlay's exposed value in lockstep.
    if (this.applyProductOverlay()) changed = true;
    const upcomingChannel = isUpcomingChannel(channel.liveStatus, channel.type ?? -1);
    const next = {
      active: this.lastState === 'awaitingLive',
      introPlaying: this.lastState === 'startScreenPlaying' && hasStart && upcomingChannel,
      scheduledStartAt: channel.publishAt,
      cover: channel.cover,
    };
    if (this.upcoming.apply(next)) changed = true;
    if (changed) this.notifyChange();
  }

  /**
   * upcoming-intro-template-rn — reset the upcoming view-model (+ its derivation
   * inputs) for a new video / teardown (Flutter 慣例 parity `resetUpcomingForSession`).
   * The host calls this on `unload` / hot-switch so a stale 直播預告 chrome does not
   * linger on the next video. Fires ONE coalesced notification iff anything changed.
   * (The aggregate {@link clear} also resets `upcoming`.)
   */
  resetUpcomingForSession(): void {
    this.lastState = 'loading';
    if (this.upcoming.clear()) this.notifyChange();
  }

  /**
   * Mirror a core auto-next countdown tick (host-wired; momentState not bridged).
   * The EndScreen model captures `total` on inactive→active and holds it while
   * `remain` decrements; countdown→nil when inactive / `next` empty.
   */
  handleEndScreenCountdown(remain: number, active: boolean): void {
    if (this.endScreen.handleCountdown(remain, active)) this.notifyChange();
  }

  /** User cancelled auto-next: EndScreen `countdown`→null, `next`/`hot` retained. */
  handleAutoNextCancelled(): void {
    if (this.endScreen.cancelCountdown()) this.notifyChange();
  }

  /** DISMISS_REQUEST — invoke provided callback or navigation.goBack (Task 7.5) */
  handleDismissRequest(): void {
    this.onDismiss?.();
  }

  /**
   * POLL_RECEIVED — raw poll payload broadcast (parity with iOS
   * `handlePollReceived`). chat-message-taxonomy ⑤：消費 `poll.top` 暴露置頂留言 view-model
   * （冪等：取消釘選 → null）。diff-then-notify：值變更才 `notifyChange()`。其餘 activity / chat
   * 派生由 `TemplateAttachment` 從同一 payload 的 user/rush/push/comments 桶分流。
   */
  handlePollReceived(poll: Record<string, unknown>): void {
    const next = decodePinned(poll.top);
    if (!samePinned(this._pinnedMessage, next)) {
      this._pinnedMessage = next;
      this.notifyChange();
    }
  }

  /**
   * per-session 旗標：該場是否已 ingest 過第一批「首輪 backlog 重放」（POLL_RECEIVED `is_backlog === true`）。
   * 換片 / 重入時由 {@link clear} 重置為 false（chat-history-dedupe）。
   */
  private hasIngestedBacklog = false;

  /**
   * 純函式：是否 ingest 這一輪 poll 進 feed（chat-history-dedupe）。**只依 cursor 訊號 + per-session 旗標，
   * NOT 內容**（禁內容指紋去重——後台「推廣活動」會刻意重送相同內容真實通知，內容去重會誤殺）：後續輪
   * （`isBacklogReplay === false`）一律 ingest；首輪 backlog 首次 ingest 當歷史首屏；已 ingest 過的 backlog
   * 重放整批 skip。Parity iOS/Android `shouldIngestPoll`.
   */
  static shouldIngestPoll(isBacklogReplay: boolean, alreadyIngestedBacklog: boolean): boolean {
    return !isBacklogReplay || !alreadyIngestedBacklog;
  }

  /**
   * 領獎 email 前端驗證**純函式**（win-claim-email-submit-rn-template，name parity iOS
   * `DefaultWinClaim.isValidEmail` / Android companion `@JvmStatic isValidEmail`）。
   * reference-ui 每個 keystroke 都用它決定「確認領獎」CTA 是否 disabled；
   * `submitAwardClaim(winner, email)` 亦以它 fail-fast。無副作用、不需 template 實例
   * （故為 static，同 {@link shouldIngestPoll} 抽屜）。
   *
   * 這是 {@link isValidClaimEmail} 的**薄委派** —— 規則、trim、錨定的完整理由都在那裡，
   * 兩者 MUST NOT 各自實作。
   */
  static isValidEmail(raw: string): boolean {
    return isValidClaimEmail(raw);
  }

  /**
   * Instance wrapper：套用 backlog gate（{@link DefaultPlayerTemplate.shouldIngestPoll} 純函式）並維護
   * per-session {@link hasIngestedBacklog}。首次 ingest 首輪 backlog 後置旗標 true。
   */
  shouldIngestPoll(isBacklogReplay: boolean): boolean {
    const ingest = DefaultPlayerTemplate.shouldIngestPoll(isBacklogReplay, this.hasIngestedBacklog);
    if (isBacklogReplay && ingest) this.hasIngestedBacklog = true;
    return ingest;
  }

  /**
   * §1 — activity notice (`showJoin` / `showPurchase`) derived from a
   * POLL_RECEIVED user/rush message. Merged into the feed model with a visual
   * tier (join < purchase). DATA-LAYER merge only — NOT written into the
   * ChatView chat data source. Default tier is Join when not specified.
   */
  handleActivityNotice(text: string, tier: ActivityTier = ActivityTier.Join): void {
    this.feed.appendActivity(tier, text);
    this.notifyChange();
  }

  /**
   * §1 — a chat message (push / comments) merged into the feed model. This is
   * the SINGLE merge point; the host's ChatView keeps its own source unchanged.
   */
  handleChatMessage(text: string, name?: string): void {
    this.feed.appendChat(text, name);
    this.notifyChange();
  }

  /**
   * §1 — a poll `push[]` row → merged feed. A core event-BEGIN push
   * (`eid > 0 && (ek 非空 || at === 'begin')`) is surfaced as an INDEPENDENT
   * event-join row (host draws `LBEventJoinLine`); everything else — including
   * event-END and ordinary pushes — stays a plain chat row.
   */
  handlePush(
    text: string,
    opts?: {
      eid?: number;
      ek?: string;
      at?: string;
      color?: string;
      ct?: string;
      p?: string;
      // chat-message-taxonomy ⑤ — 已格式化開賣價（onsale 商品開賣卡現價，權威輸出欄，非上游 `p`）。
      price?: string;
      name?: string;
      // chat-message-kind ⑤ — 判型 wire 字串（narrate/comment/host/host_reply/ai_reply/onsale/event；
      // 未知直通 raw）。新核心一律送；舊核心缺 kind 時退回既有 color 反推（backward-compat）。
      kind?: string;
      // 主播 / AI 回覆的被回覆引用內容（backend `LBPushMsg.reply`），獨立字串。
      reply?: string;
    },
  ): void {
    const eid = opts?.eid;
    const ek = opts?.ek;
    const at = opts?.at;
    const kind = opts?.kind;
    // event-join-cta-isset-ek（push.ek 版）：`kind === 'event'` 活動公告（**含 event-end**）最先判定 →
    // 獨立 event-join 項；舊核心無 kind 時退回 ek/at 偵測（向後相容）。CTA keyword 來源 = messages `push.ek`
    // （後端「ek isset 才顯示 CTA」契約，與 push 同筆同步到達，MUST NOT 改用 goods event[]）。begin/end 由
    // `ek` isset 與否自然分流：isset → 非空 keyword → CTA；unset → '' → 純公告（reference-ui 依非空 gate CTA）。
    const isEvent =
      typeof eid === 'number' &&
      eid > 0 &&
      (kind === 'event' || (typeof ek === 'string' && ek.length > 0) || at === 'begin');
    if (isEvent) {
      this.feed.appendEventJoin(eid, ek ?? '', text);
      this.notifyChange();
      return;
    }
    if (typeof kind === 'string' && kind.length > 0) {
      // chat-message-kind ⑤ — 依 `kind` 判型路由（停止 `color` 反推）。parity iOS `handlePush`。
      switch (kind) {
        case 'narrate':
          // 觀眾選購（`#66F796`, ty=ds）= 社會認同廣播，**性質同 join / purchase、非主播、非介紹中**。
          // （舊版誤把 `#66F796` 當「介紹中」走 appendIntro，本批次語意校正為 browse tier。）
          this.feed.appendNarrate(text);
          break;
        case 'onsale':
          // 商品開賣（chat5 群組①）→ **主播訊息氣泡**（`appendChat` isHost=true，parity iOS/Android
          // `onsale-host-bubble-template`）。`text` 直顯後端組裝完整文案；`name` = 主播名（`push.name`）；
          // 空 `text` 不 append（不出空氣泡）。`appendProductSale` 與 `openProductSaleByName` /
          // `matchSaleProduct` 已於 dead-onsale-productsale-feed-rn-template 移除；`ProductSaleFeedItem`
          // 型別 + `price` 欄暫留（跨層共用，reference-ui 仍有 no-op case，完整移除需跨層 change）。
          if (text.length > 0) {
            this.feed.appendChat(text, opts?.name, /* isHost */ true);
          }
          break;
        case 'comment':
          // 一般用戶 / 訪客留言 → chat row 帶暱稱，isHost=false，不去重。
          this.feed.appendChat(text, opts?.name);
          break;
        case 'host':
        case 'host_reply':
        case 'ai_reply':
        case 'event': {
          // 主播訊息 / 活動結束：帶 event / promo metadata（`eid>0` / `ct` / `p`）→ DE-DUPED 系統通知；
          // 其餘主播留言 → chat row 帶暱稱 + 角色 metadata。維持既有去重語意。
          if (isSystemNoticePush(opts)) {
            this.feed.appendSystemNotice(text);
          } else {
            const isAI = kind === 'ai_reply';
            const isReply = kind === 'host_reply' || kind === 'ai_reply';
            const reply = isReply && typeof opts?.reply === 'string' && opts.reply.length > 0
              ? opts.reply
              : undefined;
            this.feed.appendChat(text, opts?.name, /* isHost */ true, reply, isAI);
          }
          break;
        }
        default:
          // .join / .purchase / .win 不會落 push 桶；未知 kind → 保守當 chat。
          this.feed.appendChat(text, opts?.name);
          break;
      }
    } else if (opts?.color === PRODUCT_PUSH_COLOR) {
      // backward-compat（舊核心未送 kind）：保留既有 color 反推路徑（商品推播 → intro）。
      this.feed.appendIntro(text);
    } else if (isSystemNoticePush(opts)) {
      this.feed.appendSystemNotice(text);
    } else {
      this.feed.appendChat(text, opts?.name);
    }
    this.notifyChange();
  }

  /**
   * Host-triggered「加入活動」intent for an event-join row. Calls the injected
   * `requestEventJoin` (core emits `eventJoinIntent`; if the host intercepts it,
   * the host fulfils the join) and OPTIMISTICALLY marks the row joined (core has
   * no "join succeeded" callback). MUST NOT auto-`sendChat`.
   *
   * live-activity-entry-rn-template — this method now serves TWO callers with the
   * same join semantics: the existing chat-feed `LBEventJoinLine`「加入活動」CTA
   * (above) and the `LBActivitySheet`「立即參加」CTA (fed by {@link currentActivity}).
   * Single source of truth — no second join method was added for the latter.
   */
  joinEvent(eid: number, keyword: string): void {
    this.requestEventJoin?.(eid, keyword);
    if (this.feed.markJoined(eid)) this.notifyChange();
  }

  /** Live-end derived from POLL_RECEIVED `live_end == 1` (stub). */
  handleLiveEnd(): void {}

  /**
   * §1 + §2 — WIN_RECEIVED (`showWin(text, winner)`). The win is merged into the
   * feed (win tier) AND added to the unclaimed-win set. The two are independent:
   * the feed reflects「中獎發生」, the unclaimed entry reflects「尚有 N 筆可領」.
   */
  handleWinReceived(winner: LBWinner, text: string): void {
    this.winReceivedCount += 1;
    this.feed.appendActivity(ActivityTier.Win, text, winner);
    this.unclaimed.add(winner);
    // §B — ONE win event = ONE coalesced notification (feed append + unclaimed
    // recordWin are two facets of the same single state-change event).
    this.notifyChange();
  }

  /**
   * live-activity-entry-rn-template — push-side intake for the core
   * `ACTIVE_EVENT_STARTED` event (fire-once, one call per activity id). Host
   * forwards it here (parity `handleWinReceived`'s host-forwards-event
   * convention — the RN template never subscribes to SDK events itself).
   * MUST NOT clear {@link activitiesValue} — `ACTIVE_EVENT_STARTED` is an
   * 「activity started」notice with no paired「activity ended」push (design.md D3
   * of live-activity-entry-rn-template).
   *
   * activity-sheet-multi-activity-template-rn (design.md D2) — UPSERTS `event`
   * into {@link activitiesValue} by `id` (an existing entry with the same id is
   * replaced in place, preserving its position; otherwise `event` is appended)
   * rather than overwriting the whole list, since two DIFFERENT activities can
   * each fire their own `ACTIVE_EVENT_STARTED` while both are running. Either
   * way, {@link currentActivityPageIndexValue} JUMPS to the pushed/updated
   * event's resulting index — this preserves the pre-existing "fire-once push
   * makes the new activity immediately visible" behaviour under the new
   * list-backed model (a deliberate choice — see design.md D2).
   */
  handleActiveEventStarted(event: LBActiveEvent): void {
    const idx = this.activitiesValue.findIndex((e) => e.id === event.id);
    this.activitiesValue =
      idx >= 0
        ? this.activitiesValue.map((e, i) => (i === idx ? event : e))
        : [...this.activitiesValue, event];
    this.currentActivityPageIndexValue = idx >= 0 ? idx : this.activitiesValue.length - 1;
    this.notifyChange();
  }

  /**
   * live-activity-entry-rn-template — pull-side intake backfilling
   * {@link activitiesValue} from the core `activeEvents()` accessor snapshot.
   * Host calls this after awaiting `activeEvents()` (e.g. on mount / video
   * switch, or the existing periodic ~5s poll) to close the late-subscriber
   * blind spot for hosts that missed the fire-once `ACTIVE_EVENT_STARTED` push.
   * This is the ONLY intake path that can clear {@link currentActivity} back to
   * `null` (design.md D3 of live-activity-entry-rn-template).
   *
   * activity-sheet-multi-activity-template-rn (design.md D3) — stores the
   * **entire** `events` snapshot (no longer just `events[0]`). When the list
   * length changes, {@link currentActivityPageIndexValue} is CLAMPED into the
   * new valid range via {@link clampActivityPageIndex} — but deliberately
   * NEVER jumped (unlike {@link handleActiveEventStarted}): this is a passive
   * periodic-poll backfill, not a "new activity" notice, so it must not yank
   * the host away from the page it is currently browsing.
   */
  syncActiveEvents(events: readonly LBActiveEvent[]): void {
    this.activitiesValue = events;
    this.currentActivityPageIndexValue = clampActivityPageIndex(
      this.currentActivityPageIndexValue,
      events.length,
    );
    this.notifyChange();
  }

  // §3 領獎提交行為（win-claim-email-submit-rn-template）
  //
  // Spec: `ui-template-foundation/spec.md`
  //   § "Default Template（RN）帶 email 領獎提交行為（parity）"
  //   § "Default Template（RN）領獎 email 前端驗證（純函式，parity）"
  //   § "Default Template（RN）領獎送出中狀態（`submitInFlight`，parity）"
  //   § "Default Template（RN）關閉領獎畫面僅 dismiss（不放棄中獎資格，parity）"
  // 皆 parity iOS `DefaultWinClaim`（commit f1bfb841）/ Android `DefaultPlayerTemplate`
  // （commit c3e09d08）。view-model / zero-pixel：本段只出「可綁定狀態 + 純邏輯」，
  // 四階段 sheet 的像素由 reference-ui 繪製。

  /**
   * §3 — EMAIL-LESS award-claim submit.
   *
   * @deprecated EMAIL-LESS 領獎在未被 host 攔截時**必然失敗**（core 預設領獎路徑
   * `email` 必填，缺 email 直接 fail-fast、**連 `POST /sdk/video/claim` 都不送**，
   * 直接 `AWARD_CLAIM_RESULT(status='failed')`）。這正是本 change 要修的 bug 本體 ——
   * 改用 `submitAwardClaim(winner, email)`；本 overload 將於下一個 major 移除
   * （`docs/contract-governance.md` I6 / 情境 F）。簽章與「不帶 contact」的行為
   * 刻意維持不變以保源碼相容；唯一差異是它現在也走同一段狀態機（進 in-flight），
   * 避免 model 出現只做半套的狀態。
   */
  submitAwardClaim(winner: LBWinner): void;
  /**
   * §3 — award-claim submit carrying the user-entered `email`
   * (win-claim-email-submit-rn-template — the fix for the EMAIL-LESS trap).
   *
   * Returns `true` when the request was actually handed to the injected
   * `requestAwardClaim` (and the model entered {@link submitInFlight}); `false` when a
   * guard rejected the call, in which case core is NOT called and NO state changes.
   *
   * Guards, in order:
   *   1. re-entrancy — already in flight (double-tap「確認領獎」/ host re-entry).
   *      Re-sending `POST /sdk/video/claim` comes back as「已領過」→ `500 api.fail` →
   *      a FAKE failure for the user, so it is cheapest to stop here.
   *   2. {@link isValidEmail} — an invalid address never reaches the network.
   *
   * The email is trimmed ONCE and the SAME trimmed string is both validated and sent,
   * so「驗證過的字串」and「送出的字串」can never diverge (core `performAwardClaim`
   * trims again — idempotent, harmless). The result arrives via
   * {@link handleAwardClaimResult} (driven by the `AWARD_CLAIM_RESULT` event).
   */
  submitAwardClaim(winner: LBWinner, email: string): boolean;
  submitAwardClaim(winner: LBWinner, email?: string): boolean {
    if (this.submitInFlightFlag) return false;
    if (email === undefined) {
      // DEPRECATED EMAIL-LESS entry point — contact stays undefined (there is no
      // email to carry). Same state machine, no email smuggling.
      this.beginSubmit(winner, undefined);
      return true;
    }
    if (!isValidClaimEmail(email)) return false;
    this.beginSubmit(winner, { email: email.trim() });
    return true;
  }

  /**
   * Shared submit core for BOTH entry points: remember the target winner, drop any
   * stale result (so「重新領獎」does not show last round's failure underneath the
   * spinner), enter in-flight, hand off to the injected player action, notify ONCE.
   */
  private beginSubmit(winner: LBWinner, contact?: LBAwardClaimInput): void {
    this.lastSubmittedWinnerId = winner?.id ?? null;
    this.latestClaimResult = null;
    this.submitInFlightFlag = true;
    this.requestAwardClaim?.(winner, contact);
    this.notifyChange();
  }

  /**
   * Close the claim sheet (design `LBWinSheet`「關閉視窗」/ 右上 ✕ / `done` 態點 scrim /
   * `FailCard`「關閉視窗」, win-claim-email-submit-rn-template).
   *
   * ⚠️ **刻意反直覺 —— 想「修好它」之前先讀這段。** 設計稿 `confirmClose` 文案是
   * 「您將放棄【獎品】的中獎資格，此動作無法復原」，但**實際行為是純 dismiss**：強烈
   * 文案是降低隨手關閉機率的 **UX 摩擦設計**，並不真的剝奪資格（權威出處：
   * `design/contract/claude-design-sync.md` R13「刻意分歧（1/2）」）。同元件 `FailCard`
   * 的「你的中獎資格仍保留」才是正確描述；兩處措辭衝突為**已知且刻意**，
   * MUST NOT「順手改一致」。
   *
   * 故本方法 MUST 只重置「本次領獎呈現」的暫態，並 MUST NOT：
   *   • 從 {@link unclaimedWinners} 移除該 winner
   *   • 遞減 {@link unclaimedCount}（中獎入口紅點保留 —— 使用者可再次開啟領取）
   *   • 呼叫**任何** API（含注入的 `requestAwardClaim`）
   *   • 重置 `lastSubmittedWinnerId`（遲到的 `claimed` 仍需它才能正確消掉紅點）
   */
  dismissClaim(): void {
    this.latestClaimResult = null;
    this.submitInFlightFlag = false;
    this.notifyChange();
  }

  /**
   * §3 — presentation classification for a winner's award (product → 查看獎品,
   * discount → 立即使用). Host binds it to pick CTA copy / glyph; it does NOT affect
   * whether an email is required — every claim goes through
   * `submitAwardClaim(winner, email)`.
   */
  classifyAward(winner: LBWinner): AwardClaimClassification {
    return classifyAward(winner);
  }

  /**
   * §4 — consume an `awardClaimResult` notification → result-state model. On a
   * claimed result the corresponding winner.id is removed from the unclaimed
   * set (count decrements). `.failed` / unknown keep the winner (retryable).
   *
   * 請求到此結束，故 {@link submitInFlight} 在**成功與失敗皆**歸零（失敗必須讓
   * reference-ui 畫得出「重新領獎」，win-claim-email-submit-rn-template）。
   */
  handleAwardClaimResult(
    params: Pick<LBAwardClaimResultParams, 'status' | 'award_type' | 'event_id' | 'award_code'>,
    winnerId?: string,
  ): void {
    this.latestClaimResult = mapAwardClaimResult(params);
    this.submitInFlightFlag = false;
    if (params.status === 'claimed') {
      const id = winnerId ?? this.lastSubmittedWinnerId;
      if (id != null) this.unclaimed.remove(id);
    }
    // §B — ONE result event = ONE coalesced notification (result-state update +
    // in-flight reset + optional claimed removal are facets of the same single
    // state change).
    this.notifyChange();
  }

  // §1 / §2 / §4 host-bindable state

  /** §1 — merged feed (oldest→newest), tail-retained to N = 7 (ambient slice). */
  get feedItems() {
    return this.feed.items;
  }

  /**
   * §1 — 置頂留言 view-model（chat-message-taxonomy ⑤，來自 `poll.top`）。無釘選 → null。
   * reference-ui 讀此值渲染置頂橫幅。
   */
  get pinnedMessage(): PinnedMessage | null {
    return this._pinnedMessage;
  }

  /**
   * §1 — the deeper scrollable history buffer (oldest→newest). Trimmed by SEPARATE
   * per-type retention (chat rows to `DEFAULT_FEED_CHAT_RETAIN`, activity rows to
   * `DEFAULT_FEED_ACTIVITY_RETAIN`, independently — chat-activity-separate-retention),
   * so real chat rows are never evicted by an activity flood. Bound by the SCROLLABLE
   * reference-ui chat feed so the user can scroll up to view recent history (parity
   * with iOS `activityFeed.history`). `feedItems` stays the N=7 slice.
   */
  get feedHistory() {
    return this.feed.history;
  }

  /** §2 — unclaimed-win count (host binds the LBWinEntry badge). */
  get unclaimedCount(): number {
    return this.unclaimed.count;
  }

  /** §2 — unclaimed winners (host binds the claim flow). */
  get unclaimedWinners(): readonly LBWinner[] {
    return this.unclaimed.winners;
  }

  /** §4 — latest award-claim result-state, or null before the first result. */
  get awardClaimResultState(): AwardClaimResultState | null {
    return this.latestClaimResult;
  }

  /**
   * live-activity-entry-rn-template — the currently DISPLAYED-page live-shopping
   * activity, or `null` when {@link activities} is empty. Host binds this to
   * decide whether to show the「活動」floating entry (`LBWinEntry(variant=
   * "activity")` parity) and, when open, what {@link LBActiveEvent} fields
   * (`title` / `keyword` / `award` / …) to render in the `LBActivitySheet`
   * popup. Re-read on each {@link subscribe} notification, same contract as
   * {@link unclaimedCount}.
   *
   * activity-sheet-multi-activity-template-rn (design.md D1) — signature is
   * UNCHANGED (`LBActiveEvent | null`), but it is now DERIVED from
   * {@link activities} / {@link currentActivityPageIndex} rather than being an
   * independently-set field, so existing readers ({@link joinEvent},
   * {@link activityByVideoId} video-switch cache, existing reference-ui
   * bindings) do not need to change — it now reflects "the activity on the
   * page the host is currently viewing" instead of always "the first one".
   */
  get currentActivity(): LBActiveEvent | null {
    return this.activitiesValue[this.currentActivityPageIndexValue] ?? null;
  }

  /**
   * activity-sheet-multi-activity-template-rn — the full list of currently-
   * running live-shopping activities (backend `event[]`), in intake-arrival
   * order. Host binds this + {@link currentActivityPageIndex} to draw a paged
   * `LBActivitySheet` when more than one activity is running concurrently.
   * Empty array = no activity running (same external meaning as the
   * pre-existing `currentActivity === null` contract). Re-read on each
   * {@link subscribe} notification.
   */
  get activities(): readonly LBActiveEvent[] {
    return this.activitiesValue;
  }

  /**
   * activity-sheet-multi-activity-template-rn — the page index into
   * {@link activities} that {@link currentActivity} currently reflects. Always
   * within `[0, activities.length - 1]` (or `0` when `activities` is empty —
   * see {@link clampActivityPageIndex}). Defaults to `0`.
   */
  get currentActivityPageIndex(): number {
    return this.currentActivityPageIndexValue;
  }

  /**
   * activity-sheet-multi-activity-template-rn — host-driven page switch
   * (paging dots / swipe gesture) for the `LBActivitySheet` popup, when
   * {@link activities} holds more than one concurrently-running activity.
   * `index` is clamped into the valid range via {@link clampActivityPageIndex}
   * — out-of-range / negative / non-finite inputs are silently absorbed, MUST
   * NOT throw. Diff-then-notify (design.md D6): fires ONE notification only
   * when the clamped index actually differs from the current one (repeated
   * calls with the same effective index, or any call while {@link activities}
   * has 0 or 1 entries — every index clamps to `0` — are silent no-ops).
   */
  setActivityPageIndex(index: number): void {
    const next = clampActivityPageIndex(index, this.activitiesValue.length);
    if (next !== this.currentActivityPageIndexValue) {
      this.currentActivityPageIndexValue = next;
      this.notifyChange();
    }
  }

  /**
   * 領獎送出中 flag（win-claim-email-submit-rn-template，parity iOS / Android
   * `submitInFlight`）。提交通過 guard 後為 `true`；領獎結果（成功或失敗皆是）/
   * {@link dismissClaim} / {@link clear} 後回 `false`；被 guard 擋下的提交**不進**
   * in-flight。reference-ui 據此畫 `LBWinSheet` 的 `submitting` 態、鎖 CTA
   * （與既有 {@link addToCartInFlight} 同層級、同風格）。
   */
  get submitInFlight(): boolean {
    return this.submitInFlightFlag;
  }

  /**
   * Player error-state for `LBPErrorScreen`, or null when not in `error`
   * (livebuy-ui-event-join-and-error-state-template). Host binds this and
   * re-reads on each {@link subscribe} notification.
   */
  get playerErrorState(): PlayerErrorState | null {
    return this.errorState.current;
  }

  // expose-player-moment-state-template — five host-bindable moment view-models

  /** StartScreen phase snapshot (host draws `LBPStartScreen`). */
  get startScreenState(): StartScreenState {
    return { phase: this.startScreen.phase };
  }

  /**
   * upcoming-intro-template-rn — Upcoming (直播預告 awaiting-live) snapshot
   * (`active` / `introPlaying` / `scheduledStartAt` / `cover`). Host / reference-ui
   * bind it to compose the upcoming LIVE chrome (countdown background + slim bottom
   * bar) instead of the LIVE / VOD chrome (priority upcoming > live > vod). Fed via
   * {@link handleUpcoming}.
   */
  get upcomingState(): UpcomingState {
    return this.upcoming.current;
  }

  /** EndScreen snapshot — `next` / `hot` / optional auto-next `countdown`. */
  get endScreenState(): EndScreenState {
    return {
      next: this.endScreen.next,
      hot: this.endScreen.hot,
      countdown: this.endScreen.countdown,
      endScreenVisible: this.endScreen.visible,
    };
  }

  /**
   * ProductOverlay snapshot — `products` + the narrate_status==2 `activeProduct`,
   * plus the pure-derived `introducingProductId` / `productsIntroducingFirst`
   * (介紹中商品排第一；parity iOS / Android). `productsIntroducingFirst` is sourced
   * from {@link productsIntroducingFirstCombined} (rn-vod-product-list-introducing-
   * order-template) rather than `this.productOverlay.productsIntroducingFirst`
   * directly, so VOD/replay is ALSO covered (see that getter's doc).
   */
  get productOverlayState(): ProductOverlayState {
    return {
      products: this.productOverlay.products,
      activeProduct: this.productOverlay.activeProduct,
      introducingProductId: this.productOverlay.introducingProductId,
      productsIntroducingFirst: this.productsIntroducingFirstCombined,
    };
  }

  /**
   * `productsIntroducingFirst` combining LIVE and VOD/replay ordering
   * (rn-vod-product-list-introducing-order-template, design.md D1/D2/D3). The
   * integration point lives HERE (in `DefaultPlayerTemplate`) rather than in
   * `DefaultProductOverlayState` (`MomentState.ts`) because only this class sees
   * all three sibling sub-states this needs (`productOverlay` / `playbackProgress`
   * via {@link vodActiveProducts} / `playerHeader`); `DefaultProductOverlayState`
   * is a deliberately narrow view-model (mirrors `PlayerErrorStateModel`) that only
   * knows `products` / `activeProduct` and MUST stay that way.
   *
   * Branch selection (design.md D2) is via EXPLICIT flags, not merely "is
   * `vodActiveProducts` non-empty" (a LIVE product MAY carry `beginTime`/`endTime`
   * too, so that alone would misfire during LIVE):
   *   1. `productOverlay.activeProduct != null` → LIVE branch: delegate to the
   *      existing `DefaultProductOverlayState.productsIntroducingFirst` UNCHANGED.
   *      `activeProduct` is core-fed and is ALWAYS `null` for VOD / finished-live
   *      replay, so this check alone is LIVE-priority AND back-compat with
   *      call-sites that never feed `isLive` (existing tests).
   *   2. Else if `playerHeader.current.isLive === true` (LIVE in progress, nothing
   *      currently narrating) → unchanged `products` order — MUST NOT reorder via
   *      `vodActiveProducts` even if some product's window happens to cover the
   *      playhead.
   *   3. Else (confirmed non-LIVE — VOD `type===1` or finished-live replay, both
   *      `isLive === false`) → move ALL of `vodActiveProducts` (already
   *      `[beginTime,endTime)`-filtered + beginTime-ascending sorted; reused
   *      VERBATIM, no re-derivation) to the front preserving their relative order,
   *      followed by the rest of `products` in original relative order. Empty
   *      `vodActiveProducts` leaves `products` unchanged (parity with the
   *      pre-existing "no active product → unchanged order" contract).
   *
   * Pure computed (no new state). reference-ui (`ProductSheetsModel.ts`) MUST NOT
   * re-sort — ordering stays a data-layer responsibility.
   */
  private get productsIntroducingFirstCombined(): readonly LBProduct[] {
    if (this.productOverlay.activeProduct != null) {
      return this.productOverlay.productsIntroducingFirst;
    }
    if (this.playerHeader.current.isLive) {
      return this.productOverlay.products;
    }
    const active = this.vodActiveProducts;
    if (active.length === 0) return this.productOverlay.products;
    const activeIds = new Set(active.map((p) => p.id));
    const rest = this.productOverlay.products.filter((p) => !activeIds.has(p.id));
    return [...active, ...rest];
  }

  /**
   * ALL products currently being introduced in a VOD (rb-rn-vod-now-introducing-multi-
   * template，問題 9/10): every product whose `[beginTime, endTime)` window (seconds,
   * backend `begin_time`/`end_time`) covers the playhead `playbackProgress.position`,
   * ordered by `beginTime` ASCENDING (earliest-introduced first). Products missing
   * begin/end are excluded; empty when none contains the playhead. Pure computed (reads
   * the existing `productOverlay.products` + `playbackProgress.position` — no second
   * state). Feeds the reference-ui now-introducing carousel; does NOT alter the LIVE
   * `productOverlay.activeProduct` (← core narratingProduct) path. Mirrors iOS / Android /
   * Flutter `vodActiveProducts` (RN, like Android, exposes ONLY the plural — its singular
   * 介紹中商品 is `productOverlay.activeProduct`, a distinct core-fed source).
   */
  get vodActiveProducts(): LBProduct[] {
    const pos = this.playbackProgress.current.position;
    return this.productOverlay.products
      .filter((p) => p.beginTime != null && p.endTime != null && p.beginTime <= pos && pos < p.endTime)
      .sort((a, b) => (a.beginTime ?? 0) - (b.beginTime ?? 0));
  }

  /**
   * ALL products currently being introduced in a LIVE (rb-rn-live-now-introducing-multi-
   * template，問題 7): every product with `narrate_status == 2` in the current
   * `productOverlay.products` snapshot. The backend MAY narrate MULTIPLE products
   * simultaneously (live-multi-narrating-product-contract: `narratingProduct` / `activeProduct`
   * take the first; this exposes the FULL set). Order follows `products` (the data-layer order;
   * template MUST NOT re-sort); empty when none. Pure computed (no second state). Feeds the
   * reference-ui LIVE now-introducing carousel; does NOT alter the single
   * `productOverlay.activeProduct` (`narrate_status == 2` first) / pinned-card path. The LIVE
   * analogue of {@link vodActiveProducts}. Mirrors iOS / Android `liveActiveProducts`.
   */
  get liveActiveProducts(): LBProduct[] {
    return this.productOverlay.products.filter((p) => p.narrateStatus === 2);
  }

  /** PlayerHeader snapshot — `isSubscribed` / `viewerCount` / `muted` / `isLive`. */
  get playerHeaderState(): PlayerHeaderState {
    return this.playerHeader.current;
  }

  /** VOD playback-progress snapshot (VOD-2) — `position` / `duration` / `isPlaying`
   *  / `isReplay`. `isReplay` drives the reference-ui bottom-bar replay variant. */
  get playbackProgressState(): PlaybackProgressState {
    return this.playbackProgress.current;
  }

  /** SubtitleTrack snapshot — `available` / `enabled`. */
  get subtitleState(): SubtitleState {
    return this.subtitle.current;
  }

  // player-chrome-template — OperationPanel side-rail + VideoInfoPanel info-tab

  /**
   * OperationPanel side-rail snapshot — ordered `{ kind, enabled }` `items` +
   * `bagCount` + monotonic `heartBurstTick` + `muted`. Host binds it to draw
   * `LBLiveBottomBar` / `LBPSideRail`; the actual actions go through the player
   * ref's EXISTING `simulate*`.
   */
  get operationRailState(): {
    items: readonly LBSideRailItem[];
    bagCount: number;
    heartBurstTick: number;
    muted: boolean;
    chatEnabled: boolean;
  } {
    return {
      items: this.operationRail.items,
      bagCount: this.operationRail.bagCount,
      heartBurstTick: this.operationRail.heartBurstTick,
      muted: this.operationRail.muted,
      // host-bindable「LIVE 留言對訪客開放」signal (same source as the .chat item enabled flag) —
      // reference-ui reads it to gate the 留言 pill to a「請先登入」modal (rb-rn-live-comment-login-gate).
      chatEnabled: this.operationRail.chatEnabled,
    };
  }

  /**
   * VideoInfoPanel info-tab snapshot `{ title, publishAt, shopName, shopIntro,
   * shopLogo, isSubscribed }`. `isSubscribed` mirrors the SINGLE PlayerHeader /
   * moment-state subscribe truth (R2 — never a second copy). `description` is
   * absent (LBChannel has no such field).
   */
  get infoTabState(): LBInfoTabState {
    return this.infoTab.currentWith(this.playerHeader.isSubscribed);
  }

  /** VideoInfoPanel active tab (`info` | `notice`). `info` is always selectable. */
  get activeInfoTab(): LBInfoPanelTab {
    return this.infoTab.activeTab;
  }

  // auth-gate-template-state — two host-bindable auth view-models

  /** auth-gate「請先登入」snapshot, or null until the first un-intercepted event. */
  get authGateState(): LBAuthGateState | null {
    return this.authGate.current;
  }

  /** Identity label `{ displayName, isLoggedIn }`, or null before first event. */
  get identityLabelState(): LBIdentityLabel | null {
    return this.identityLabel.current;
  }

  // await-toggle-and-notice-tab-template-state — two host-bindable view-models

  /**
   * Per-product goods-tracking flag pair `{ awaitEnabled, noticeEnabled }` for
   * `goodsGpn` (both false when unseen). The two flags are INDEPENDENT — toggling
   * one never moves the other. Host binds it to draw the product-detail switches.
   */
  goodsTrackingFlags(goodsGpn: string): LBGoodsTrackingFlags {
    return this.goodsTracking.flags(goodsGpn);
  }

  /** 到貨追蹤 (type=1) flag for `goodsGpn` (convenience read). */
  awaitEnabled(goodsGpn: string): boolean {
    return this.goodsTracking.awaitEnabled(goodsGpn);
  }

  /** 補貨通知 (type=2) flag for `goodsGpn` (convenience read). */
  noticeEnabled(goodsGpn: string): boolean {
    return this.goodsTracking.noticeEnabled(goodsGpn);
  }

  /**
   * VideoInfoPanel 公告分頁 snapshot `{ canOpen, isOpen, systemNotice, notice }`.
   * `canOpen` is DERIVED (either text non-empty). Host binds it to draw the panel.
   */
  get noticeTabState(): LBNoticeTabState {
    return this.noticeTab.current;
  }

  /**
   * Host-dismiss clear of the auth-gate prompt (symmetric with error-state
   * `clear`). Fires ONE coalesced notification when it actually cleared.
   */
  clearAuthGate(): void {
    if (this.authGate.clear()) this.notifyChange();
  }

  // await-toggle-and-notice-tab-template-state — goods-tracking dual switch +
  // notice-tab open-state. PUBLIC intents the host calls + `handle*` ingest
  // methods for the unified channel. Each single intent / event fans into
  // EXACTLY ONE coalesced notification.

  /**
   * Seed a product's INITIAL 到貨追蹤 / 補貨通知 flags from `LBProduct.isAwait` /
   * `isAwaitNotice` (0/1). Non-clobbering: a known `goodsGpn` is NOT overwritten
   * (a stale re-seed MUST NOT clobber an optimistic / broadcast-corrected value).
   * Fires ONE notification iff it set a new key.
   */
  seedGoodsTracking(goodsGpn: string, isAwait: number, isAwaitNotice: number): void {
    if (this.goodsTracking.seed(goodsGpn, isAwait, isAwaitNotice)) this.notifyChange();
  }

  /**
   * Host toggle 到貨追蹤 (type=1): optimistically flip ONLY the await flag (notice
   * untouched — non-mutual-exclusion), fire ONE notification, then delegate to
   * `LivebuySDK.setAwaitGoods(goodsGpn, !awaitEnabled)`. The template NEVER builds
   * HTTP. The optimistic flag is later corrected by `AWAIT_GOODS_CHANGED`.
   */
  toggleAwait(goodsGpn: string): void {
    if (this.goodsTracking.toggleAwait(goodsGpn)) this.notifyChange();
  }

  /**
   * Host toggle 補貨通知 (type=2): optimistically flip ONLY the notice flag (await
   * untouched), fire ONE notification, then delegate to
   * `LivebuySDK.setNoticeGoods(goodsGpn, !noticeEnabled)`.
   */
  toggleNotice(goodsGpn: string): void {
    if (this.goodsTracking.toggleNotice(goodsGpn)) this.notifyChange();
  }

  /**
   * AWAIT_GOODS_CHANGED — authoritative await-flag correction from the unified
   * channel. Reads snake_case `goods_gpn` (string) + `enabled` (bool / 0-1).
   * Corrects ONLY the await flag (notice untouched). Fires ONE notification iff
   * the flag actually changed.
   */
  handleAwaitGoodsChanged(params: Record<string, unknown>): void {
    const gpn = typeof params.goods_gpn === 'string' ? params.goods_gpn : null;
    if (gpn === null) return;
    if (this.goodsTracking.applyAwaitBroadcast(gpn, asBool(params.enabled))) this.notifyChange();
  }

  /**
   * NOTICE_GOODS_CHANGED — authoritative notice-flag correction. Reads snake_case
   * `goods_gpn` + `enabled`. Corrects ONLY the notice flag. Fires ONE
   * notification iff the flag actually changed.
   */
  handleNoticeGoodsChanged(params: Record<string, unknown>): void {
    const gpn = typeof params.goods_gpn === 'string' ? params.goods_gpn : null;
    if (gpn === null) return;
    if (this.goodsTracking.applyNoticeBroadcast(gpn, asBool(params.enabled))) this.notifyChange();
  }

  /**
   * Host-fed VideoInfoPanel notice texts (snapshots of core `sys_notice` /
   * `notice` from `/sdk/video` + `/sdk/video/goods`). idempotent — fires ONE
   * notification iff the texts changed (which may also collapse `isOpen`→false
   * when both turn empty). Host-fed because the unified channel does not carry
   * the channel snapshot (parity with moment-state's host-wired typed sources).
   *
   * player-chrome-template — when the notice texts turn empty the notice tab's
   * `canOpen` flips false; if the info-panel's active tab is `notice` it MUST
   * auto-fall-back to `info` (D4 / R4). Both facets fan into ONE notification.
   */
  handleNoticeTexts(systemNotice: string, notice: string): void {
    let changed = this.noticeTab.injectNotices(systemNotice, notice);
    if (this.infoTab.reconcileNoticeAvailability(this.noticeTab.canOpen)) changed = true;
    if (changed) this.notifyChange();
  }

  /**
   * Host opens the notice tab — no-op (no notification) unless `canOpen`. Fires
   * ONE notification iff `isOpen` flipped to true.
   */
  openNoticeTab(): void {
    if (this.noticeTab.openNoticeTab()) this.notifyChange();
  }

  /** Host closes the notice tab. Fires ONE notification iff `isOpen` flipped. */
  closeNoticeTab(): void {
    if (this.noticeTab.closeNoticeTab()) this.notifyChange();
  }

  // player-chrome-template — OperationPanel side-rail / PlayerHeader top-bar
  // chrome補欄 / VideoInfoPanel info-tab + two-tab switch host-bindable state.
  // PUBLIC `handle*` ingest methods (host-fed / host-wired, parity with the
  // moment-state / notice-tab precedent) + the `selectTab` intent. Each single
  // event / intent fans into EXACTLY ONE coalesced notification. The actual
  // side-rail / top-bar actions go through the player ref's EXISTING `simulate*`
  // (the host forwards them; the template does NOT rebuild interaction machinery).

  /**
   * Host-fed side-rail enabled flags (channel-derived: chat / serviceLink /
   * guestNameEdit, plus subtitleAvailable / hasStart). `goods` / `like` / `share`
   * / `more` stay always-enabled. Fires ONE notification iff a flag changed.
   */
  handleRailEnablement(flags: Partial<LBSideRailEnablement>): void {
    if (this.operationRail.handleEnablement(flags)) this.notifyChange();
  }

  /**
   * Host-wired bag-count (= ProductOverlay `products.count`; NO second products
   * copy). Fires ONE notification iff the count changed.
   */
  handleBagCount(count: number): void {
    if (this.operationRail.handleBagCount(count)) this.notifyChange();
  }

  /**
   * 會員等級限定 view-model（restriction-gate ②）。reference-ui 讀此值在 `isRestricted`
   * 時於播放畫面疊升級遮罩；core 不擋播放（軟性顯示閘門）。預設 false。
   */
  get isRestricted(): boolean {
    return this._isRestricted;
  }

  /**
   * 由統一 `VIDEO_OPEN` 事件的 `is_restriction` 衍生 `isRestricted`（`=== 1` → true，
   * 非 1 / 缺欄 → false fail-open）。diff-then-notify：值變更才 `notifyChange()`，對齊 iOS
   * `ingestChannel` 的 coalescing 語意。每次 VIDEO_OPEN（換片）以該頻道旗標重新驅動。
   * 由 `TemplateAttachment.routeEvent` 的 `VIDEO_OPEN` case 呼叫（RN 無 ingestChannel）。
   */
  applyRestriction(restricted: boolean): void {
    if (this._isRestricted === restricted) return;
    this._isRestricted = restricted;
    this.notifyChange();
  }

  /** Current video id tracked from `VIDEO_OPEN` (cart-add-tier2-unify). */
  get currentVideoId(): string | null {
    return this.currentVideoIdValue;
  }

  /**
   * 由統一 `VIDEO_OPEN` 事件的 `video_id` 追蹤當前影片短碼（cart-add-tier2-unify）。
   * 串接進 `addToCart` → `CartAddRequest.videoId`。原本是 pure assignment（不通知，無
   * 像素影響）；由 `TemplateAttachment.routeEvent` 的 `VIDEO_OPEN` case 呼叫（RN 無
   * ingestChannel）。空字串 / 非字串 → 不覆寫（fail-safe）。
   *
   * activity-entry-video-switch-cache-and-hide-rn — 新增一條例外路徑：videoId 更新後，
   * 若 {@link activityByVideoId} 對這支影片有快取紀錄（本 session 曾經造訪過，`.has()`
   * 而非只看值真假 — 快取值本身可以是 `null`，代表「造訪過、當時確認無活動」），立即
   * 把顯示還原為該快取值，不需等待下一輪 `syncActiveEvents` 輪詢。diff-then-notify：
   * 只在還原值與目前 {@link currentActivity} 不同時才 `notifyChange()`。快取內沒有這
   * 支影片的紀錄（本 session 第一次造訪）→ 維持 `clear()` 已設定的空清單，不通知。
   *
   * activity-sheet-multi-activity-template-rn (design.md D4) — the cache still
   * stores a SINGLE `LBActiveEvent | null` snapshot (unchanged data shape); a
   * hit restores {@link activitiesValue} as a ONE-element list (`[restored]`)
   * or `[]`, with {@link currentActivityPageIndexValue} reset to `0`. Any OTHER
   * activities concurrently running when this video was left are NOT restored
   * here — they reappear once the next `syncActiveEvents` poll lands.
   */
  setCurrentVideoId(videoId: string | null | undefined): void {
    if (typeof videoId === 'string' && videoId.length > 0) {
      this.currentVideoIdValue = videoId;
      if (this.activityByVideoId.has(videoId)) {
        const restored = this.activityByVideoId.get(videoId) ?? null;
        if (restored !== this.currentActivity) {
          this.activitiesValue = restored != null ? [restored] : [];
          this.currentActivityPageIndexValue = 0;
          this.notifyChange();
        }
      }
    }
  }

  /**
   * A core `likePerformed` (like API actually succeeded) → bump the monotonic
   * heart-burst tick so the host plays the burst animation. The template NEVER
   * fires like itself (the actual like goes through `simulateLikeTap` + the core
   * 250ms throttle). On RN this is fed from the unified `VIDEO_LIKE` event
   * (snake_case wire `video_id`, design D6 / R5) or a host-wired tick. Fires ONE
   * notification.
   */
  handleLikePerformed(): void {
    if (this.operationRail.handleLikePerformed()) this.notifyChange();
  }

  /**
   * Host-fed PlayerHeader top-bar chrome補欄 (`title` / `hostName` / `shopLogo` /
   * `shareUrl`) from the channel (native reads public `channel`). Folds into the
   * EXISTING PlayerHeader view-model (existing `isSubscribed` / `viewerCount` /
   * `muted` untouched). Fires ONE notification iff a field changed.
   */
  handleHeaderChrome(fields: {
    title?: string;
    hostName?: string;
    shopLogo?: string;
    shareUrl?: string;
    isLive?: boolean;
    // 回放（已結束直播）flag — host-fed (`type === 3 || (type === 2 && liveStatus === 3)`,
    // via `isFinishedLiveReplay()`). pass-through to playerHeader; parity iOS/Android.
    isFinishedLiveReplay?: boolean;
  }): void {
    if (this.playerHeader.handleHeaderChrome(fields)) this.notifyChange();
  }

  /**
   * swipe-navigate-rn-template — host-fed prev/next adjacent-video ids (resolved
   * from the public core channel: `channel.prev[0]?.id` / `channel.next[0]?.id`).
   * RN has NO `ingestChannel()`, so this is host-fed exactly like
   * {@link handleHeaderChrome}. Diff-then-notify: fires ONE coalesced
   * notification iff either id changed (folds into the single host-facing
   * `onChange` alongside the other channel-derived feeds). `undefined`→`null`.
   */
  handleNavTargets(targets: {
    prevVideoId?: string | null;
    nextVideoId?: string | null;
  }): void {
    if (this.navigation.apply(targets.prevVideoId ?? null, targets.nextVideoId ?? null)) {
      this.notifyChange();
    }
  }

  /**
   * expose-other-goods-recommendations-template — host-fed「更多商品」候選清單
   * (resolved from the public core channel: `channel.otherGoods`). RN has NO
   * `ingestChannel()`, so this is host-fed exactly like {@link handleHeaderChrome} /
   * {@link handleNavTargets}. Cached only (no notify by itself — it takes effect the
   * next time {@link handleProductTap} opens a detail sheet, mirroring how
   * `currentVideoId` is cached at the channel-injection point on iOS/Android).
   */
  handleOtherGoods(otherGoods: readonly LBProduct[] | undefined | null): void {
    this.currentOtherGoods = otherGoods ?? [];
  }

  /**
   * swipe-navigate-rn-template — read-only adjacent-video navigation snapshot
   * `{ prevVideoId, nextVideoId }` (each `null` when no adjacent video). Host
   * binds it to gate/hint a vertical-swipe-to-switch-video gesture, or reads the
   * id and drives `load(videoId)` itself; the {@link navigateToPrev} /
   * {@link navigateToNext} forwarders are the encapsulated convenience.
   */
  get navigationState(): LBPlayerNavigationState {
    return this.navigation.current;
  }

  /**
   * swipe-navigate-rn-template — switch to the previous adjacent video. Calls the
   * injected {@link loadVideo} with `navigationState.prevVideoId`; no-op when
   * there is no previous video (`null`) or `loadVideo` is unwired (the template
   * holds no player ref).
   */
  navigateToPrev(): void {
    const id = this.navigation.current.prevVideoId;
    if (id != null) this.loadVideo?.(id);
  }

  /**
   * swipe-navigate-rn-template — switch to the next adjacent video. Calls the
   * injected {@link loadVideo} with `navigationState.nextVideoId`; no-op when
   * there is no next video (`null`) or `loadVideo` is unwired.
   */
  navigateToNext(): void {
    const id = this.navigation.current.nextVideoId;
    if (id != null) this.loadVideo?.(id);
  }

  /**
   * Host-fed VOD playback progress (VOD-2) — the host echoes the native progress
   * snapshot (`position` / `duration` / `isPlaying` / `isReplay`). `isReplay` (a
   * LIVE stream scrubbed behind the live edge) drives the reference-ui bottom-bar
   * replay variant. Fires ONE notification iff a field changed.
   */
  handlePlaybackProgress(fields: {
    position: number;
    duration: number;
    isPlaying: boolean;
    isReplay: boolean;
  }): void {
    if (this.playbackProgress.handleProgress(fields)) this.notifyChange();
  }

  /**
   * rn-vod-playback-progress-template — VOD play/pause control forwarder. Calls
   * the injected {@link requestTogglePlayPause} (the host's player ref
   * `togglePlayPause()`); safe no-op when unwired. Pure forwarder — no gating
   * (play/pause is not a VOD-scrub concern, parity iOS/Android).
   */
  togglePlayPause(): void {
    this.requestTogglePlayPause?.();
  }

  /**
   * rn-vod-playback-progress-template — VOD absolute-seek control forwarder.
   * Calls the injected {@link requestSeek} (the host's player ref
   * `seek(seconds)`) with `seconds` unchanged; safe no-op when unwired. Pure
   * forwarder — the template MUST NOT redo the scrub gate (`vodScrubAllowed`
   * already gates this client-side inside the RN core bridge).
   */
  seek(seconds: number): void {
    this.requestSeek?.(seconds);
  }

  /**
   * rn-vod-playback-progress-template — VOD relative-seek control forwarder.
   * Calls the injected {@link requestSeekBy} (the host's player ref
   * `seekBy(delta)`) with `delta` unchanged; safe no-op when unwired. Pure
   * forwarder — same no-regate contract as {@link seek}.
   */
  seekBy(delta: number): void {
    this.requestSeekBy?.(delta);
  }

  /**
   * Host-fed VideoInfoPanel info-tab fields (`title` / `publishAt` / `shopName` /
   * `shopIntro` / `shopLogo`; `description` EXCLUDED — LBChannel has no such
   * field). `isSubscribed` is NOT fed here — it mirrors the single PlayerHeader
   * truth ({@link infoTabState}). Fires ONE notification iff a field changed.
   */
  handleInfo(fields: {
    title?: string;
    publishAt?: string;
    shopName?: string;
    shopIntro?: string;
    shopLogo?: string;
  }): void {
    if (this.infoTab.handleInfo(fields)) this.notifyChange();
  }

  /**
   * Host selects a VideoInfoPanel tab. `info` is ALWAYS selectable; `notice` is
   * selectable ONLY when the notice tab `canOpen` (otherwise a no-op, D4). Fires
   * ONE notification iff `activeTab` changed.
   */
  selectInfoTab(tab: LBInfoPanelTab): void {
    if (this.infoTab.selectTab(tab, this.noticeTab.canOpen)) this.notifyChange();
  }

  // §B — change notification (expose-default-template-bindable-state)

  /**
   * Register a coalesced "state changed" listener. The listener receives NO
   * diff — re-read {@link feedItems} / {@link unclaimedCount} /
   * {@link unclaimedWinners} / {@link awardClaimResultState} on each call.
   * Returns an idempotent unsubscribe (mirrors the core `registerListener`
   * contract). Fired on the JS thread, EXACTLY ONCE per single state change.
   * Additive: omitting this leaves behaviour unchanged.
   */
  subscribe(listener: ChangeListener): Unsubscribe {
    return this.changeEmitter.subscribe(listener);
  }

  /**
   * §B — reset all host-bindable state (merged feed, unclaimed set, latest
   * result-state) and fire ONE coalesced change notification. Additive: hosts
   * that never call it are unaffected; provided for parity with the native
   * `clear()` (iOS/Android/Flutter) so the notification semantics match.
   */
  clear(): void {
    this.feed.clear();
    this.unclaimed.clear();
    // activity-entry-video-switch-cache-and-hide-rn — snapshot the OUTGOING
    // video's currently-DISPLAYED activity (the `currentActivity` getter — a
    // single value, activity-sheet-multi-activity-template-rn design.md D4
    // keeps the cache's data shape unchanged) into the per-videoId cache
    // BEFORE wiping it below, so a later in-place switch back to this same
    // video can restore it immediately (see setCurrentVideoId). clear() runs
    // on VIDEO_SWITCH, strictly BEFORE VIDEO_OPEN's setCurrentVideoId advances
    // currentVideoIdValue to the incoming id — so it still holds the
    // outgoing id here, and `this.currentActivity` still reflects the
    // outgoing video's activities/page (read BEFORE they are reset below).
    if (this.currentVideoIdValue != null) {
      this.activityByVideoId.set(this.currentVideoIdValue, this.currentActivity);
    }
    // live-activity-entry-rn-template — a video switch / teardown must not leak
    // the previous video's activity into the next one.
    // activity-sheet-multi-activity-template-rn — reset the full list + page,
    // not just a single value (design.md D1).
    this.activitiesValue = [];
    this.currentActivityPageIndexValue = 0;
    this.latestClaimResult = null;
    this.lastSubmittedWinnerId = null;
    // win-claim-email-submit-rn-template: 換片 / teardown 一併結束領獎 in-flight（含
    // 原生 host 攔截 awardClaimIntent 後沒有結果可消費而懸掛的那種）。
    // `lastSubmittedWinnerId` 的重置是 RN 既有行為，刻意維持（iOS / Android 不重置；
    // 兩者語意等價 —— unclaimed 同時清空，殘留 id 的 remove 與 null 的 skip 外部不可區分。
    // 見 design.md D7）。
    this.submitInFlightFlag = false;
    this.errorState.clear();
    this.startScreen.clear();
    this.endScreen.clear();
    this.productOverlay.clear();
    // suppress-product-overlay-during-intro-rn-template — the underlying
    // real-snapshot buffer must not leak into the next video / linger past
    // teardown (design.md D4).
    this.bufferedOverlayProducts = [];
    this.bufferedOverlayActiveProduct = null;
    this.playerHeader.clear();
    this.playbackProgress.clear();
    this.subtitle.clear();
    // upcoming-intro-template-rn — reset the upcoming view-model + cached lastState
    // on teardown / new video (parity with native `clear()` + resetUpcomingForSession).
    this.upcoming.clear();
    this.lastState = 'loading';
    // auth-gate-template-state — reset the auth-gate prompt. identity-label is
    // intentionally NOT reset (identity persists across feed clears; single
    // source is `AUTH_STATE_CHANGED`, not `clear()`).
    this.authGate.clear();
    // await-toggle-and-notice-tab-template-state — reset both view-models on
    // teardown / new video (parity with native `clear()`).
    this.goodsTracking.clear();
    this.noticeTab.clear();
    // player-chrome-template — reset side-rail + info-tab (PlayerHeader top-bar
    // chrome補欄 is reset by `playerHeader.clear()` above).
    this.operationRail.clear();
    this.infoTab.clear();
    // swipe-navigate-rn-template — reset the prev/next nav targets on teardown /
    // new video (parity with the other channel-derived sub-states).
    this.navigation.clear();
    // expose-other-goods-recommendations-template — reset the cached「更多商品」
    // candidate list on teardown / new video (parity with `navigation.clear()` —
    // channel-derived, MUST NOT leak a stale video's otherGoods into a new one).
    this.currentOtherGoods = [];
    // product-sheet-stack-template — reset the five sheet-stack view-models on
    // teardown / new video. cart CTA `count` is a PER-SESSION count → reset here
    // (OQ2). The add-failure / 請選規格 flags reset too.
    this.productSheet.clear();
    this.variantPicker.clear();
    this.qtyStepper.clear();
    this.miniCart.clear();
    this.cartCTA.clear();
    this.addToCartFailedFlag = false;
    this.addToCartNeedsLoginFlag = false;
    // cart-add-loading-state-rn: 換片 / 重置清除 in-flight。
    this.addToCartInFlightFlag = false;
    this.selectSpecRequiredFlag = false;
    // chat-history-dedupe — 換片後新場的第一批 backlog 應能正常 ingest（feed 已 clear、旗標 reset → 乾淨）。
    this.hasIngestedBacklog = false;
    this.notifyChange();
  }

  /** Fire the coalesced change notification once (JS thread). */
  private notifyChange(): void {
    this.changeEmitter.emit();
  }

  /**
   * url-open-host-routing-template-rn — the template's **single URL exit**.
   *
   * `LBURLOpenPolicy.decide` is the ONLY arbiter of「in-app or system router」:
   *   • `null`（not openable: empty/blank, no scheme, protocol-relative, a scheme
   *     outside the allow-list such as `javascript:` / `intent:`, http(s) without a
   *     host, a non-numeric port, a literal `\` in the authority）→ **safe no-op**;
   *   • `'inApp'` → {@link openInAppBrowser};
   *   • `'external'` → {@link openExternalUrl} (system URL router; MUST NOT be
   *     loaded into an in-app browser / WebView).
   *
   * Callers MUST NOT keep their own emptiness check or their own parse — parsing
   * happens exactly once, inside the policy.
   *
   * 🔴 The seams receive `decision.url`, **never** `rawUrl`. On iOS (`URL`) and
   * Android (`Uri`) the type system flags that mistake; on RN both are `string`,
   * so a violating implementation still COMPILES. That MUST is therefore pinned by
   * tests using an input where the two diverge (the policy trims, so
   * `"  https://livebuy.tv/x  "` yields a different string) — see
   * `__tests__/url_open_host_routing.test.ts`.
   *
   * The `default` clause assigns to `never`: when core adds an `LBURLOpenTarget`
   * member this file stops compiling instead of silently falling into an existing
   * branch (measured — `npx tsc --noEmit` reports
   * `TS2322: Type '"…"' is not assignable to type 'never'`). At runtime (an older
   * view-model layer against a newer core) it is a safe no-op, never a fallback to
   * in-app.
   */
  private openResolvedUrl(rawUrl: string): void {
    const decision = LBURLOpenPolicy.decide(rawUrl);
    if (decision === null) return;
    switch (decision.target) {
      case 'inApp':
        this.openInAppBrowser(decision.url);
        return;
      case 'external':
        this.openExternalUrl(decision.url);
        return;
      default: {
        const unhandled: never = decision.target;
        return unhandled;
      }
    }
  }

  /**
   * PRODUCT_TAP — diversion=1 opens the purchase page through
   * {@link openResolvedUrl}, i.e. routed by `LBURLOpenPolicy`
   * (url-open-host-routing-template-rn): `livebuy.tv` and any of its subdomains
   * stay in the in-app browser, every other openable URL is handed to the system
   * URL router, and a non-openable URL is a safe no-op. diversion=0 opens the in-app
   * product-detail sheet (product-sheet-stack-template D1): map the `LBProduct` →
   * product-detail state, reset the variant-picker (groups from `specOptions`,
   * selection cleared) and qty-stepper (bounds from the product's `stock` /
   * `soldOut`), clear any stale add-failure / 請選規格 flags, and fire ONE coalesced
   * notification. This handler is only reached when the host did NOT intercept
   * `productTap`; when the host takes over (route A), it also takes over the detail
   * sheet → no state set. Interception order is unchanged:
   * **intercept (upstream) → verdict → present**.
   */
  handleProductTap(
    product: { diversionUrl?: string } & Partial<LBProduct>,
    diversion: number,
  ): void {
    if (diversion === 1) {
      // `?? ''` folds a missing field into「not openable」so the policy — not this
      // call site — decides. `decide` takes a `string`; the payload may be a light
      // `{}` with no `diversionUrl`.
      this.openResolvedUrl(product?.diversionUrl ?? '');
      return;
    }
    if (diversion !== 0) return;
    // diversion==0 — in-app product panel. host-takeover (route A) excludes the
    // template's detail sheet (the host draws + owns the add flow).
    if (this.hostOwnsCart) return;
    // The full LBProduct is only present when the host forwards it (the unified
    // PRODUCT_CLICK params are light); a bare {diversionUrl} payload has no id.
    if (product == null || product.id === undefined) return;
    const full = product as LBProduct;
    const detail = this.productSheet.openDetail(full, this.currentOtherGoods);
    // DIFF-THEN-NOTIFY (parity with iOS): re-tapping the SAME product while its
    // sheet is still open is a no-op (no variant/qty reset, no notification). A
    // genuine open (new product, or re-open after `closeProductDetail()`) resets
    // the variant/qty state and fires ONE coalesced notification.
    if (!this.productSheet.lastOpenChanged) return;
    this.variantPicker.reset(detail.specOptions, detail.specifications);
    // qty bounds from the selected spec (none yet) → fall back to product stock.
    this.qtyStepper.recomputeBounds(detail.stock, detail.soldOut, /* keepQty */ false);
    this.addToCartFailedFlag = false;
    this.addToCartNeedsLoginFlag = false;
    // cart-add-loading-state-rn: 開新詳情清除 stale in-flight（與 failure / needs-login 旗標並列）。
    this.addToCartInFlightFlag = false;
    this.selectSpecRequiredFlag = false;
    this.notifyChange();
  }

  /**
   * Close the open product-detail sheet (parity with iOS `closeProductDetail()`).
   * Clears the `productDetailState` and fires ONE coalesced notification iff a
   * sheet was open. The host / reference-ui calls this on a sheet dismiss so a
   * later re-open of the SAME product surfaces again (the `openDetail`
   * diff-then-notify would otherwise treat the same product as a no-op). Parity
   * with the other intent methods' notify semantics.
   */
  closeProductDetail(): void {
    if (this.productSheet.clearDetail()) this.notifyChange();
  }

  // product-sheet-stack-template — host-bindable商品 sheet-stack read surface +
  // intents. The host binds the five states and drives the sheet via the intents;
  // each single intent / event fans into EXACTLY ONE coalesced notification (a
  // single add-success coalesces mini-cart + cart-CTA into one). The actual sheet
  // pixels are drawn by the host (template MUST NOT render any sheet / chip /
  // stepper / mini-cart / CTA).

  /** product-detail snapshot (`LBPBottomSheet` + `LBPProductRow`), or null when closed. */
  get productDetailState(): LBProductDetailState | null {
    return this.productSheet.detail;
  }

  /** variant-picker snapshot — `groups` / `selection` / resolved `selectedSpec`. */
  get variantState(): LBVariantState {
    return this.variantPicker.current;
  }

  /** qty-stepper snapshot `{ qty, min, max }`. */
  get qtyState(): LBQtyState {
    return this.qtyStepper.current;
  }

  /** mini-cart peek `{ productId, name, priceShow, soldOut }`, or null. */
  get miniCartPeek(): LBMiniCartPeek | null {
    return this.miniCart.peek;
  }

  /** cart CTA snapshot `{ count }` (per-session add count). */
  get cartCTAState(): LBCartCTAState {
    return this.cartCTA.current;
  }

  /** True iff the last `addToCart()` was blocked by an incomplete variant selection. */
  get selectSpecRequired(): boolean {
    return this.selectSpecRequiredFlag;
  }

  /** True iff the last route-B `addToCart()` delegation rejected (host shows error). */
  get addToCartFailed(): boolean {
    return this.addToCartFailedFlag;
  }

  /**
   * True iff the last route-B `addToCart()` rejected with the「需登入」signal
   * (`{ type: 'serverError', code: 401 }`, empty `buy_no`). Orthogonal to
   * {@link addToCartFailed} — the reference-ui shows the login gate, not the failure banner.
   */
  get addToCartNeedsLogin(): boolean {
    return this.addToCartNeedsLoginFlag;
  }

  /**
   * 加購請求進行中 flag（cart-add-loading-state-rn）。{@link addToCart} 委派 requester 前為 true、
   * 各結果（success / dedupe / failure / needs-login）回 false；開新詳情 / 換片重置。reference-ui 據此
   * 鎖 CTA / 顯示 spinner（與 iOS / Android `addToCartInFlight` 對稱）。
   */
  get addToCartInFlight(): boolean {
    return this.addToCartInFlightFlag;
  }

  /**
   * Host-takeover toggle: when the host owns add-to-cart (route A
   * `CART_ADD_REQUEST`), set true so the template excludes route B AND the detail
   * sheet (avoid the double-write). On RN the unified channel carries no
   * interception-result, so the host sets this explicitly (host-takeover-by-
   * convention precedent). No-op (no notify) — purely a routing flag.
   */
  setHostOwnsCart(owns: boolean): void {
    this.hostOwnsCart = owns;
  }

  /** Host picks a variant chip. Re-resolves the spec, re-clamps qty, ONE notify. */
  selectVariant(groupIndex: number, optionIndex: number): void {
    if (!this.variantPicker.selectVariant(groupIndex, optionIndex)) return;
    // The qty `max` follows the newly-selected spec stock (or product stock when
    // unresolved); keep the current qty, re-clamped (D3).
    const spec = this.variantPicker.selectedSpec;
    const detail = this.productSheet.detail;
    const stock = spec ? spec.stock : (detail?.stock ?? 0);
    const soldOut = detail?.soldOut ?? 0;
    this.qtyStepper.recomputeBounds(stock, soldOut, /* keepQty */ true);
    // A fresh valid selection clears the 請選規格 prompt.
    if (this.variantPicker.selectedSpec !== null) this.selectSpecRequiredFlag = false;
    this.notifyChange();
  }

  /** Host sets the qty (clamped to [min, max]). ONE notify iff it changed. */
  setQty(value: number): void {
    if (this.qtyStepper.setQty(value)) this.notifyChange();
  }

  /** Host +1 (clamped to max). ONE notify iff it changed. */
  incQty(): void {
    if (this.qtyStepper.incQty()) this.notifyChange();
  }

  /** Host -1 (clamped to min). ONE notify iff it changed. */
  decQty(): void {
    if (this.qtyStepper.decQty()) this.notifyChange();
  }

  /** Host dismisses the mini-cart peek. ONE notify iff it changed. */
  dismissMiniCart(): void {
    if (this.miniCart.dismissMiniCart()) this.notifyChange();
  }

  /**
   * Host opens the product detail from the mini-cart peek. Re-opens the detail
   * sheet for the peeked product when the host forwards the full `LBProduct`
   * (the peek itself is a light snapshot). No-op when no product is supplied.
   */
  openDetailFromMiniCart(product: LBProduct): void {
    this.handleProductTap(product, 0);
  }

  /**
   * Host opens the checkout (cart CTA passthrough — view-cart-event-rn-template).
   * The template does NOT own the checkout page — it forwards to the wired
   * `onOpenCart` with the current product detail's id (商品詳情頁 CTA) or
   * `undefined` (商品列表底部 CTA). The host wires `onOpenCart` to the player
   * ref's `requestViewCart(productId)` (emit `VIEW_CART`, notification /
   * non-navigation / no auto-PiP). No-op + no notify (purely a passthrough intent).
   */
  openCart(): void {
    this.onOpenCart?.(this.productSheet.detail?.productId);
  }

  /**
   * product-sheet-stack-template — the add-to-cart intent (route B). Guards:
   *   - host-takeover (route A) → MUST NOT delegate (avoid double-write).
   *   - no open product → no-op.
   *   - `max == 0` (缺貨) → MUST NOT delegate.
   *   - has variant groups but `selectedSpec == nil` (未選齊) → MUST NOT delegate,
   *     raise the 請選規格 flag (host prompts) + ONE notify.
   * Otherwise it builds the route-B request (`goodsId` / `num` = qty /
   * `specificationId` = selectedSpecificationId, omitted for a no-spec product)
   * and delegates the injected requester. On success → set the mini-cart peek +
   * cart-CTA +1 → ONE coalesced notify; on failure (requester rejects) → raise the
   * add-failure flag + ONE notify, count UNCHANGED. The template NEVER builds HTTP.
   */
  async addToCart(): Promise<void> {
    if (this.hostOwnsCart) return; // route A owns it — no route-B delegation.
    const detail = this.productSheet.detail;
    if (detail == null) return;
    if (this.qtyStepper.max === 0) return; // 缺貨 — blocked.
    const hasGroups = this.variantPicker.groups.length > 0;
    const selectedSpec = this.variantPicker.selectedSpec;
    if (hasGroups && selectedSpec === null) {
      // 未選齊規格 — block + surface the 請選規格 flag.
      if (!this.selectSpecRequiredFlag) {
        this.selectSpecRequiredFlag = true;
        this.notifyChange();
      }
      return;
    }
    // New attempt — clear BOTH transient flags before the request so the reference-ui
    // gate / failure banner re-fire on this attempt's outcome (parity iOS line-786 reset).
    this.addToCartFailedFlag = false;
    this.addToCartNeedsLoginFlag = false;
    // cart-add-loading-state-rn: 即將委派 requester → in-flight true，立即發一次通知（loading 起點，
    // 讓 reference-ui 鎖 CTA / 顯示 spinner）。守門 early-return 路徑不會到這裡。parity iOS/Android。
    this.addToCartInFlightFlag = true;
    this.notifyChange();
    const goodsId = Number(detail.productId);
    const specId = this.variantPicker.selectedSpecificationId;
    const request = {
      goodsId,
      num: this.qtyStepper.qty,
      ...(specId != null ? { specificationId: Number(specId) } : {}),
      // cart-add-tier2-unify：帶入當前影片短碼 → core CART_ADD_REQUEST.video_id。
      ...(this.currentVideoIdValue != null ? { videoId: this.currentVideoIdValue } : {}),
    };
    try {
      await this.addToCartRequester(request);
      // Success — set the mini-cart peek + bump the cart-CTA count. Both facets
      // of this single add coalesce into ONE notification (D6).
      // minicart-peek-add-only — a successful route-B add is the ONLY thing that
      // populates the mini-cart peek (the narrating fallback was removed).
      this.miniCart.setPeek({
        productId: detail.productId,
        name: detail.name,
        priceShow: detail.priceShow,
        soldOut: detail.soldOut,
      });
      this.cartCTA.incrementOnAdd();
      this.addToCartFailedFlag = false;
      this.addToCartNeedsLoginFlag = false;
      // cart-add-loading-state-rn: 結果回來 → 解除 in-flight（與 peek / cartCTA 同一次 coalesced notify）。
      this.addToCartInFlightFlag = false;
      this.notifyChange();
    } catch (e) {
      // Branch the rejection (cart-add-tier2-unify): a 30s 重複加購 dedupe-hit
      // (`{ type: 'cartAddDeduplicated' }`) → 已加入 UX (refresh mini-cart peek, count
      // UNCHANGED, no failure flag); the core「needs login」signal (`serverError` 401 for
      // an empty buy_no) → needs-login (reference-ui login gate); any other rejection →
      // genuine failure (retry banner). parity iOS/Android.
      if (isAddToCartDeduplicated(e)) {
        // Dedupe-hit「已加入購物車」: refresh the peek but DO NOT increment the CTA
        // count (the original add already bumped it) and DO NOT set the failure flag.
        this.miniCart.setPeek({
          productId: detail.productId,
          name: detail.name,
          priceShow: detail.priceShow,
          soldOut: detail.soldOut,
        });
      } else if (isAddToCartAuthRequired(e)) {
        this.addToCartNeedsLoginFlag = true;
      } else {
        this.addToCartFailedFlag = true;
      }
      // cart-add-loading-state-rn: 任一結果分支完成 → 解除 in-flight（與該分支旗標同一次 notify）。
      this.addToCartInFlightFlag = false;
      this.notifyChange();
    }
  }

  // Layout well-known keys (Task 7.7)

  get productOverlayPosition(): string {
    return this.effectiveConfig.layoutValue('productOverlay_position', 'bottom') as string;
  }

  get productOverlayStyle(): string {
    return this.effectiveConfig.layoutValue('productOverlay_style', 'sheet') as string;
  }
}

/**
 * Visibility cascade for operation panel buttons (Task 7.6).
 */
export class DefaultOperationPanel {
  readonly chatVisible: boolean;
  readonly productVisible: boolean;
  readonly announcementVisible: boolean;

  constructor(sdkConfig: SDKConfig, hostOptions?: LBUIOptions | null) {
    this.chatVisible = ConfigMerger.effectiveVisibility(
      sdkConfig.visibility?.chat,
      hostOptions?.visibility?.chat,
      true,
    );
    this.productVisible = ConfigMerger.effectiveVisibility(
      sdkConfig.visibility?.productOverlay,
      hostOptions?.visibility?.productOverlay,
      true,
    );
    // #1 — the 公告 (announcement) button is gated by `videoInfoPanel`, NOT
    // `activityNotification` (Visibility Cascade spec / D1). `activityNotification`
    // controls the ActivityNotification component itself and has no panel button.
    this.announcementVisible = ConfigMerger.effectiveVisibility(
      sdkConfig.visibility?.videoInfoPanel,
      hostOptions?.visibility?.videoInfoPanel,
      true,
    );
  }
}

/**
 * Default Widget template event handler (Task 7.5, 7.7).
 *
 * ## Host contract (widget-content-template)
 *
 * This class is the per-Widget Default template instance the host obtains via
 * the public accessor {@link attachWidgetTemplate}().{@link
 * WidgetTemplateAttachment.template template} (symmetric with the player
 * accessor). Its READ surface is part of the public, module-external contract:
 *
 *   - {@link content}   — host-bindable widget-content view-model (videos / mode
 *                         / currentPage / lastPage / liveVideo / widgetColor /
 *                         widgetBgcolor / productCard) mirroring core `LivebuyWidget`
 *   - {@link subscribe} — coalesced change notification (re-read {@link content})
 *   - {@link carouselEffect} / {@link carouselAutoPlay} / {@link gridColumns} —
 *                         EXISTING layout keys (UNCHANGED — purely additive)
 *   - {@link handleVideoTap} — EXISTING card-tap → open Player (UNCHANGED)
 *
 * The host CONSUMES this state and re-reads it on each {@link subscribe}
 * notification. The INTERNAL wiring — `handleWidgetSnapshot` / `handleWidgetColors`
 * / `handleWidgetClose` — exists so the host can feed the core widget's typed
 * content (RN's widget content is host-wired, design D7); hosts do not construct
 * the instance themselves (use {@link attachWidgetTemplate}).
 */
export class DefaultWidgetTemplate {
  private readonly effectiveConfig: EffectiveConfig;
  private readonly onVideoTap?: (videoId: string) => void;

  /**
   * widget-content-template — host-bindable widget-content view-model mirroring
   * core `LivebuyWidget` (videos / mode / currentPage / lastPage / liveVideo) +
   * the `/sdk/widget` response-root settings — the `widget-bridge-color-core`
   * colors and the `widget-product-card-bridge-rn` `productCard`. core stays
   * headless: this only mirrors
   * the public state. The host binds {@link content} for `widgets.jsx` and feeds
   * the typed source via {@link handleWidgetSnapshot} / {@link handleWidgetColors}
   * / {@link handleWidgetClose} (RN host-wired, design D7). Each mutation
   * coalesces into ONE change notification.
   */
  private readonly widgetContent = new DefaultWidgetContent();

  /**
   * §B — coalesced "state changed" emitter (parity with the player template).
   * Fired EXACTLY ONCE after any single widget-content mutation (videos updated /
   * mode changed / pagination advanced / liveVideo updated / colors updated).
   * Additive: when the host registers no listener via {@link subscribe},
   * behaviour is unchanged.
   */
  private readonly changeEmitter = new ChangeEmitter();

  constructor(params: {
    sdkConfig: SDKConfig;
    hostOptions?: LBUIOptions | null;
    onVideoTap?: (videoId: string) => void;
  }) {
    this.effectiveConfig = new EffectiveConfig(params.sdkConfig, params.hostOptions);
    this.onVideoTap = params.onVideoTap;
    // #3 — surface backend widget layout keys this template version doesn't recognise.
    logUnknownLayoutKeys('widget', params.sdkConfig.layout?.widget, KNOWN_WIDGET_LAYOUT_KEYS);
  }

  /** VIDEO_TAP — navigate to player via provided callback (UNCHANGED — additive). */
  handleVideoTap(videoId: string): void {
    this.onVideoTap?.(videoId);
  }

  // widget-content-template — host-bindable widget-content read surface + the
  // internal host-wired ingest methods. The host binds `content` and feeds the
  // core widget's typed content (RN widget content is host-wired, design D7).
  // Each single snapshot / colors / close fans into EXACTLY ONE coalesced
  // notification (D6).

  /**
   * widget-content view-model snapshot (`videos` / `mode` / `currentPage` /
   * `lastPage` / `liveVideo` / `widgetColor` / `widgetBgcolor` / `productCard`).
   * Host binds it to
   * draw `LBPCarousel` / `LBPCarouselCard` / `LBPVideoShop` / `LBPFloatingWidget`
   * / `LBPMinimizedWidget`. The template renders NOTHING.
   */
  get content(): LBWidgetContent {
    return this.widgetContent.current;
  }

  /**
   * Host-forwarded core-widget snapshot (videos / mode / pagination / liveVideo /
   * isClosed). On RN the JS template cannot hold the native widget, so the host
   * forwards the widget's typed content here (design D7, parity with the
   * moment-state host-wired precedent). Only supplied facets update; ONE
   * coalesced notification iff anything changed.
   */
  handleWidgetSnapshot(snapshot: LBWidgetSnapshot): void {
    if (this.widgetContent.handleSnapshot(snapshot)) this.notifyChange();
  }

  /**
   * Host-forwarded `/sdk/widget` response-root settings (the bridge maps the
   * snake_case `LBWidgetResponse` event → camelCase `LBWidgetSettings`: the
   * web-embed colors from `widget-bridge-color-core` plus `productCard` from
   * `widget-product-card-bridge-rn` — the widget-content fields not derivable
   * from the widget instance). RAW PASSTHROUGH — the template MUST NOT interpret
   * the semantics. ONE notification iff a field changed. Missing colors keep the
   * core defaults (`widgetColor = 1` / `widgetBgcolor = null`, D4); a missing
   * `productCard` is `null` and is NEVER defaulted to `'inside'`.
   *
   * The parameter is `LBWidgetColors` widened with an OPTIONAL `productCard`, so
   * an existing colors-only caller still compiles while the bridge's
   * `LBWidgetSettings` can be passed straight through (design D3).
   */
  handleWidgetColors(settings: LBWidgetSettingsInput): void {
    if (this.widgetContent.handleColors(settings)) this.notifyChange();
  }

  /**
   * Floating widget closed (user closed the floating window) → derive
   * `mode == minimized` while the core mode is `floating` (D3). ONE notification
   * iff the derived mode changed.
   */
  handleWidgetClose(): void {
    if (this.widgetContent.handleClose()) this.notifyChange();
  }

  /**
   * §B — register a coalesced "state changed" listener (no diff — re-read
   * {@link content} on each call). Returns an idempotent unsubscribe (mirrors the
   * core `registerListener` contract). Fired on the JS thread, EXACTLY ONCE per
   * single state change. Additive: omitting this leaves behaviour unchanged.
   */
  subscribe(listener: ChangeListener): Unsubscribe {
    return this.changeEmitter.subscribe(listener);
  }

  /**
   * §B — reset the widget-content view-model and fire ONE coalesced change
   * notification (parity with the player template `clear()`). Additive.
   */
  clear(): void {
    this.widgetContent.clear();
    this.notifyChange();
  }

  /** Fire the coalesced change notification once (JS thread). */
  private notifyChange(): void {
    this.changeEmitter.emit();
  }

  // Widget layout well-known keys (Task 7.7 — UNCHANGED, purely additive)

  get carouselEffect(): string {
    return this.effectiveConfig.widgetLayoutValue('carousel_effect', 'slide') as string;
  }

  get carouselAutoPlay(): boolean {
    return this.effectiveConfig.widgetLayoutValue('carousel_autoPlay', false) as boolean;
  }

  get gridColumns(): number {
    return this.effectiveConfig.widgetLayoutValue('grid_columns', 2) as number;
  }
}

/** Re-export the widget-content mode enum value for host convenience. */
export { LBWidgetContentMode };
