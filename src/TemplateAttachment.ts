import { DefaultPlayerTemplate, DefaultWidgetTemplate } from './DefaultTemplate';
import { LivebuyUI } from './LivebuyUI';
import type { LBUIOptions } from './LBUIOptions';
import { ActivityTier } from './ActivityFeed';
import type { RequestAwardClaimWithContact } from './AwardClaimFlow';
import type { ChangeListener, Unsubscribe } from './ChangeEmitter';
import type { GoodsTrackingSetter } from './GoodsTracking';
import type { EndScreenNavRow, EndScreenHotRow } from './MomentState';
import type { LBSideRailEnablement } from './OperationRail';
import { LBInfoPanelTab } from './InfoTab';
import type { CartAddRequester } from './ProductSheet';
import type { LBWidgetSnapshot, LBWidgetSettingsInput } from './WidgetContent';
import type { SDKConfig, LBSdkEvent, LBEventHandler, LBWinner, LBProduct } from 'livebuy-react-native';

// MARK: - livebuy-ui-event-wiring-template — RN attach wiring (design D3)
//
// On iOS / Android the template layer owns the native Player instance and must
// attach at instantiate time via a core `onInstantiate` hook, using **two
// routes** (typed callbacks for full objects + an auxiliary unified listener
// for notification-only events). React Native is different: the native Player
// is wrapped by the bridge and the JS template layer cannot hold it directly.
// Instead, the bridge exposes a SINGLE unified event channel (`registerListener`
// in `LivebuyEvents.ts`) that multiplexes every SDK event. So the RN template
// has NO two-route problem — it subscribes the unified listener once and routes
// each event by `eventName` to the Default template handlers.
//
// Attach timing (D3): host mounts the player component -> `attachPlayerTemplate`.
// Unmount: call the returned unsubscribe (mirrors the core `registerListener`
// contract, which returns an unsubscribe function).
//
// Event routing parity with the iOS pilot (`TemplateAttachment.swift`):
//   PRODUCT_CLICK     -> handleProductTap        (route A on native; here unified)
//   POLL_RECEIVED     -> handlePollReceived + activity/live-end derivation
//   VIDEO_STATE_CHANGE-> handlePlayerStateChange
//   DISMISS_REQUEST   -> handleDismissRequest    (route B on native)
//   WIN_RECEIVED      -> handleWinReceived       (route B on native; §5.1 owns UI)
// Every other event is left to the host's own listener — never double-handled.

/**
 * The core unified-listener subscription API (`registerListener` in
 * `LivebuyEvents.ts`): install a handler for ALL SDK events; returns an
 * unsubscribe function. Declared locally (structurally identical to the core's
 * export) so this module avoids a top-level *value* import of
 * `livebuy-react-native`, which would pull the real `react-native` flow runtime
 * into jest. The real implementation is lazy-required at attach time (see
 * `defaultRegisterListener`).
 */
export type RegisterListener = (handler: LBEventHandler) => () => void;

/**
 * Lazy bridge to the core `registerListener`. The value import of
 * `livebuy-react-native` pulls in `NativeModules`, which is unavailable in
 * node/jest. Tests inject a fake `registerListener` and never reach this; only
 * a real RN runtime evaluates it (same seam as DefaultTemplate's opener).
 */
const defaultRegisterListener: RegisterListener = (handler) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerListener } = require('livebuy-react-native');
  return registerListener(handler);
};

/**
 * Unified event names this template routes. Values are identical to the core
 * `LBEvents` constants (each event's value equals its key); declared locally to
 * keep this module free of a top-level value import (see `RegisterListener`).
 */
const ROUTED = {
  PRODUCT_CLICK: 'PRODUCT_CLICK',
  POLL_RECEIVED: 'POLL_RECEIVED',
  VIDEO_STATE_CHANGE: 'VIDEO_STATE_CHANGE',
  DISMISS_REQUEST: 'DISMISS_REQUEST',
  WIN_RECEIVED: 'WIN_RECEIVED',
  // reconcile-activity-notification-contract-template §4 — result-state model.
  AWARD_CLAIM_RESULT: 'AWARD_CLAIM_RESULT',
  // auth-gate-template-state — auth-gate + identity-label view-models.
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_STATE_CHANGED: 'AUTH_STATE_CHANGED',
  // await-toggle-and-notice-tab-template-state — authoritative goods-tracking
  // dual-switch corrections (goods-await-notice-endpoints-core §5.2). The core
  // dispatches these once the /sdk/goods/await · /sdk/goods/notice write
  // completes; the template corrects its optimistic flag from the broadcast.
  AWAIT_GOODS_CHANGED: 'AWAIT_GOODS_CHANGED',
  NOTICE_GOODS_CHANGED: 'NOTICE_GOODS_CHANGED',
  // player-chrome-template — heart-burst tick source. The unified `VIDEO_LIKE`
  // event (analytics-style, snake_case wire `{ video_id }`, design D6 / R5) fires
  // once per real like success; the side-rail bumps a monotonic burst tick so the
  // host plays the heart animation. The template NEVER fires like itself.
  VIDEO_LIKE: 'VIDEO_LIKE',
  // activity-feed-clear-on-video-switch parity — core dispatches VIDEO_SWITCH on a
  // real video change ({ from_video_id, to_video_id }); the template resets the
  // per-video-session state so the next video starts clean.
  VIDEO_SWITCH: 'VIDEO_SWITCH',
  // restriction-gate-template parity — core dispatches VIDEO_OPEN on channel-apply
  // ({ video_id, title, is_restriction }); the template derives `isRestricted` from
  // the soft display-gate flag (RN has NO ingestChannel, so this is the channel feed).
  VIDEO_OPEN: 'VIDEO_OPEN',
} as const;

