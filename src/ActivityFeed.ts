import type { LBWinner } from 'livebuy-react-native';

// reconcile-activity-notification-contract-template §1 — merged activity+chat
// feed (behaviour / view-model layer; NO pixels). The Default template merges
// core activity events (showJoin / showPurchase / showWin) and chat messages
// (push + comments) into ONE ordered feed model (newest at tail) that the host
// binds to draw `LBLiveChatStream` (per design/templates/minimal/moments.jsx).
//
// Parity invariants (four-platform shared semantics):
//   - DATA-LAYER merge ONLY. The feed is a SEPARATE model; it never double-
//     writes activity events back into the ChatView chat data source.
//   - Each item keeps a single pre-i18n `text: String` — NEVER split into
//     userName + goodsName (cross-locale split is not reliable).
//   - Tail-retain constant N = 7, a shared Default-template constant across all
//     four platforms (taken from moments.jsx `items.slice(-7)`), NOT per-
//     platform. Stay / fade-out durations are host pixels, not template state.

/**
 * Visual-tier marker carried by every activity feed item. Four ascending levels
 * of emphasis (join < purchase < intro < win) so the host can pick a stronger
 * style. Numeric values encode the ordering for parity with iOS/Android enums
 * (iOS rawValue join=0 / purchase=1 / intro=2 / win=3). `Intro`（商品開始介紹）來源
 * 為商品推播 push（`#66F796`），強調介於購買與中獎之間。
 */
export enum ActivityTier {
  Join = 0,
  Purchase = 1,
  Intro = 2,
  Win = 3,
  /**
   * 觀眾選購（chat-message-taxonomy ⑤，來源 `kind == narrate` / `#66F796`）——與 `Join` 同級的
   * 最低調社會認同（非主播訊息、非購買、非介紹中）。append（不重排既有值，故 = 4）；語意上仍最低調。
   */
  Browse = 4,
}

/**
 * Shared Default-template tail-retain count (OQ1 parity). The merged feed keeps
 * only the newest N items; the host renders them. ONE constant across all four
 * platforms — do NOT override per-platform.
 */
export const DEFAULT_FEED_TAIL_RETAIN = 7;

/**
 * @deprecated RN 已改採「聊天與活動列各自獨立保留」（chat-activity-separate-retention-rn-template，
 * parity iOS `b2a835c4` / Android `f13c427c`）。單一共用總 cap 不再作為 trim 依據——請改用
 * {@link DEFAULT_FEED_CHAT_RETAIN}（聊天列上限）與 {@link DEFAULT_FEED_ACTIVITY_RETAIN}（活動列上限）。
 * 本常數保留其值（500）以維持源碼相容（下游若曾讀取不致 break），但 {@link MergedActivityFeed} 已不使用它。
 *
 * （歷史說明）此曾是 chat 列與 activity 列（join / purchase / browse / win）**共用**的單一 FIFO cap：
 * `appendChat` 與 `appendActivity` / `appendIntro` / `appendNarrate` 皆走同一 {@link MergedActivityFeed.push}
 * → 一個共用 FIFO 窗口。太小的 cap 會讓活動爆量時大量 activity 列擠出較舊的 CHAT 列（即使聊天很少，
 * user-reported「聊天很少卻慢慢不見」）。放大 50→500 只是延後症狀；分離保留才根治——真正的聊天列永不被
 * 活動列擠出。
 */
export const DEFAULT_FEED_HISTORY_RETAIN = 500;

/**
 * 聊天列（`kind === 'chat'`：觀眾留言 / 主播留言 / 主播回覆 / AI 回覆，並含 `appendSystemNotice` 系統通知）
 * 自身的保留上限。與活動列的 {@link DEFAULT_FEED_ACTIVITY_RETAIN} **各自獨立**——超過此上限時只汰最舊的
 * **chat 列**，故**真正的聊天列永不被活動列擠出**（聊天只會被更新的聊天擠出）。沿用先前整體 500 → chat
 * 保護只會比舊「共用 cap」模型更好（chat 單獨也能留滿 500、且不再被 activity 稀釋）。
 *
 * 此常數四端各自維護一份（iOS `DefaultTemplateConstants.activityFeedChatRetain` / Android
 * `DefaultFeedConstants.CHAT_RETAIN` / RN here / Flutter follow-up）；RN = 500 對齊 iOS / Android。
 */
