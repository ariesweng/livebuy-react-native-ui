import type { LBWinner, LBAwardClaimResultParams, LBAwardClaimInput } from 'livebuy-react-native';

// reconcile-activity-notification-contract-template §2 / §3 / §4 — the win
// unclaimed-entry state, the award-claim submit action, and the award-claim
// result-state mapping. Behaviour / view-model layer only — the host draws
// LBWinEntry / LBWinSheet pixels and binds the state exposed here.
//
// Spec: `ui-template-foundation/spec.md`
//   § "Default Template（RN）帶 email 領獎提交行為（parity）"            (win-claim-email-submit-rn-template)
//   § "Default Template（RN）領獎 email 前端驗證（純函式，parity）"       (win-claim-email-submit-rn-template)
//
// Parity invariants (four-platform shared semantics):
//   - Unclaimed set is deduped by winner.id; an entry is removed (count
//     decrements) on awardClaimResult.status == 'claimed'.
//   - Submit carries the user-entered email → requestAwardClaim(winner,
//     { email }) (win-claim-email-submit-rn-template). The core's default
//     (non-intercepted) claim path REQUIRES `email`, so the previous EMAIL-LESS
//     entry point always failed without even sending POST /sdk/video/claim.
//     That entry point is kept, DEPRECATED, for source compatibility only —
//     see `RequestAwardClaim` below and `DefaultPlayerTemplate.submitAwardClaim`.
//   - awardCode is present ONLY for claimed + discount. Product carries no code
//     field (NOT an empty string).
//   - .unknown(Int) status is treated as .failed (forward-compat tolerance).

/**
 * Award-claim presentation classification, derived from `winner.award.type`.
 * Drives host CTA text (product → 查看獎品, discount → 立即使用). The template
 * exposes the classification; the host owns the actual copy.
 */
export enum AwardClaimClassification {
  /** award.type == "product" — CTA semantics「查看獎品」. */
  Product = 'product',
  /** award.type == "discount" — CTA semantics「立即使用」. */
  Discount = 'discount',
}

/** Classify a winner's award for host CTA selection (§3). */
export function classifyAward(winner: LBWinner): AwardClaimClassification {
  return winner.award?.type === 'discount'
    ? AwardClaimClassification.Discount
    : AwardClaimClassification.Product;
}

/**
 * Backing pattern for {@link isValidClaimEmail} (design `/.+@.+\..+/`, anchored).
 * Compiled ONCE at module level. MUST NOT carry the `g` flag — a global regex keeps a
 * stateful `lastIndex` across `.test()` calls, which would make consecutive validations
 * of the same string alternate true/false.
 */
const CLAIM_EMAIL_PATTERN = /^.+@.+\..+$/;

/**
 * Front-end email validation for the award-claim flow — a PURE function
 * (win-claim-email-submit-rn-template, parity iOS `DefaultWinClaim.isValidEmail` /
 * Android `DefaultPlayerTemplate.isValidEmail`). The host / reference-ui calls it on
 * every keystroke to decide whether the「確認領獎」CTA is disabled;
 * `DefaultPlayerTemplate.submitAwardClaim(winner, email)` uses the SAME function to
 * fail fast. No side effects, no state — callable without a template instance
 * (`DefaultPlayerTemplate.isValidEmail` is a thin static delegate to this).
 *
 * Rule mirrors the delivery design `design/templates/minimal/moments.jsx`
 * (`LBWinSheet`: `emailOk = /.+@.+\..+/.test(email.trim())`, moments.jsx:700): trim,
 * then `.+@.+\..+` — local part, `@`, domain, `.`, TLD.
 *
 * The pattern is ANCHORED (`^…$`) while the design's is not. JS `RegExp.test` without
 * anchors is a substring search, so `"junk\na@b.c"` would pass; anchored (and with no
 * `m` flag, `.` never matching `\n`) a multi-line paste is rejected. For SINGLE-LINE
 * input — i.e. every real email field — the two are identical, so anchoring only ever
 * tightens the multi-line edge case; it can never reject something the design accepts
 * on one line. Equivalent to iOS `^.+@.+\..+$` and Android `Regex.matches`.
 *
 * Deliberately NOT stricter (no RFC 5322): the truth lives in the backend
 * (deliverability is only known once the mail is sent), and over-strict rules would
 * kill valid addresses such as `user+tag@sub.domain.io`.
 */
export function isValidClaimEmail(raw: string): boolean {
  return CLAIM_EMAIL_PATTERN.test(raw.trim());
}