/**
 * Decode the unified `WIN_RECEIVED` payload (native shape
 * `{ id, event_id, title, award_type, award_name, award_code }`) into an
 * `LBWinner` (post LBWinner rename: event_id / title). The pre-i18n display
 * `text` is composed identically to native showWin (`"{title} - {award.name}"`),
 * kept as a single string (NOT split into fields).
 */
function decodeWinner(params: Record<string, unknown>): { winner: LBWinner; text: string } {
  const title = typeof params.title === 'string' ? params.title : '';
  const awardName = typeof params.award_name === 'string' ? params.award_name : '';
  const winner: LBWinner = {
    id: typeof params.id === 'string' ? params.id : String(params.id ?? ''),
    eventId: typeof params.event_id === 'number' ? params.event_id : 0,
    title,
    award: {
      type: typeof params.award_type === 'string' ? params.award_type : '',
      code: typeof params.award_code === 'string' ? params.award_code : '',
      name: awardName,
    },
  };
  return { winner, text: `${title} - ${awardName}` };
}

/** Invoke `fn` with the `text` string of each row in a poll bucket array. */
function forEachText(bucket: unknown, fn: (text: string) => void): void {
  if (!Array.isArray(bucket)) return;
  for (const row of bucket) {
    const text = (row as { text?: unknown })?.text;
    if (typeof text === 'string') fn(text);
  }
}

/** Optional injection seam so unit tests can drive a fake template / listener. */
export interface AttachPlayerTemplateOptions {
  sdkConfig: SDKConfig;
  hostOptions?: LBUIOptions | null;
  onDismiss?: () => void;
  /**
   * §3 — player-bound award-claim action. The host wires the player ref's
   * `requestAwardClaim(winner, contact)`; the contact carries the user-entered email
   * built by `DefaultPlayerTemplate.submitAwardClaim(winner, email)`
   * (win-claim-email-submit-rn-template — closing the EMAIL-LESS trap: the core's
   * default claim path requires `email`, so a contact-less wiring makes every
   * non-intercepted built-in claim fail without even calling the API). The host MUST
   * forward the second argument (`(winner, contact) => ref.requestAwardClaim(winner,
   * contact)`); a 1-arity callback still type-checks but silently drops the email.
   * When omitted, `submitAwardClaim` is a safe no-op (the in-flight state machine
   * still runs).
   */
  requestAwardClaim?: RequestAwardClaimWithContact;
  /**
   * Player-bound event-join action. The host wires the player ref's
   * `requestEventJoin` (core emits `eventJoinIntent`). When omitted, `joinEvent`
   * still marks the item optimistically but performs no core call.
   */
  requestEventJoin?: (eid: number, keyword: string) => void;
  /**
   * auth-gate-template-state — player-bound guest-rename action. The host wires
   * the player ref's rename exit (emits `GUEST_NAME_EDIT_REQUEST`; passthrough,
   * non-navigation, no auto-PiP). When omitted, `requestGuestNameEdit` is a safe
   * no-op. Forwarded here so the documented host accessor wires it (parity with
   * `requestEventJoin` — past review caught this exact forward being missed).
   */
  requestGuestNameEdit?: () => void;
  /**
   * await-toggle-and-notice-tab-template-state — goods-tracking toggle
   * delegates. The Default template delegates `toggleAwait` / `toggleNotice` to
   * `LivebuySDK.setAwaitGoods` (type=1) / `setNoticeGoods` (type=2) (the template
   * NEVER builds HTTP). When omitted, the template uses the lazy-required core
   * methods. Injectable so unit tests capture the delegated calls with a fake.
   * Forwarded here so the documented host accessor wires them (parity with
   * `requestEventJoin` / `requestGuestNameEdit`).
   */
  setAwaitGoods?: GoodsTrackingSetter;
  setNoticeGoods?: GoodsTrackingSetter;
  /**
   * product-sheet-stack-template — route-B add-to-cart requester. The Default
   * template delegates `addToCart()` to `LivebuySDK.addToCart` (route B → the
   * `LBCartResult`; the template NEVER builds HTTP). The host wires the real
   * requester (it owns the configured `shopId`). When omitted, the template's
   * `addToCart()` is inert (the default requester rejects). Forwarded here so the
   * documented host accessor wires it (parity with `requestEventJoin` /
   * `setAwaitGoods` — past review caught this exact forward being missed).
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
   * 「開啟購物車」passthrough. The template does NOT own the checkout page; the
   * host wires this to the player ref's `requestViewCart(productId)` (emit
   * `VIEW_CART`, notification / non-navigation / no auto-PiP). `productId` is the
   * current product detail's id (詳情頁 CTA) or `undefined` (列表底部 CTA, so the
   * core seam omits the `product_id` key). Parity with `requestGuestNameEdit` /
   * `loadVideo` — a player-bound action the host wires.
   */
  onOpenCart?: (productId?: string) => void;
  /**
   * swipe-navigate-rn-template — injected adjacent-video loader. The host wires
   * the player ref's `load(videoId)` (the RN template holds no player ref —
   * parity with `requestEventJoin` / `requestAwardClaim`). The template's
   * `navigateToPrev()` / `navigateToNext()` delegate to it; when omitted those
   * forwarders are safe no-ops. Forwarded here so the documented host accessor
   * wires it (parity with the other player-bound action injections).
   */
  loadVideo?: (videoId: string) => void;
  /**
   * rn-vod-playback-progress-template — injected VOD control requesters. The
   * host wires the player ref's `togglePlayPause()` / `seek(seconds)` /
   * `seekBy(delta)` (RN core bridge, `rn-vod-playback-progress-core`); the RN
   * template holds no player ref (parity with `loadVideo` /
   * `requestEventJoin`). The returned handle's `togglePlayPause()` / `seek()` /
   * `seekBy()` delegate to these; when omitted those forwarders are safe
   * no-ops. Pure forwarders — the scrub gate (`vodScrubAllowed`) already lives
   * client-side in the core bridge, so this seam MUST NOT redo gating.
   */
  requestTogglePlayPause?: () => void;
  requestSeek?: (seconds: number) => void;
  requestSeekBy?: (delta: number) => void;
  /** Test seam: provide a prebuilt template instead of constructing one. */
  template?: DefaultPlayerTemplate;
  /**
   * Test seam: provide a `registerListener` implementation. Defaults to the
   * core RN bridge `registerListener` from `livebuy-react-native`.
   */
  registerListener?: RegisterListener;
  /**
   * expose-player-moment-state-template — host seam to wire the player's typed
   * moment sources. momentState is NOT bridged to RN (intentional, parity with
   * the error `type` precedent which the host wires via the bridge `LBError`
   * event). The host receives the attachment and forwards the player's products
   * / header / subtitle / countdown / mute into the returned handle's
   * `handleMomentSnapshot` / `handleMutedChange` / `handleEndScreenCountdown` /
   * `handleAutoNextCancelled`. This optional callback is invoked once after the
   * handle is built so the host can register those forwarders in one place.
   */
  wireMoments?: (attachment: PlayerTemplateAttachment) => void;
}