export const DEFAULT_FEED_CHAT_RETAIN = 500;

/**
 * 活動列（activity 桶：`kind === 'activity'`（join / purchase / browse / intro / win）/ `'eventJoin'` /
 * `'productSale'`）的保留上限。與聊天列的 {@link DEFAULT_FEED_CHAT_RETAIN} **各自獨立**——超過此上限時只
 * 汰最舊的 **非 chat 列**，不動 chat 桶。取 200：活動列是氛圍社會認同，可捲動回看 200 筆已足夠脈絡（氛圍
 * 浮層本只顯示 newest {@link DEFAULT_FEED_TAIL_RETAIN}=7），且遠大於 {@link DEFAULT_FEED_DEDUP_WINDOW}=64。
 * 合流 feed 記憶體上界 = {@link DEFAULT_FEED_CHAT_RETAIN} + {@link DEFAULT_FEED_ACTIVITY_RETAIN} = 700 個
 * 輕量 {@link FeedItem}。
 *
 * 四端各自維護一份（iOS `activityFeedActivityRetain` / Android `ACTIVITY_RETAIN` / RN here / Flutter
 * follow-up）；RN = 200 對齊 iOS / Android。
 */
export const DEFAULT_FEED_ACTIVITY_RETAIN = 200;

/**
 * Recent-seen signature window for de-duplicating ACTIVITY / EVENT-JOIN rows (chat
 * is never deduped). Bounded so a re-sent poll item (no stable id) is not appended
 * twice across several poll cycles. ONE constant across all four platforms.
 */
export const DEFAULT_FEED_DEDUP_WINDOW = 64;

/**
 * Backend "product push" message color (spec §PollManager fan-out). A poll `push[]` row carrying
 * this `color` is a 商品推播 / 開賣 notification that only surfaces in the chat feed. Used to route
 * such system notices through the DE-DUPED chat path so an adjacent-poll re-send isn't shown twice
 * (free user chat stays un-deduped). ONE constant across all four platforms.
 */
export const PRODUCT_PUSH_COLOR = '#66F796';

/** An activity row in the merged feed (join / purchase / win). */
export interface ActivityFeedItem {
  readonly kind: 'activity';
  readonly tier: ActivityTier;
  /** Backend pre-composed, already-i18n'd string. Never split into fields. */
  readonly text: string;
  /** Present only for win-tier items (the unclaimed entry is independent). */
  readonly winner?: LBWinner;
}

/** A chat row in the merged feed (push / comments). */
export interface ChatFeedItem {
  readonly kind: 'chat';
  readonly text: string;
  /**
   * The chat author's nickname (chat-nickname-display, parity iOS `LBFeedItem.userName`).
   * Present ONLY for chat rows that carried a usable author name (blank → normalized to
   * `undefined` by {@link MergedActivityFeed.appendChat}). System / activity rows NEVER
   * carry it. Event-join rows carry their OWN, independently-defined `userName` field
   * (see {@link EventJoinFeedItem.userName}, same normalization rule) — NOT this one.
   * `undefined` → reference-ui renders a text-only row (byte-identical to the
   * pre-nickname layout).
   */
  readonly userName?: string;
  // chat-message-taxonomy ⑤ — 群組① 真正的聊天的角色 metadata（parity iOS `LBFeedItem`）。
  /**
   * 主播留言 / 主播回覆（`kind == host` / `host_reply` / `ai_reply`）。`false` for viewer
   * (`comment`) messages. 供 reference-ui 依**版型**畫「主播」標 + accent 氣泡（非以顏色區分）。
   * 預設 `false` 使既有觀眾列 byte-identical。
   */
  readonly isHost?: boolean;
  /** AI 自動回覆（`kind == ai_reply`）。`true` 在主播回覆版型上加「AI」標。預設 `false`。 */
  readonly isAI?: boolean;
  /**
   * 主播回覆 / AI 回覆的**被回覆引用內容**（backend `LBPushMsg.reply`），為獨立字串（NOT split
   * from `text`）。`undefined` → 無引用框。後端無「引用者名稱」欄，故只帶引用文字。預設 `undefined`。
   */
  readonly replyText?: string;
}

