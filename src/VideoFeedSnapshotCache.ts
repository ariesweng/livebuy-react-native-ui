import type { FeedItem } from './ActivityFeed';

// chat-history-video-switch-cache-rn — instance-level bounded LRU cache of a video's
// chat/activity merged feed history + push-id dedupe set, keyed by videoId.
//
// Spec: `ui-template-foundation/spec.md`
//   § "Default Template（RN）換片聊天/活動 feed 快取與還原"
// Design: openspec/changes/chat-history-video-switch-cache-rn/design.md
//
// Ports the archived iOS `VideoFeedSnapshotCache`
// (`ios/Sources/LivebuyUI/Templates/Default/VideoFeedSnapshotCache.swift`,
// `chat-history-video-switch-cache-template`), but kept INSTANCE-scoped (a plain field
// on ONE `DefaultPlayerTemplate`, not a process-level singleton like iOS's
// `static let shared`) — RN's existing per-videoId cache (`DefaultTemplate`'s
// `activityByVideoId`, `activity-entry-video-switch-cache-and-hide-rn`) is
// instance-scoped, and this cache follows the same architectural convention rather
// than introducing a new one-off shape. RN has a single-threaded event loop (like
// Dart), so no lock is needed (unlike the iOS version's `NSLock`).

/**
 * One saved snapshot: the feed's `history` at the moment the user switched away, PLUS
 * the push-id de-dup set (`rn-chat-push-id-dedupe-template`) at that same moment —
 * saved and restored TOGETHER as one atomic unit so restoring history can never reopen
 * a duplicate-id hole (design.md D2, parity archived iOS D1).
 */
export interface VideoFeedSnapshot {
  readonly history: readonly FeedItem[];
  readonly seenPushIds: ReadonlySet<string>;
}

/**
 * Bounded, instance-level, per-videoId LRU cache of {@link VideoFeedSnapshot}s. See file
 * doc above for the scope decision (instance vs. process-level).
 */
export class VideoFeedSnapshotCache {
  private readonly maxEntries: number;
  private snapshots: Map<string, VideoFeedSnapshot> = new Map();
  /** Recency order, oldest (least-recently-visited) first — LRU eviction. */
  private order: string[] = [];

  constructor(maxEntries: number = 20) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  /**
   * The cached snapshot for `videoId`, or `undefined` if never visited (or evicted). A
   * lookup does NOT affect recency — only {@link save} moves an entry to
   * most-recently-used (mirrors the iOS version: a cache read costs nothing to "touch").
   */
  snapshot(videoId: string): VideoFeedSnapshot | undefined {
    return this.snapshots.get(videoId);
  }

  /**
   * Save (or refresh) `videoId`'s snapshot. A snapshot with EMPTY `history` is not worth
   * caching (nothing to restore later, and it would just occupy an LRU slot) — skipped
   * silently (design.md D5). `seenPushIds` is defensively copied (`new Set(...)`) so a
   * caller mutating its own live Set afterwards (e.g. `DefaultPlayerTemplate`'s
   * `_seenPushIds.clear()`, which runs later in the same `clear()` call) cannot reach
   * back into an already-saved snapshot.
   */
  save(videoId: string, history: readonly FeedItem[], seenPushIds: ReadonlySet<string>): void {
    if (history.length === 0) return;
    const result = VideoFeedSnapshotCache.inserting(
      videoId,
      { history: history.slice(), seenPushIds: new Set(seenPushIds) },
      this.snapshots,
      this.order,
      this.maxEntries,
    );
    this.snapshots = result.snapshots;
    this.order = result.order;
  }

  /**
   * Pure: LRU insert-or-update + bound eviction (docs/unit-test-discipline.md — extracted
   * so eviction is unit-testable without constructing the class). Moves `videoId` to
   * most-recently-used; evicts the single least-recently-visited entry once
   * `order.length` would exceed `maxEntries`. Mirrors the iOS
   * `VideoFeedSnapshotCache.inserting` / RN `activityByVideoId`-adjacent LRU shape.
   */
  static inserting(
    videoId: string,
    snapshot: VideoFeedSnapshot,
    snapshots: ReadonlyMap<string, VideoFeedSnapshot>,
    order: readonly string[],
    maxEntries: number,
  ): { snapshots: Map<string, VideoFeedSnapshot>; order: string[] } {
    const nextSnapshots = new Map(snapshots);
    const nextOrder = order.slice();
    nextSnapshots.set(videoId, snapshot);
    const idx = nextOrder.indexOf(videoId);
    if (idx !== -1) nextOrder.splice(idx, 1);
    nextOrder.push(videoId);
    if (nextOrder.length > maxEntries) {
      const oldest = nextOrder.shift();
      if (oldest !== undefined) nextSnapshots.delete(oldest);
    }
    return { snapshots: nextSnapshots, order: nextOrder };
  }
}