/**
 * Handle returned from {@link attachPlayerTemplate} — the public, documented
 * per-Player accessor (expose-default-template-bindable-state §A). The host
 * obtains the Default template for the Player it just attached via
 * {@link template} and reads its host-bindable state (`feedItems` /
 * `unclaimedCount` / `unclaimedWinners` / `awardClaimResultState`).
 */
export interface PlayerTemplateAttachment {
  /**
   * The Default template wired to the unified event channel. READ surface
   * (feed items / unclaimed count + winners / award-claim result state) is the
   * public host contract; the host consumes state and never feeds events
   * directly. See {@link DefaultPlayerTemplate}.
   */
  readonly template: DefaultPlayerTemplate;
  /**
   * §B — register a coalesced "state changed" listener (no diff; re-read the
   * template's bindable state on each call). Returns an idempotent unsubscribe.
   * Convenience delegate of {@link DefaultPlayerTemplate.subscribe}; subscribe
   * either here or on `template` — both target the same emitter. Fired on the
   * JS thread, EXACTLY ONCE per single state change. Additive.
   */
  subscribe(listener: ChangeListener): Unsubscribe;
  /**
   * expose-player-moment-state-template — host-wired moment snapshot. momentState
   * is NOT on the unified channel (parity with the error `type` precedent), so
   * the host forwards the player's typed products / header / subtitle / start
   * availability here. A single snapshot fans into ONE coalesced notification.
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
  }): void;
  /** Host-wired player mute flag (no RN mute callback exists — host owns the ref). */
  handleMutedChange(muted: boolean): void;
  /** Host-wired auto-next countdown tick (momentState not bridged). */
  handleEndScreenCountdown(remain: number, active: boolean): void;
  /** Host-wired auto-next cancel — countdown→null, next/hot retained. */
  handleAutoNextCancelled(): void;
  /**
   * player-chrome-template — host-fed side-rail enabled flags (channel-derived:
   * chat / serviceLink / guestNameEdit, plus subtitleAvailable / hasStart). Fed
   * here because the channel is NOT on the unified channel (parity with the
   * notice-tab `injectNotices` host-fed precedent). Forwarded so the documented
   * host accessor can wire it (past review caught a forward being missed).
   */
  handleRailEnablement(flags: Partial<LBSideRailEnablement>): void;
  /** player-chrome-template — host-wired bag-count (= `products.count`). */
  handleBagCount(count: number): void;
  /**
   * player-chrome-template — host-wired heart-burst beat. Normally driven by the
   * unified `VIDEO_LIKE` event automatically; this forwarder lets a host that
   * owns a typed `LIKE_PERFORMED` source drive the tick directly (D6).
   */
  handleLikePerformed(): void;
  /**
   * player-chrome-template — host-fed PlayerHeader top-bar chrome補欄 (`title` /
   * `hostName` / `shopLogo` / `shareUrl`) from the channel.
   */
  handleHeaderChrome(fields: {
    title?: string;
    hostName?: string;
    shopLogo?: string;
    shareUrl?: string;
    isLive?: boolean;
    // 回放（已結束直播）flag — host-fed (`type === 3 || (type === 2 && liveStatus === 3)`,
    // 用 exported `isFinishedLiveReplay(type, liveStatus)` 計算). parity iOS/Android.
    isFinishedLiveReplay?: boolean;
  }): void;
  /**
   * swipe-navigate-rn-template — host-fed prev/next adjacent-video ids (resolved
   * from the public core channel: `channel.prev[0]?.id` / `channel.next[0]?.id`).
   * RN has no `ingestChannel()`, so the host forwards them here (parity with
   * `handleHeaderChrome`). Drives the read-only `template.navigationState`.
   */
  handleNavTargets(targets: { prevVideoId?: string | null; nextVideoId?: string | null }): void;
  /**
   * expose-other-goods-recommendations-template — host-fed「更多商品」候選清單
   * (`channel.otherGoods`). RN has NO `ingestChannel()`, so the host forwards it
   * here (parity with `handleHeaderChrome` / `handleNavTargets`). Cached only —
   * takes effect the next time a product-detail sheet opens
   * (`productDetailState.recommendations`).
   */
  handleOtherGoods(otherGoods: readonly LBProduct[] | undefined | null): void;
  /**
   * swipe-navigate-rn-template — switch to the previous adjacent video (delegates
   * to the injected `loadVideo`; no-op when there is no previous video / unwired).
   */
  navigateToPrev(): void;
  /**
   * swipe-navigate-rn-template — switch to the next adjacent video (delegates to
   * the injected `loadVideo`; no-op when there is no next video / unwired).
   */
  navigateToNext(): void;
  /**
   * VOD-2 — host-fed VOD playback progress (`position` / `duration` / `isPlaying`
   * / `isReplay`). `isReplay` (a LIVE stream scrubbed behind the live edge) drives
   * the reference-ui bottom-bar "聊天室已關閉" replay variant.
   */
  handlePlaybackProgress(fields: {
    position: number;
    duration: number;
    isPlaying: boolean;
    isReplay: boolean;
  }): void;
  /**
   * rn-vod-playback-progress-template — VOD play/pause control forwarder
   * (delegates to the injected `requestTogglePlayPause`; safe no-op when
   * unwired). No gating (play/pause is not a VOD-scrub concern).
   */
  togglePlayPause(): void;
  /**
   * rn-vod-playback-progress-template — VOD absolute-seek control forwarder
   * (delegates to the injected `requestSeek`; safe no-op when unwired). Pure
   * forwarder — the scrub gate (`vodScrubAllowed`) already lives client-side
   * in the RN core bridge, so this MUST NOT redo gating.
   */
  seek(seconds: number): void;
  /**
   * rn-vod-playback-progress-template — VOD relative-seek control forwarder
   * (delegates to the injected `requestSeekBy`; safe no-op when unwired). Same
   * no-regate contract as {@link PlayerTemplateAttachment.seek}.
   */
  seekBy(delta: number): void;
  /**
   * player-chrome-template — host-fed VideoInfoPanel info-tab fields (`title` /
   * `publishAt` / `shopName` / `shopIntro` / `shopLogo`; `description` EXCLUDED).
   */
  handleInfo(fields: {
    title?: string;
    publishAt?: string;
    shopName?: string;
    shopIntro?: string;
    shopLogo?: string;
  }): void;
  /**
   * player-chrome-template — host selects a VideoInfoPanel tab. `info` always
   * selectable; `notice` selectable only when the notice tab `canOpen` (no-op
   * otherwise, D4).
   */
  selectInfoTab(tab: LBInfoPanelTab): void;
  /**
   * product-sheet-stack-template — open the product-detail sheet for a tapped
   * product. The unified PRODUCT_CLICK params are LIGHT (`{ product_id, video_id,
   * diversion }`) — they do NOT carry the full `LBProduct` (specifications /
   * specOptions / stock). So, parity with the moment-state host-wired precedent,
   * the host resolves the full `LBProduct` (it has the products list) and forwards
   * it here with the diversion. `diversion==0` opens the in-app detail sheet;
   * `diversion==1` sets no detail state and routes the URL by `LBURLOpenPolicy`
   * (in-app browser for `livebuy.tv` + subdomains, system URL router for other
   * openable URLs, safe no-op otherwise — url-open-host-routing-template-rn).
   * Host-takeover (route A) excludes the detail sheet.
   */
  handleProductTap(product: { diversionUrl?: string } & Partial<LBProduct>, diversion: number): void;
  /** product-sheet-stack-template — host picks a variant chip. */
  selectVariant(groupIndex: number, optionIndex: number): void;
  /** product-sheet-stack-template — host sets the qty (clamped to [min, max]). */
  setQty(value: number): void;
  /** product-sheet-stack-template — host +1 (clamped to max). */
  incQty(): void;
  /** product-sheet-stack-template — host -1 (clamped to min). */
  decQty(): void;
  /**
   * product-sheet-stack-template — the add-to-cart intent (route B). Delegates to
   * the injected `addToCartRequester`; guards block an unselected variant / 缺貨 /
   * host-takeover. Forwarded here so the documented host accessor wires it (parity
   * with the other player-bound action forwards).
   */
  addToCart(): Promise<void>;
  /** product-sheet-stack-template — host dismisses the mini-cart peek. */
  dismissMiniCart(): void;
  /** product-sheet-stack-template — cart CTA「開啟購物車」passthrough. */
  openCart(): void;
  /**
   * product-sheet-stack-template — host-takeover toggle. When the host owns
   * add-to-cart (route A `CART_ADD_REQUEST`), set true so the template excludes
   * route B AND the detail sheet (avoid the double-write).
   */
  setHostOwnsCart(owns: boolean): void;
  /** Detach the unified listener. Call on host unmount. Idempotent. */
  detach(): void;
}