/**
 * An event-join row in the merged feed (core event-begin push). Host draws the
 * `moments.jsx` `LBEventJoinLine` (CTA「加入活動」) bound to {@link eid} /
 * {@link keyword} / {@link joined}. Surfaced ONLY for event-begin; event-end
 * stays a plain {@link ChatFeedItem}. {@link joined} is template-OPTIMISTIC —
 * false on surface, flipped to true once the host triggers the join intent
 * (core has NO "join succeeded" callback).
 */
export interface EventJoinFeedItem {
  readonly kind: 'eventJoin';
  readonly eid: number;
  readonly keyword: string;
  readonly text: string;
  readonly joined: boolean;
  /**
   * event-join-streamer-name-template-rn (bug fix): the author name carried by THIS
   * push message itself (source `push.name`), i.e. the streamer who triggered this
   * particular event-begin announcement. Present only when the message carried a
   * usable name (blank → normalized to `undefined` by
   * {@link MergedActivityFeed.appendEventJoin}, same rule as {@link ChatFeedItem.userName}).
   * **NOT** the channel-level, whole-session `hostName` (= `channel.shop.name`, the
   * shop's name) used by `PlayerHeaderState` — MUST NOT be confused with or fall back
   * to it. Whether/how to render a missing value is a reference-ui layout decision.
   */
  readonly userName?: string;
}

/**
 * 商品開賣卡列（chat-message-taxonomy ⑤ 群組① onsale）。{@link name} = 商品名（`push.text`）、
 * {@link price} = 已格式化開賣價（**`push.price`**，權威輸出欄，非上游 `p`）。reference-ui 渲染
 * `moments.jsx` `LBProductSaleCard`（縮圖 + 開賣中徽章 + 名 + 現價 + 搶購鈕）。Parity iOS
 * `LBFeedItem.Kind.productSale` + `price` / Android `FeedItem.ProductSale`.
 */
export interface ProductSaleFeedItem {
  readonly kind: 'productSale';
  /** 商品名（`push.text`）。沿用共用 `text` 欄（parity iOS `LBFeedItem.text`），使既有讀 `item.text` 不破。 */
  readonly text: string;
  readonly price: string;
}

export type FeedItem = ActivityFeedItem | ChatFeedItem | EventJoinFeedItem | ProductSaleFeedItem;

/**
 * 依型別各自獨立保留（separate retention）純函式：在同一個合流時間序陣列上，把 chat 列與 activity 列
 * **各自**裁到其上限，兩者互不影響。O(n)、保序（存活者維持原 chronological 交錯順序、newest 於尾端）。
 *
 * - **chat 桶** = `kind === 'chat'`（觀眾留言 / 主播留言 / 主播回覆 / AI 回覆 + `appendSystemNotice`
 *   系統通知，與 iOS `.chat` / Android `FeedItem.Chat` 語意一致），上限 `chatCap`
 *   （{@link DEFAULT_FEED_CHAT_RETAIN}）。
 * - **activity 桶** = 其餘全部（`'activity'`（join / purchase / browse / intro / win）/ `'eventJoin'` /
 *   `'productSale'`），上限 `activityCap`（{@link DEFAULT_FEED_ACTIVITY_RETAIN}）。
 *
 * 各型別各自丟「最舊」超額的那幾筆（由頭往尾走、遇該型別且尚有配額要丟就跳過），其餘保留。因兩桶各自獨立，
 * **真正的聊天列永不被活動列擠出**（聊天只會被更新的聊天擠出）。fast-path：兩桶皆在 cap 內時原封返回
 * （複製新陣列，不改任何列）。Parity iOS `DefaultActivityFeed.trimmedByType(_:chatCap:activityCap:)` /
 * Android `ActivityFeedModel.trimmedByType`.
 */