/**
 * Player-bound award-claim action carrying the host-collected contact
 * (win-claim-email-submit-rn-template — parity iOS `AwardClaimRequesting` /
 * Android `AwardClaimContactSubmitter`).
 *
 * Injected so the template never holds the native player ref directly (the RN bridge
 * owns it — same constraint as `requestEventJoin` / `loadVideo`). The host wires the
 * player ref's `requestAwardClaim(winner, contact)`; core's signature is unchanged
 * (its `contact` was already optional).
 *
 * `contact` is `{ email }` for the email-carrying entry point and `undefined` for the
 * DEPRECATED EMAIL-LESS one.
 */
export type RequestAwardClaimWithContact = (
  winner: LBWinner,
  contact?: LBAwardClaimInput,
) => void;

/**
 * Player-bound award-claim action WITHOUT a contact parameter.
 *
 * @deprecated EMAIL-LESS 提交 seam（無 contact 參數 → email 傳不出去），這正是 RN 版
 * EMAIL-LESS 陷阱的物理位置：core 預設（未被 host 攔截）領獎路徑 `email` 必填，缺 email
 * 直接 fail-fast、連 `POST /sdk/video/claim` 都不送，必然 `AWARD_CLAIM_RESULT(failed)`。
 * 改用 {@link RequestAwardClaimWithContact}；本型別將於下一個 major 移除
 * （`docs/contract-governance.md` I6 / 情境 F）。形狀刻意維持不變以保源碼相容。
 */
export type RequestAwardClaim = (winner: LBWinner) => void;

/**
 * Unclaimed-win set owned by the template (§2). core stays headless — it only
 * delivers `showWin`; the template maintains the deduped set + count. Pure
 * state model, no pixels. The host binds `count` / `winners` to draw the
 * floating LBWinEntry badge and opens the claim flow with a chosen winner.
 */
export class UnclaimedWinSet {
  // Insertion-ordered map keyed by winner.id (dedup) — Map preserves order so
  // the exposed winner list is stable for host rendering.
  private readonly byId = new Map<string, LBWinner>();

  /** Add a won winner (dedup by winner.id; same id re-delivery is a no-op). */
  add(winner: LBWinner): void {
    if (winner?.id == null) return;
    if (!this.byId.has(winner.id)) this.byId.set(winner.id, winner);
  }

  /** Remove a winner.id on successful claim (count decrements). */
  remove(winnerId: string): void {
    this.byId.delete(winnerId);
  }

  /** Unclaimed count (host binds for the LBWinEntry badge). */
  get count(): number {
    return this.byId.size;
  }

  /** Unclaimed winners, insertion order (host binds for the claim flow). */
  get winners(): readonly LBWinner[] {
    return Array.from(this.byId.values());
  }

  /** Remove every unclaimed winner (additive; parity with native `clear()`). */
  clear(): void {
    this.byId.clear();
  }
}

/** Outcome kind of an award-claim result-state (§4). */
export enum AwardClaimOutcome {
  /** Success: product prize (CTA「查看獎品」; no code). */
  SuccessProduct = 'successProduct',
  /** Success: discount (CTA「立即使用」; carries awardCode). */
  SuccessDiscount = 'successDiscount',
  /** Failure: retryable (.failed or .unknown(Int)). */
  Failure = 'failure',
}

/**
 * Result-state model the host binds to draw the success / failure feedback in
 * LBWinSheet. `awardCode` is present ONLY for SuccessDiscount; product success
 * and failure carry no code field at all (not an empty string).
 */
export interface AwardClaimResultState {
  readonly outcome: AwardClaimOutcome;
  /** Present only for SuccessDiscount. */
  readonly awardCode?: string;
  /** Backend event id when present (claimed). */
  readonly eventId?: number;
}

/**
 * Map a core `awardClaimResult(status, awardType, eventId?, awardCode?)`
 * notification into the host-bindable result-state model (§4). status values:
 * 'claimed' / 'failed' / any-other (treated as failed, forward-compat).
 */
export function mapAwardClaimResult(
  params: Pick<LBAwardClaimResultParams, 'status' | 'award_type' | 'event_id' | 'award_code'>,
): AwardClaimResultState {
  if (params.status !== 'claimed') {
    // 'failed' and any unknown status → failure / retryable.
    return { outcome: AwardClaimOutcome.Failure };
  }
  const eventId = params.event_id != null ? params.event_id : undefined;
  if (params.award_type === 'discount') {
    return {
      outcome: AwardClaimOutcome.SuccessDiscount,
      awardCode: params.award_code ?? undefined,
      eventId,
    };
  }
  // Product success — MUST NOT carry an awardCode field.
  return { outcome: AwardClaimOutcome.SuccessProduct, eventId };
}