/**
 * Route one unified SDK event to the Default Player template (parity with the
 * iOS `TemplateAuxListener.onEventTriggered` + route-A callback fan-out).
 */
function routeEvent(template: DefaultPlayerTemplate, event: LBSdkEvent): void {
  const params = (event.params ?? {}) as Record<string, unknown>;
  switch (event.eventName) {
    case ROUTED.PRODUCT_CLICK: {
      // The unified PRODUCT_CLICK params are light ({product_id, video_id}); the
      // diversion URL is not carried on this channel, so handleProductTap
      // degrades to a safe no-op unless a diversionUrl is present. diversion is
      // read from params when the bridge surfaces it (defaults to 0).
      const diversion = typeof params.diversion === 'number' ? params.diversion : 0;
      template.handleProductTap(params as { diversionUrl?: string }, diversion);
      break;
    }
    case ROUTED.POLL_RECEIVED: {
      template.handlePollReceived(params);
      // 問題4 — the native core relays the CURRENT channel `guest_comment` + `live_status` on every
      // POLL_RECEIVED (the live channel-settings refresh updates them mid-live). Re-derive
      // `chatEnabled` (`live_status === 1 && guest_comment === 1`) so a backend「開啟訪客留言」change
      // enables the guest's chat WITHOUT a re-enter. Guarded on presence so an older native (no
      // field) never clobbers the rail. Idempotent (diff-then-notify in the template).
      if (params.guest_comment !== undefined) {
        const chatEnabled =
          Number(params.live_status) === 1 && Number(params.guest_comment) === 1;
        template.handleRailEnablement({ chatEnabled });
      }
      // 問題5 — the native core relays the CURRENT channel `notice` / `sys_notice` on every
      // POLL_RECEIVED (live-notice-poll-relay-core). Ingest it so the LIVE 公告 banner / notice tab
      // show on initial load AND update mid-live when 後台 changes the 公告 — RN has NO native
      // `onChannelRefresh` consumer (iOS / Android natives ingest via that callback). OUTSIDE the
      // backlog gate (公告 is current channel state, NOT feed content — apply every round). Guarded on
      // presence so an older native (no field) never clobbers an existing 公告. `handleNoticeTexts` is
      // idempotent (diff-then-notify; empties collapse the notice tab's `canOpen`).
      if (params.notice !== undefined || params.sys_notice !== undefined) {
        const sysNotice = typeof params.sys_notice === 'string' ? params.sys_notice : '';
        const notice = typeof params.notice === 'string' ? params.notice : '';
        template.handleNoticeTexts(sysNotice, notice);
      }
      // backlog gate（chat-history-dedupe）：以 native 的 `is_backlog` cursor 訊號 + per-session 旗標
      // 分流 feed ingestion——後續輪真實新訊息（含後台刻意重送）一律灌、首輪 backlog 首次灌當歷史首屏、
      // 已 ingest 過的 backlog 重放整批 skip（換片漏 clear / 重入疊加）。判定只看 cursor 訊號 + 旗標，
      // NOT 內容（內容去重會誤殺後台刻意重送的真實通知）。handlePollReceived / handleRailEnablement /
      // handleLiveEnd 為冪等，維持每輪呼叫（不受 gate 影響）。
      if (template.shouldIngestPoll(params.is_backlog === true)) {
      // §1 — derive activity (join / purchase) + chat (push / comments) + live-
      // end from the full payload (NOT separate events; parity with native
      // onPollReceived). user[] → showJoin (Join tier), rush[] → showPurchase
      // (Purchase tier). The tier markers feed the merged feed model.
      forEachText(params.user, (t) => template.handleActivityNotice(t, ActivityTier.Join));
      forEachText(params.rush, (t) => template.handleActivityNotice(t, ActivityTier.Purchase));
      // push[] → handlePush: event-begin pushes (eid>0 && (ek非空 || at==='begin'))
      // surface as event-join items; everything else stays a chat row. comments[]
      // have no event metadata → always chat. The host's ChatView source is
      // untouched (data-layer merge only — single merge point).
      if (Array.isArray(params.push)) {
        for (const row of params.push) {
          const r = row as {
            text?: unknown;
            eid?: unknown;
            ek?: unknown;
            at?: unknown;
            color?: unknown;
            ct?: unknown;
            p?: unknown;
            price?: unknown;
            name?: unknown;
            kind?: unknown;
            reply?: unknown;
          };
          if (typeof r?.text === 'string') {
            // color / ct / p are forwarded so handlePush can route SYSTEM / 商品推播 notices
            // (product-push color #66F796 / event / promo) through the de-duped path
            // (activity-feed-dedupe-system-push parity). `name` is the author nickname
            // (chat-nickname-display) — only ordinary user chat keeps it (system notices ignore it).
            // chat-message-taxonomy ⑤ — `kind` 判型 wire 字串（停止 color 反推）、`reply` 被回覆
            // 引用內容（主播 / AI 回覆的引用框）。核心 pollReceivedEventParams 已序列化（缺則退回 color）。
            template.handlePush(r.text, {
              eid: typeof r.eid === 'number' ? r.eid : undefined,
              ek: typeof r.ek === 'string' ? r.ek : undefined,
              at: typeof r.at === 'string' ? r.at : undefined,
              color: typeof r.color === 'string' ? r.color : undefined,
              ct: typeof r.ct === 'string' ? r.ct : undefined,
              p: typeof r.p === 'string' ? r.p : undefined,
              // chat-message-taxonomy ⑤ — 已格式化開賣價（onsale 商品開賣卡現價，核心序列化提供）。
              price: typeof r.price === 'string' ? r.price : undefined,
              name: typeof r.name === 'string' ? r.name : undefined,
              kind: typeof r.kind === 'string' ? r.kind : undefined,
              reply: typeof r.reply === 'string' ? r.reply : undefined,
            });
          }
        }
      }
      forEachText(params.comments, (t) => template.handleChatMessage(t));
      } // end backlog gate
      if (params.live_end === 1) template.handleLiveEnd();
      break;
    }
    case ROUTED.VIDEO_STATE_CHANGE: {
      const state = typeof params.state === 'string' ? params.state : '';
      template.handlePlayerStateChange(state);
      break;
    }
    case ROUTED.DISMISS_REQUEST:
      template.handleDismissRequest();
      break;
    case ROUTED.WIN_RECEIVED: {
      const { winner, text } = decodeWinner(params);
      template.handleWinReceived(winner, text);
      break;
    }
    case ROUTED.AWARD_CLAIM_RESULT:
      // §4 — result-state mapping; claimed removes the in-flight winner.id from
      // the unclaimed set (the template tracks the last submitted winner).
      //
      // DELIBERATELY passes NO second argument: this router does NOT read a winner id
      // out of the wire params — the template's `lastSubmittedWinnerId` is the single
      // source (parity iOS). Re-verified under win-claim-email-submit-rn-template:
      // Android hit a key drift here (`AwardClaimResultMapper.claimedWinnerId` read
      // `params["id"]` while the wire key is `winner_id`; `id` belongs to
      // WIN_RECEIVED). RN cannot hit it because it never touches that key — do NOT
      // "helpfully" start reading one without checking `LBAwardClaimResultParams`.
      template.handleAwardClaimResult({
        status: typeof params.status === 'string' ? params.status : '',
        award_type: typeof params.award_type === 'string' ? params.award_type : '',
        event_id: typeof params.event_id === 'number' ? params.event_id : null,
        award_code: typeof params.award_code === 'string' ? params.award_code : null,
      });
      break;
    case ROUTED.AUTH_REQUIRED:
      // auth-gate-template-state — map an un-intercepted「需登入」into the
      // auth-gate state. The unified `registerListener` channel is
      // OBSERVATION-only (LBSdkEvent carries NO interception-result flag, the
      // handler returns void), so `hostIntercepted` is UNCONDITIONALLY false
      // here — the host's primary-listener takeover return is resolved natively
      // and never surfaced back to JS (parity with the RN award-claim /
      // event-join host-takeover-by-convention precedent; the exclusion path is
      // exercised at the model level, see AuthGate). This router CANNOT change
      // core interception / PendingAuthStore / auto-PiP.
      template.handleAuthRequired(params, /* hostIntercepted */ false);
      break;
    case ROUTED.AUTH_STATE_CHANGED:
      // auth-gate-template-state — notification event; the router does not
      // return (registerListener handlers return void). Reads snake_case
      // `state` / `display_name`; `resumed_action` is NOT read into state.
      template.handleAuthStateChanged(params);
      break;
    case ROUTED.AWAIT_GOODS_CHANGED:
      // await-toggle-and-notice-tab-template-state — authoritative await-flag
      // correction. Notification event; reads snake_case `goods_gpn` / `enabled`
      // and corrects ONLY the await flag (notice untouched — non-mutual-exclusion).
      template.handleAwaitGoodsChanged(params);
      break;
    case ROUTED.NOTICE_GOODS_CHANGED:
      // await-toggle-and-notice-tab-template-state — authoritative notice-flag
      // correction. Corrects ONLY the notice flag (await untouched).
      template.handleNoticeGoodsChanged(params);
      break;
    case ROUTED.VIDEO_LIKE:
      // player-chrome-template — a real like success → bump the heart-burst tick.
      // Wire key is snake_case `{ video_id }` (design D6 / R5); the tick itself
      // carries no payload (the like count is intentionally NOT exposed, OQ2).
      template.handleLikePerformed();
      break;
    case ROUTED.VIDEO_SWITCH:
      // activity-feed-clear-on-video-switch parity — core dispatched a real video
      // change (only fired when prev != new id; first-load / same-video retry never
      // reach here). Reset the per-video-session state (merged feed + unclaimed win
      // entry + …) so the next video starts clean. `clear()` is the shared reset.
      template.clear();
      break;
    case ROUTED.VIDEO_OPEN:
      // restriction-gate-template parity — channel-apply carries the SOFT display-gate
      // `is_restriction` (additive param, Int 0/1). Derive `isRestricted` (=== 1; non-1
      // / missing → false fail-open) so reference-ui overlays the upgrade mask. RN has
      // NO ingestChannel, so VIDEO_OPEN is the channel feed; diff-then-notify lives in
      // the template. core does NOT block playback (soft gate).
      template.applyRestriction(params.is_restriction === 1);
      // cart-add-tier2-unify — VIDEO_OPEN carries `video_id`; track it as the template's
      // currentVideoId so addToCart threads it into CART_ADD_REQUEST.video_id (RN has no
      // ingestChannel). pure assignment (no notify / no pixel impact).
      template.setCurrentVideoId(
        typeof params.video_id === 'string' ? params.video_id : null,
      );
      break;
    default:
      // Every other event is the host's own listener's responsibility; the
      // template never double-processes them.
      break;
  }
}