export function trimmedByType(
  items: readonly FeedItem[],
  chatCap: number,
  activityCap: number,
): FeedItem[] {
  let chatCount = 0;
  let activityCount = 0;
  for (const it of items) {
    if (it.kind === 'chat') chatCount++;
    else activityCount++;
  }
  let chatToDrop = Math.max(0, chatCount - chatCap);
  let activityToDrop = Math.max(0, activityCount - activityCap);
  if (chatToDrop === 0 && activityToDrop === 0) return items.slice(); // fast path — 皆在 cap 內、無 trim
  const out: FeedItem[] = [];
  for (const it of items) {
    if (it.kind === 'chat') {
      if (chatToDrop > 0) {
        chatToDrop--;
        continue; // 由頭往尾走 → 丟掉的必為最舊的 chat 列
      }
    } else {
      if (activityToDrop > 0) {
        activityToDrop--;
        continue; // 丟掉的必為最舊的 activity 列（非 chat）
      }
    }
    out.push(it);
  }
  return out;
}

/**
 * Ordered merged feed of activity + chat rows (newest at tail), tail-retained
 * to {@link DEFAULT_FEED_TAIL_RETAIN}. Pure data model — holds no pixels.
 *
 * The host reads {@link items} (oldest→newest) to draw the stream. Activity
 * rows are NOT written into the ChatView chat data source — this model is the
 * single merge point (data-layer merge only).
 */
export class MergedActivityFeed {
  // The deep scrollable history buffer, oldest→newest. The reference-ui SCROLLABLE
  // chat feed binds `history` so the user can scroll up to view recent history.
  // Trimmed by SEPARATE per-type retention (chat rows to `chatRetain`, activity rows
  // to `activityRetain`, independently) so real chat rows are NEVER evicted by an
  // activity flood — see {@link trimmedByType}.
  private readonly buffer: FeedItem[] = [];
  private readonly tailRetain: number;
  private readonly chatRetain: number;
  private readonly activityRetain: number;
  private readonly dedupeWindow: number;
  // Bounded recent-seen signatures for ACTIVITY / EVENT-JOIN rows so a backend
  // re-send on an adjacent poll (no stable id) is not appended twice. Chat rows
  // are NEVER recorded / deduped (identical chat text from two users is legitimate).
  private readonly recentSignatures: string[] = [];

  constructor(
    tailRetain: number = DEFAULT_FEED_TAIL_RETAIN,
    chatRetain: number = DEFAULT_FEED_CHAT_RETAIN,
    activityRetain: number = DEFAULT_FEED_ACTIVITY_RETAIN,
    dedupeWindow: number = DEFAULT_FEED_DEDUP_WINDOW,
  ) {
    this.tailRetain = tailRetain > 0 ? tailRetain : DEFAULT_FEED_TAIL_RETAIN;
    const chat = chatRetain > 0 ? chatRetain : DEFAULT_FEED_CHAT_RETAIN;
    // chat cap ≥ tailRetain so `items` (newest N=7) is always derivable even from an all-chat history.
    this.chatRetain = Math.max(this.tailRetain, chat);
    this.activityRetain = activityRetain > 0 ? activityRetain : DEFAULT_FEED_ACTIVITY_RETAIN;
    this.dedupeWindow = dedupeWindow > 0 ? dedupeWindow : DEFAULT_FEED_DEDUP_WINDOW;
  }

  /** Append an activity row (join / purchase / intro / win) carrying a tier marker. */
  appendActivity(tier: ActivityTier, text: string, winner?: LBWinner): void {
    this.push({ kind: 'activity', tier, text, winner });
  }

  /**
   * 商品推播（`push[]` 帶商品推播色 `#66F796`，例如「商品開賣 / 開始介紹」）→ feed
   * activity row, tier = intro（強調介於購買與中獎之間）。商品推播 push 無 stable id，
   * 故與 join / purchase 同樣走 activity 去重（簽名涵蓋 tier）。Routed here by
   * `DefaultPlayerTemplate.handlePush` for product-push (`#66F796`) rows.
   */
  appendIntro(text: string): void {
    this.push({ kind: 'activity', tier: ActivityTier.Intro, text });
  }

