export { LivebuyUI } from './LivebuyUI';
export type { LBUIOptions } from './LBUIOptions';
export { ConfigMerger } from './ConfigMerger';
export {
  DefaultTemplate,
  DefaultPlayerTemplate,
  DefaultOperationPanel,
  DefaultWidgetTemplate,
  LBWidgetContentMode,
  EffectiveConfig,
  isAddToCartAuthRequired,
  isAddToCartDeduplicated,
} from './DefaultTemplate';
// chat-message-taxonomy ⑤ — 置頂留言 view-model 型別（reference-ui 渲染置頂橫幅消費）。
export type { PinnedMessage } from './DefaultTemplate';
export { attachPlayerTemplate, attachWidgetTemplate, widgetTemplate } from './TemplateAttachment';
export type {
  AttachPlayerTemplateOptions,
  PlayerTemplateAttachment,
  AttachWidgetTemplateOptions,
  WidgetTemplateAttachment,
} from './TemplateAttachment';

// widget-content-template / widget-product-card-content-template — Default
// widget-content host-bindable view-model (videos / mode / currentPage /
// lastPage / liveVideo / widgetColor / widgetBgcolor / productCard) mirroring
// core `LivebuyWidget` + `widget-bridge-color-core` + `widget-product-card-bridge-rn`.
export { DefaultWidgetContent, widgetContentMode, decodeWidgetSnapshot } from './WidgetContent';
export type {
  LBWidgetContent,
  LBWidgetSnapshot,
  LBWidgetCoreMode,
  LBWidgetSettingsInput,
} from './WidgetContent';

// expose-default-template-bindable-state §B — coalesced change-notification
// listener / unsubscribe types (host registers via PlayerTemplateAttachment
// .subscribe / DefaultPlayerTemplate.subscribe).
export type { ChangeListener, Unsubscribe } from './ChangeEmitter';

// reconcile-activity-notification-contract-template §1 — merged activity+chat feed
export {
  ActivityTier,
  MergedActivityFeed,
  DEFAULT_FEED_TAIL_RETAIN,
} from './ActivityFeed';
export type {
  ActivityFeedItem,
  ChatFeedItem,
  EventJoinFeedItem,
  FeedItem,
} from './ActivityFeed';

// livebuy-ui-event-join-and-error-state-template — Player error-state exposure
export {
  PlayerErrorKind,
  PlayerErrorPhase,
  PlayerErrorStateModel,
  errorKindFromType,
} from './ErrorState';
export type { PlayerErrorState } from './ErrorState';

// expose-player-moment-state-template — five host-bindable player moment view-models
export {
  StartScreenPhase,
  DefaultStartScreenState,
  DefaultEndScreenState,
  DefaultProductOverlayState,
  DefaultPlayerHeaderState,
  DefaultSubtitleState,
  // rn-vod-playback-progress-template — VOD-2 playback-progress view-model
  // class (was previously reachable only via `DefaultPlayerTemplate
  // .playbackProgressState`'s getter, not as a re-exported constructor).
  DefaultPlaybackProgressState,
} from './MomentState';
export type {
  StartScreenState,
  EndScreenState,
  ProductOverlayState,
  PlayerHeaderState,
  SubtitleState,
  EndScreenCountdown,
  EndScreenNavRow,
  EndScreenHotRow,
  // rn-vod-playback-progress-template — the shape backing
  // `DefaultPlayerTemplate.playbackProgressState`, for reference-ui binding.
  PlaybackProgressState,
} from './MomentState';

// upcoming-intro-template-rn — Upcoming (直播預告 awaiting-live) host-bindable
// view-model + the pure `publishAtInFuture` helper (UTC+8). Fed via
// `DefaultPlayerTemplate.handleUpcoming` (host forwards the core bridge's
// `LBPlayerChannelInfo` from `onChannelChange`). Parity iOS / Android / Flutter.
export {
  DefaultUpcomingState,
  publishAtInFuture,
  isUpcomingChannel,
  isFinishedLiveReplay,
} from './MomentState';
export type { UpcomingState } from './MomentState';

// auth-gate-template-state — auth-gate + identity-label host-bindable view-models
export {
  LBAuthTriggerAction,
  DefaultAuthGate,
  DefaultIdentityLabel,
  triggerActionFromString,
} from './AuthGate';
export type { LBAuthGateState, LBIdentityLabel } from './AuthGate';

// await-toggle-and-notice-tab-template-state — goods-tracking dual switch +
// notice-tab open-state host-bindable view-models
export { DefaultGoodsTracking } from './GoodsTracking';
export type { LBGoodsTrackingFlags, GoodsTrackingSetter } from './GoodsTracking';
export { DefaultNoticeTab } from './NoticeTab';
export type { LBNoticeTabState } from './NoticeTab';

// player-chrome-template — OperationPanel side-rail + VideoInfoPanel info-tab
// host-bindable view-models (PlayerHeader top-bar chrome補欄 folds into the
// existing PlayerHeaderState in MomentState.ts).
export { LBSideRailKind, DefaultOperationRail } from './OperationRail';
export type { LBSideRailItem, LBSideRailEnablement } from './OperationRail';
export { LBInfoPanelTab, DefaultInfoTab } from './InfoTab';
export type { LBInfoTabState } from './InfoTab';

// swipe-navigate-rn-template — read-only prev/next adjacent-video navigation
// host-bindable view-model (channel-derived, host-fed via handleNavTargets).
export { DefaultPlayerNavigation } from './PlayerNavigation';
export type { LBPlayerNavigationState } from './PlayerNavigation';

// product-sheet-stack-template — 商品 sheet-stack host-bindable view-models
// (product-detail / variant-picker / qty-stepper / mini-cart / cart CTA) +
// route-B add-to-cart requester delegate.
export {
  DefaultProductSheet,
  DefaultVariantPicker,
  DefaultQtyStepper,
  DefaultMiniCart,
  DefaultCartCTA,
  resolveSelectedSpec,
  recommendationsFromOtherGoods,
} from './ProductSheet';
export type {
  LBProductDetailState,
  LBProductRecommendation,
  LBVariantGroup,
  LBVariantState,
  LBQtyState,
  LBMiniCartPeek,
  LBCartCTAState,
  CartAddRequest,
  CartAddRequester,
} from './ProductSheet';

// reconcile-activity-notification-contract-template §2 / §3 / §4 — win claim flow
export {
  AwardClaimClassification,
  AwardClaimOutcome,
  UnclaimedWinSet,
  classifyAward,
  // win-claim-email-submit-rn-template — 領獎 email 前端驗證純函式（reference-ui 每個
  // keystroke 用它決定 CTA disabled）。class static 同名入口為 `DefaultPlayerTemplate.isValidEmail`。
  isValidClaimEmail,
  mapAwardClaimResult,
} from './AwardClaimFlow';
export type {
  AwardClaimResultState,
  // win-claim-email-submit-rn-template — 帶 contact 的領獎注入 seam。`RequestAwardClaim`
  // （無 contact）為 DEPRECATED 保留，下一個 major 移除。
  RequestAwardClaimWithContact,
  RequestAwardClaim,
} from './AwardClaimFlow';