/**
 * Attach a Default Player template to the unified bridge event channel.
 *
 * Call when the host mounts the player component. The returned handle's
 * `detach()` unsubscribes the unified listener — call it on unmount.
 */
export function attachPlayerTemplate(
  options: AttachPlayerTemplateOptions,
): PlayerTemplateAttachment {
  const template =
    options.template ??
    new DefaultPlayerTemplate({
      sdkConfig: options.sdkConfig,
      hostOptions: options.hostOptions ?? LivebuyUI.hostOptions,
      onDismiss: options.onDismiss,
      requestAwardClaim: options.requestAwardClaim,
      requestEventJoin: options.requestEventJoin,
      requestGuestNameEdit: options.requestGuestNameEdit,
      setAwaitGoods: options.setAwaitGoods,
      setNoticeGoods: options.setNoticeGoods,
      addToCartRequester: options.addToCartRequester,
      hostOwnsCart: options.hostOwnsCart,
      onOpenCart: options.onOpenCart,
      loadVideo: options.loadVideo,
      requestTogglePlayPause: options.requestTogglePlayPause,
      requestSeek: options.requestSeek,
      requestSeekBy: options.requestSeekBy,
    });

  // player-default-unmuted-template — seed the presentation mute flag = false
  // (unmuted / sound on by default), matching the core engines' default-unmuted main
  // playback (player-default-unmuted-core). momentState carries no `muted`; the host
  // (which owns the player ref + native setMuted) forwards subsequent flips via
  // `handleMutedChange`. Parity iOS TemplateAttachment.swift `template.handleMuted(false)`.
  // No-op for a freshly-built template given the new false default, but kept as the
  // explicit "attach = re-seed unmuted" contract so a reused `options.template`
  // (possibly left muted) is re-seeded unmuted on attach.
  template.handleMutedChange(false);

  const subscribe = options.registerListener ?? defaultRegisterListener;
  const unsubscribe = subscribe((event) => routeEvent(template, event));

  let detached = false;
  const attachment: PlayerTemplateAttachment = {
    template,
    subscribe(listener: ChangeListener): Unsubscribe {
      // §B — delegate to the template's emitter so both handles share one
      // subscription set (no duplicate dispatch).
      return template.subscribe(listener);
    },
    // expose-player-moment-state-template — host-wired moment forwarders.
    // momentState is NOT bridged; the host calls these (error `type` precedent).
    handleMomentSnapshot(snapshot): void {
      template.handleMomentSnapshot(snapshot);
    },
    handleMutedChange(muted: boolean): void {
      template.handleMutedChange(muted);
    },
    handleEndScreenCountdown(remain: number, active: boolean): void {
      template.handleEndScreenCountdown(remain, active);
    },
    handleAutoNextCancelled(): void {
      template.handleAutoNextCancelled();
    },
    // player-chrome-template — host-fed / host-wired chrome forwarders. Channel /
    // moment data is NOT on the unified channel (parity with notice-tab), so the
    // host forwards it here. Heart-burst is auto-driven from VIDEO_LIKE; this
    // forwarder lets a typed-source host drive it directly.
    handleRailEnablement(flags): void {
      template.handleRailEnablement(flags);
    },
    handleBagCount(count: number): void {
      template.handleBagCount(count);
    },
    handleLikePerformed(): void {
      template.handleLikePerformed();
    },
    handleHeaderChrome(fields): void {
      template.handleHeaderChrome(fields);
    },
    // swipe-navigate-rn-template — host-fed prev/next adjacent-video ids + the two
    // navigate forwarders (delegate to the injected `loadVideo`). Channel data is
    // NOT on the unified channel (parity with `handleHeaderChrome`), so the host
    // forwards the resolved ids here.
    handleNavTargets(targets): void {
      template.handleNavTargets(targets);
    },
    handleOtherGoods(otherGoods): void {
      template.handleOtherGoods(otherGoods);
    },
    navigateToPrev(): void {
      template.navigateToPrev();
    },
    navigateToNext(): void {
      template.navigateToNext();
    },
    handlePlaybackProgress(fields): void {
      template.handlePlaybackProgress(fields);
    },
    togglePlayPause(): void {
      template.togglePlayPause();
    },
    seek(seconds: number): void {
      template.seek(seconds);
    },
    seekBy(delta: number): void {
      template.seekBy(delta);
    },
    handleInfo(fields): void {
      template.handleInfo(fields);
    },
    selectInfoTab(tab: LBInfoPanelTab): void {
      template.selectInfoTab(tab);
    },
    // product-sheet-stack-template — sheet-stack intent forwarders. The unified
    // PRODUCT_CLICK is light (no full LBProduct), so the host forwards the full
    // product + diversion here (moment-state host-wired precedent); the add /
    // variant / qty / mini-cart / cart intents forward to the template.
    handleProductTap(product, diversion: number): void {
      template.handleProductTap(product, diversion);
    },
    selectVariant(groupIndex: number, optionIndex: number): void {
      template.selectVariant(groupIndex, optionIndex);
    },
    setQty(value: number): void {
      template.setQty(value);
    },
    incQty(): void {
      template.incQty();
    },
    decQty(): void {
      template.decQty();
    },
    addToCart(): Promise<void> {
      return template.addToCart();
    },
    dismissMiniCart(): void {
      template.dismissMiniCart();
    },
    openCart(): void {
      template.openCart();
    },
    setHostOwnsCart(owns: boolean): void {
      template.setHostOwnsCart(owns);
    },
    detach(): void {
      if (detached) return;
      detached = true;
      unsubscribe();
    },
  };
  // Let the host wire the player's typed moment sources in one place (D8).
  options.wireMoments?.(attachment);
  return attachment;
}