  /**
   * 觀眾選購（chat-message-taxonomy ⑤ `kind == narrate`，`#66F796`）→ feed 社會認同 activity
   * row（「{觀眾名} 正在選購商品～」），以低調 `Browse` tier（與 `Join` 同級）呈現。**性質同
   * join / purchase、非主播訊息、非介紹中**（介紹中改由 goods `is_narrating` 在商品列呈現）。push
   * 無 stable id → 走 activity 去重（簽名涵蓋 tier + text）。parity iOS `appendNarrate`。
   */
  appendNarrate(text: string): void {
    this.push({ kind: 'activity', tier: ActivityTier.Browse, text });
  }

  /**
   * Append a chat row (push / comments). `name` is the author nickname
   * (chat-nickname-display): a blank / whitespace-only name normalizes to `undefined`
   * (the chat row renders text-only, byte-identical to the pre-nickname layout). Only
   * ordinary user chat carries a name — system / activity rows never do. `isHost` /
   * `replyText` / `isAI` 為**群組① 真正的聊天**的角色 metadata（chat-message-taxonomy ⑤），供
   * reference-ui 依版型區分主播留言 / 主播回覆 / AI 回覆；皆帶預設值，使既有觀眾留言
   * (`comment`) 呼叫點 byte-identical。`replyText` blank → `undefined`（無引用框）。Parity iOS
   * `appendChat(text:name:isHost:replyText:isAI:)`.
   */
  appendChat(
    text: string,
    name?: string,
    isHost = false,
    replyText?: string,
    isAI = false,
  ): void {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    const userName = trimmed.length > 0 ? trimmed : undefined;
    const trimmedReply = typeof replyText === 'string' ? replyText.trim() : '';
    const reply = trimmedReply.length > 0 ? trimmedReply : undefined;
    this.push({ kind: 'chat', text, userName, isHost, isAI, replyText: reply });
  }

  /**
   * A SYSTEM / 商品推播 notice (e.g.「商品開賣」) surfaced as a chat row. chat-history-dedupe: **NO
   * content-fingerprint dedup** — 後台「推廣活動」會刻意重送相同內容的真實系統通知，`cs|<text>` 內容去重會
   * 把這些真實重送誤殺。相鄰輪重送的防重複改由 `TemplateAttachment` 的 cursor-based backlog 分流承擔。
   */
  appendSystemNotice(text: string): void {
    this.push({ kind: 'chat', text });
  }

  /**
   * Surface a core event-begin push as an INDEPENDENT event-join row (host
   * draws `LBEventJoinLine`). `joined` starts false. event-END pushes MUST NOT
   * reach here — they stay plain chat rows (see `DefaultPlayerTemplate.handlePush`).
   * `name` (event-join-streamer-name-template-rn) is THIS message's own author name
   * (`push.name`) — normalized identically to {@link appendChat}'s `userName` (trim,
   * blank → `undefined`) — and is NOT the channel-level `hostName`.
   */
  appendEventJoin(eid: number, keyword: string, text = '', name?: string): void {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    const userName = trimmed.length > 0 ? trimmed : undefined;
    this.push({ kind: 'eventJoin', eid, keyword, text, joined: false, userName });
  }

  /**
   * Template-optimistic join mark: flip every still-unjoined event-join row for
   * {@link eid} to `joined = true`. Returns whether anything changed (so the
   * caller can coalesce a single change notification). Public so a host that
   * takes over `eventJoinIntent` can set the flag via this hook (design D2).
   */
  markJoined(eid: number): boolean {
    let changed = false;
    for (let i = 0; i < this.buffer.length; i++) {
      const it = this.buffer[i];
      if (it && it.kind === 'eventJoin' && it.eid === eid && !it.joined) {
        this.buffer[i] = { ...it, joined: true };
        changed = true;
      }
    }
    return changed;
  }

  /** Ambient slice — the newest {@link tailRetain} (N=7) items, oldest→newest. */
  get items(): readonly FeedItem[] {
    return this.buffer.slice(-this.tailRetain);
  }

