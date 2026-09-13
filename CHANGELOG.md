# Changelog

All notable changes to `livebuy-react-native-ui` (distributed via this mirror repository) will be
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Distribution.** This package is served as a public git dependency
> (`git+https://github.com/ariesweng/livebuy-react-native-ui.git#v<ver>`). The published `<ver>`
> is read from this package's own `package.json` `version` field at release time; the channel
> itself is version-agnostic.

## [Unreleased]

## [1.8.0] - 2026-09-13

> **minor，零 BREAKING。** 自 `1.7.0` 以來累積 2 個內容 commit，跟進 core 層的加購登入閘與回放
> 聊天室主播身分判斷修復。

### Added

- **加購前本地攔截未登入使用者，template 收尾**（`rn-add-to-cart-login-gate-template`）：
  `DefaultTemplate.addToCart()` 新增本地檢查，重用既有 `addToCartNeedsLogin` 呈現路徑，parity
  iOS/Android。

### Fixed

- **`replayChatRow` 改 `kind` 優先判斷主播身分**（`fix-rn-comment-kind-wire-priority-template`），
  parity iOS/Android/Flutter。

## [1.7.0] - 2026-09-11

> **minor，非 BREAKING。** 自 `1.6.0` 以來累積 9 個內容 commit（另 5 個 sample/git-housekeeping/
> 被後續 commit 取代的中間態不列入），template 層補齊多項 channel 衍生欄位與缺口修復。

### Added

- **`attachPlayerTemplate` 新增 `queryIsMuted` host-wired 查詢選項**
  （`mute-preference-persist-across-session-rn-template`）：正確反映所包覆原生 Player 的實際
  持久化靜音狀態，取代先前恆為 unmuted 種子；省略時行為與改動前完全相同。
- **頻道載入當下立即轉發公告文字**（`rn-live-announce-immediate-display-template`），不必等待
  首輪 poll。
- **頻道載入時機補衍生 `chatEnabled`/`guestEditAvailable`**（`rn-rail-enablement-channel-derive-template`）。
- **`PlayerHeaderState` 暴露 `isFlashSale` 旗標**（`channel-flash-sale-flag-template-rn`），
  parity iOS/Android/Flutter。
- **加入活動列訊息改顯示自帶主播名稱**（`event-join-streamer-name-template-rn`）。
- **商品照片載入體驗優化**（`rb-rn-product-image-loading-polish`）：提早 prefetch + 淡入轉場 +
  佔位色改中性灰，parity iOS/Android/Flutter。

### Fixed

- **換片重置補上 `loadingCover`**（`rn-loadingcover-reset-on-video-switch-template`），避免殘留
  上一支影片封面。
- **換片切回已造訪影片時正確還原聊天/活動 feed 快取**（`chat-history-video-switch-cache-rn`），
  parity iOS/Android。
- **聊天訊息相鄰輪 poll resend 重複顯示修復**（`rn-chat-push-id-dedupe-template`），parity
  iOS/Android/Flutter。

## [1.6.0] - 2026-09-08

> **minor，非 BREAKING。** 自 `1.5.0` 以來累積 4 個 commit，template 層新欄位與缺口修復。

### Added

- **`loadingCover` 欄位 + `applyLoadingCover` host-fed setter**（`player-loading-cover-
  background-template-rn`）——channel 封面圖的 view-model 層落地，parity 既有 `applyRestriction`
  形狀（本輪 reference-ui 套件同步接線出像素，見 `livebuy-react-native-reference-ui` CHANGELOG）。

### Fixed

- **補推導 `guestEditAvailable`**（`guest-edit-available-poll-derive-template-rn`）——poll 訊息
  的訪客可編輯狀態旗標此前恆為 `false`，現正確從輪詢回應推導。
- **上下滑手勢切換相鄰影片修復**（`rn-swipe-nav-wiring-template`）——`TemplateAttachment` 此前
  未接線 `handleNavTargets`，導致上下滑動完全無法切換到相鄰影片；現已修復。
- **商品清單置頂邏輯排除純 VOD**（`rn-vod-product-list-introducing-order-exclude-vod-template`）
  ——「介紹中商品置頂」邏輯此前誤套用到純點播（非直播回放）情境，現已排除，parity iOS。

## [1.5.0] - 2026-09-07

> **minor，非 BREAKING。** 自 `1.4.1` 以來累積 1 個 commit，template 層新行為。

### Added

- **VOD/回放時介紹中商品置頂到最前**（`rn-vod-product-list-introducing-order-template`）——
  商品列表 sheet 在回放/VOD 情境下，介紹中商品自動排到最前面，parity Android/iOS/Flutter。

## [1.4.1] - 2026-09-04

> **Patch，含 1 項新增 optional method（additive、非 BREAKING）。** 同一輪 xsmartlive 回報的
> template 層對應修復——見 `livebuy-react-native-reference-ui@1.4.2` 的完整脈絡。

### Added

- **`attachPlayerTemplate()` 回傳的 `PlayerTemplateAttachment` 新增公開方法
  `handleEvent(event: LBSdkEvent): void`**（additive）——把傳入的原始 SDK 事件轉發進這個
  attachment 的內部事件路由，與其自己經 core `registerListener` 收到同一份事件時的處理完全
  等價。僅加在 `PlayerTemplateAttachment`，`WidgetTemplateAttachment` 不提供對應方法（其內容
  經 host-fed typed 方法灌入，不經統一事件通道）。呼叫端 MUST 保證同一事件對同一 attachment
  恰好送達一次（見套件內 doc-comment）。

## [1.4.0] - 2026-09-03

> 這是 `livebuy-react-native-ui`（template / view-model 層）套件自其 `1.3.0` 首次真實發版以來
> 累積的內容。**無 BREAKING**，純新增。

### Added

- **曝露完整進行中活動清單＋分頁索引（`DefaultTemplate`）** — 反轉舊版「只取第一筆活動」決策，
  供 reference-ui 消費繪製分頁 UI（見 `livebuy-react-native-reference-ui@1.4.0`）。
- **活動入口切換影片立即隱藏＋換片還原快取** — 換片時活動入口立即隱藏，換回原片時從快取還原
  顯示狀態。

## [1.3.0] - 2026-09-01

### Added

First real release of the `livebuy-react-native-ui` mirror repository. Default template
(view-model) layer for the Livebuy React Native SDK — zero-pixel state/behavior logic that binds
`livebuy-react-native`'s headless core to a pixel-rendering layer (see
`livebuy-react-native-reference-ui` for Livebuy's own drop-in pixel implementation, or bring your
own).