// MARK: - widget-content-template — Widget attach + host accessor (D7)
//
// Symmetric with `attachPlayerTemplate`. On iOS / Android the widget template
// binds the core `LivebuyWidget` instance directly (it reads `videos` / mode /
// pagination / liveVideo / isClosed and reacts to the widget's callbacks). On RN
// the JS template layer cannot hold the native widget, so — parity with the
// moment-state host-wired precedent — the HOST forwards the widget's typed
// content into the returned handle's `handleWidgetSnapshot` / `handleWidgetClose`
// and the bridge `LBWidgetResponse` root settings
// (`onWidgetResponse(LBWidgetSettings)` — colors bridged by
// `widget-bridge-color-core`, `productCard` by `widget-product-card-bridge-rn`)
// into `handleWidgetColors`. The accessor
// returns `undefined` when the template is not installed or the widget is not
// attached (NEVER throws), per the spec's "未安裝/未 attach 回空" contract.

/** Optional injection seam so unit tests can drive a fake widget template. */
export interface AttachWidgetTemplateOptions {
  sdkConfig: SDKConfig;
  hostOptions?: LBUIOptions | null;
  /** EXISTING card-tap → open Player passthrough (UNCHANGED). */
  onVideoTap?: (videoId: string) => void;
  /** Test seam: provide a prebuilt template instead of constructing one. */
  template?: DefaultWidgetTemplate;
  /**
   * widget-content-template — host seam to wire the widget's typed content
   * source. The widget content (videos / pagination / mode / isClosed) is NOT on
   * a unified channel on RN (design D7), so the host forwards the core widget's
   * snapshot + colors into the returned handle. This optional callback is invoked
   * once after the handle is built so the host registers those forwarders in one
   * place (parity with `attachPlayerTemplate`'s `wireMoments`).
   */
  wireWidget?: (attachment: WidgetTemplateAttachment) => void;
}