  /**
   * Full scrollable history buffer (oldest→newest) — bound by the SCROLLABLE
   * reference-ui chat feed so the user can scroll up to view history. Trimmed by
   * SEPARATE per-type retention (chat rows to `chatRetain`, activity rows to
   * `activityRetain`, independently — see {@link trimmedByType}), so chat rows are
   * never evicted by an activity flood.
   */
  get history(): readonly FeedItem[] {
    return this.buffer.slice();
  }

  /** Number of items in the ambient slice (N=7 contract; ≤ tailRetain). */
  get count(): number {
    return Math.min(this.buffer.length, this.tailRetain);
  }

  /**
   * Remove the whole feed history (additive; parity with native `clear()`). Also
   * resets the de-dup window so a new session can re-show same-text activity.
   */
  clear(): void {
    this.buffer.length = 0;
    this.recentSignatures.length = 0;
  }

  /**
   * chat-history-video-switch-cache-rn — replace the whole feed history with a
   * previously-saved snapshot (see `VideoFeedSnapshotCache`), restoring an in-place
   * switch BACK to an already-visited video instead of leaving it empty until the
   * next poll. Applies the SAME per-type retention trim as {@link push} ({@link
   * trimmedByType}) so a restored snapshot never exceeds the current chat/activity
   * caps. Also resets the de-dup signature window (parity {@link clear}) — restored
   * rows are already fully-processed history, not fresh incoming pushes, so there is
   * nothing to dedupe against; new pushes after a restore start deduping fresh, same
   * as after any `clear()`. Parity archived iOS `DefaultActivityFeed.restore(_:)`.
   */
  restore(items: readonly FeedItem[]): void {
    const trimmed = trimmedByType(items, this.chatRetain, this.activityRetain);
    this.buffer.splice(0, this.buffer.length, ...trimmed);
    this.recentSignatures.length = 0;
  }

  private push(item: FeedItem, dedupeKey: string | null = null): void {
    // Defensive de-dup for ACTIVITY / EVENT-JOIN rows (and SYSTEM-notice chat rows that pass an
    // explicit `dedupeKey`): a re-sent poll item would otherwise show the same join / system
    // notice twice. An ORDINARY chat row has no key (dedupeSignature === null) → never deduped.
    const signature = dedupeKey ?? dedupeSignature(item);
    if (signature !== null) {
      if (this.recentSignatures.includes(signature)) return;
      this.recentSignatures.push(signature);
      if (this.recentSignatures.length > this.dedupeWindow) {
        this.recentSignatures.splice(0, this.recentSignatures.length - this.dedupeWindow);
      }
    }
    this.buffer.push(item);
    // Separate retention (chat-activity-separate-retention): trim chat rows and
    // activity rows to their OWN caps INDEPENDENTLY (see {@link trimmedByType}) so a
    // real chat row is NEVER evicted by an activity flood. This is RN's ONLY trim
    // site — the backlog gate (`DefaultPlayerTemplate.shouldIngestPoll`) only decides
    // whether a poll round is ingested; every ingested row funnels through here.
    const trimmed = trimmedByType(this.buffer, this.chatRetain, this.activityRetain);
    if (trimmed.length !== this.buffer.length) {
      // Rebuild in place to keep the same `buffer` reference (items / history getters).
      this.buffer.splice(0, this.buffer.length, ...trimmed);
    }
  }
}

/**
 * De-dup signature for a feed row. **所有 kind 現在皆回 null（不做內容指紋去重）**：`chat` 一向 null
 * （兩人同字合法）；`activity` / `productSale` 於 chat-history-dedupe 移除；`eventJoin` 於
 * chat-event-message-no-dedupe-template 移除（活動公告會被直播主刻意重播，每筆都顯示——`e<eid>|<text>`
 * 內容指紋去重會誤殺真實重播）。機制性 backlog 重放的防重複改由 `TemplateAttachment` 的 cursor-based
 * backlog 分流承擔（含原生 PollManager 的跨重入 cursor 保存）。Mirrors iOS `dedupeSignature(for:)`.
 */
function dedupeSignature(item: FeedItem): string | null {
  switch (item.kind) {
    case 'chat':
      return null;
    case 'activity':
      return null;
    case 'eventJoin':
      return null;
    case 'productSale':
      return null;
    default:
      return null;
  }
}