/**
 * Handle returned from {@link attachWidgetTemplate} — the public, documented
 * per-Widget accessor (widget-content-template, symmetric with
 * {@link PlayerTemplateAttachment}). The host obtains the Default widget template
 * for the Widget it just attached via {@link template} and reads its
 * host-bindable widget-content view-model ({@link DefaultWidgetTemplate.content}).
 */
export interface WidgetTemplateAttachment {
  /**
   * The Default widget template. READ surface ({@link
   * DefaultWidgetTemplate.content} + the EXISTING layout keys / `handleVideoTap`)
   * is the public host contract; the host consumes state and never feeds the
   * widget content directly (it uses the forwarders below).
   */
  readonly template: DefaultWidgetTemplate;
  /**
   * §B — register a coalesced "state changed" listener (no diff; re-read
   * {@link DefaultWidgetTemplate.content} on each call). Returns an idempotent
   * unsubscribe. Convenience delegate of {@link DefaultWidgetTemplate.subscribe};
   * subscribe either here or on `template` — both target the same emitter. Fired
   * on the JS thread, EXACTLY ONCE per single state change. Additive.
   */
  subscribe(listener: ChangeListener): Unsubscribe;
  /**
   * widget-content-template — host-forwarded core-widget snapshot (videos / mode
   * / pagination / liveVideo / isClosed). The widget content is host-wired on RN
   * (design D7), so the host forwards the core widget's typed content here. A
   * single snapshot fans into ONE coalesced notification.
   */
  handleWidgetSnapshot(snapshot: LBWidgetSnapshot): void;
  /**
   * widget-content-template / widget-product-card-content-template —
   * host-forwarded `/sdk/widget` response-root settings (the bridge
   * `LivebuyWidgetCore.onWidgetResponse(LBWidgetSettings)` callback: the
   * `widget-bridge-color-core` colors plus the `widget-product-card-bridge-rn`
   * `productCard`). RAW PASSTHROUGH — the template MUST NOT interpret. Missing
   * colors keep the core defaults (`widgetColor = 1` / `widgetBgcolor = null`);
   * a missing `productCard` is `null` and is NEVER defaulted to `'inside'`.
   *
   * Accepts `LBWidgetColors` widened with an OPTIONAL `productCard`, so both the
   * bridge's `LBWidgetSettings` and an existing colors-only call are legal.
   */
  handleWidgetColors(settings: LBWidgetSettingsInput): void;
  /**
   * widget-content-template — host-forwarded floating-widget close (the core
   * `LivebuyWidgetRef.simulateClose()` / `LivebuyFloatingWidgetRef.simulateClose()`
   * exit) → derives `mode == minimized` (D3).
   */
  handleWidgetClose(): void;
  /** Detach the widget accessor. Call on host unmount. Idempotent. */
  detach(): void;
}

/**
 * Live registry of attached widget templates so the static {@link
 * widgetTemplate} accessor can resolve "未安裝/未 attach 回空" (spec). Keyed by
 * the host-supplied widget key (RN has no native widget handle in JS; the host
 * passes a stable key — e.g. the `shopId` — symmetric with iOS keying by the
 * `LivebuyWidget` instance). An entry is removed on `detach()`.
 */
const attachedWidgets = new Map<string, WidgetTemplateAttachment>();

/**
 * Attach a Default widget template (widget-content-template). Returns the public
 * accessor handle; the host forwards the core widget's typed content + colors
 * into it (RN host-wired, design D7). `widgetKey` (e.g. the `shopId`) lets the
 * static {@link widgetTemplate} accessor resolve the instance later; pass the
 * same key the host uses for the `LivebuyWidget`. Call `detach()` on unmount.
 */
export function attachWidgetTemplate(
  options: AttachWidgetTemplateOptions & { widgetKey?: string },
): WidgetTemplateAttachment {
  const template =
    options.template ??
    new DefaultWidgetTemplate({
      sdkConfig: options.sdkConfig,
      hostOptions: options.hostOptions ?? LivebuyUI.hostOptions,
      onVideoTap: options.onVideoTap,
    });

  let detached = false;
  const attachment: WidgetTemplateAttachment = {
    template,
    subscribe(listener: ChangeListener): Unsubscribe {
      // §B — delegate to the template's emitter so both handles share one
      // subscription set (no duplicate dispatch).
      return template.subscribe(listener);
    },
    handleWidgetSnapshot(snapshot: LBWidgetSnapshot): void {
      template.handleWidgetSnapshot(snapshot);
    },
    handleWidgetColors(settings: LBWidgetSettingsInput): void {
      template.handleWidgetColors(settings);
    },
    handleWidgetClose(): void {
      template.handleWidgetClose();
    },
    detach(): void {
      if (detached) return;
      detached = true;
      if (options.widgetKey != null) attachedWidgets.delete(options.widgetKey);
    },
  };
  if (options.widgetKey != null) attachedWidgets.set(options.widgetKey, attachment);
  // Let the host wire the widget's typed content source in one place (D7).
  options.wireWidget?.(attachment);
  return attachment;
}

/**
 * Public accessor (symmetric with the iOS `LivebuyUI.widgetTemplate(for:)`):
 * given a widget key (the same key the host passed to {@link
 * attachWidgetTemplate}, e.g. the `shopId`), return its attached Default widget
 * template — or `undefined` when the template is not installed or that widget is
 * not attached. NEVER throws (spec "未安裝/未 attach 回空、不丟例外").
 */
export function widgetTemplate(widgetKey: string): DefaultWidgetTemplate | undefined {
  if (!LivebuyUI.isInstalled) return undefined;
  return attachedWidgets.get(widgetKey)?.template;
}
