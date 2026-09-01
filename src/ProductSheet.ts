// product-sheet-stack-template —商品 sheet-stack host-bindable view-models
// (behaviour / view-model layer; NO pixels). Mirrors `GoodsTracking.ts` /
// `MomentState.ts` / `AuthGate.ts`.
//
// Spec: ui-template-foundation/spec.md
//   § "Default Template 商品 Sheet-Stack 狀態與加購行為"
//   § "Default Template Bindable State 變更通知" (MODIFIED — sheet-stack 覆蓋)
// Design: design.md D1–D8.
//
// core stays headless: it owns the add-to-cart endpoints (route B
// `LivebuySDK.addToCart` → `LBCartResult`, route A `CART_ADD_REQUEST`), the
// `LBProduct` model (now FULL over the RN bridge per `product-bridge-data-core`
// — `price` / `photos` / `stock` / `specifications` / `specOptions`), and
// `productTap` (`PRODUCT_CLICK`). These models map that data into five
// host-bindable sheet-stack view-models (product-detail / variant-picker /
// qty-stepper / mini-cart / cart CTA) so a host can draw `sdk-components.jsx`'s
// `LBPBottomSheet` / `LBPProductRow` / `LBPVariantPicker` / `LBPQtyStepper` /
// `LBPMiniCart` / `LBPCartCTA`. The template never renders.
//
// RN wiring note (design D5 / D7 — injected requester, parity with
// `GoodsTrackingSetter`): the add-to-cart delegation (`LivebuySDK.addToCart`) is
// injected as a callback (default no-op) EXACTLY like the goods-tracking
// `setAwaitGoods` / `setNoticeGoods` delegates — so the model itself never builds
// an HTTP request and stays unit-testable headless in jest (no native bridge).
// The host (which owns the player ref + the configured `shopId`) wires the real
// requester at attach time.
//
// Each mutator RETURNS `boolean` (= "did this actually change") so the owning
// template coalesces exactly ONE notification per single state mutation (parity
// with `MomentState` / `GoodsTracking` / `ErrorState`).

import type { LBProduct, LBSpec, LBSpecOption, LBAddToCartResult } from 'livebuy-react-native';

// ---------------------------------------------------------------------------
// Add-to-cart requester (injected delegate; route B → LBCartResult).
// ---------------------------------------------------------------------------

/**
 * The template-built route-B add-to-cart request. `shopId` / `guest_id` / login
 * token / `lang` are injected by the core requester (the host wires the real
 * `LivebuySDK.addToCart`, which knows the configured `shopId`); the template only
 * supplies the per-tap selection. `specificationId` is omitted for a no-spec
 * product (D5).
 */
export interface CartAddRequest {
  /** product-detail product id (numeric — coerced from the String `LBProduct.id`). */
  readonly goodsId: number;
  /** quantity from the qty-stepper. */
  readonly num: number;
  /** selected spec id, or undefined for a no-spec product. */
  readonly specificationId?: number;
  /**
   * 當前影片短碼（cart-add-tier2-unify）。透傳給 core `LivebuySDK.addToCart({ videoId })`，
   * 使後續 `CART_ADD_REQUEST.video_id` 為當前影片。template 由 VIDEO_OPEN 追蹤；無則 undefined。
   */
  readonly videoId?: string;
}

/**
 * Host-wired delegate for an add-to-cart intent → core route-B
 * `LivebuySDK.addToCart`. Returns the route-B `LBCartResult`. The template NEVER
 * builds HTTP itself (headless write contract; parity with `GoodsTrackingSetter`).
 * The default is a no-op (rejects) so headless unit tests inject a fake.
 */
export type CartAddRequester = (request: CartAddRequest) => Promise<LBAddToCartResult>;

// ---------------------------------------------------------------------------
// 1. product-detail — mirrors the relevant LBProduct fields (D1).
// ---------------------------------------------------------------------------

/**
 * One「更多商品」推薦卡片(expose-other-goods-recommendations-template design.md D2)。
 * 由 `LBChannel.otherGoods[]` 映射，刻意精簡 — 只帶渲染推薦卡 + 換片所需的最小欄位集合，
 * 不含 `specifications` / `specOptions`：使用者真的點進巢狀明細時，template 走既有
 * `productTap` → product-detail 映射路徑重新算出完整狀態，不靠這份精簡清單帶規格資料。
 */
export interface LBProductRecommendation {
  readonly productId: string;
  readonly name: string;
  readonly priceShow: string;
  readonly pic: string;
  /**
   * 跨影片商品參照(`LBProduct.videoId`)。後端該筆 `other_goods[]` 未提供 `video_id` 時為
   * `undefined` — reference-ui MUST 隱藏/停用換片入口，MUST NOT 補假值。
   */
  readonly videoId?: string;
  /** 0 | 1 — API integer, not boolean. */
  readonly soldOut: number;
  /**
   * 原價顯示字串(add-recommendation-original-price-template-rn)。鏡射 `LBProduct.
   * originalPriceShow` 語意 — `''` = 無原價，非 optional。reference-ui 依既有「非空且與
   * `priceShow` 不同才顯示劃線」判斷式決定是否呈現，本欄位只負責帶值。
   */
  readonly originalPriceShow: string;
  /**
   * 商品簡介(add-recommendation-brief-description-template-rn)。鏡射 `LBProduct.brief`
   * 語意——`recommendationsFromOtherGoods()` 映射時一律直接透傳來源 `LBProduct.brief`
   * (非 optional string)，賦值後恆為明確字串，不會是 `undefined`。欄位型別本身宣告為
   * optional(`?`)純粹是為了 TS 跨套件相容：`react-native-reference-ui` 有多處手寫
   * `LBProductRecommendation` 字面量(測試 fixture + `ProductSheetsModel.ts` demo seed)不提供
   * 這兩個欄位，宣告 non-optional 會破壞該套件的 typecheck(2026-08-25 補正驗證)。
   */
  readonly brief?: string;
  /**
   * 商品介紹文字(add-recommendation-brief-description-template-rn)。鏡射 `LBProduct.
   * description` 語意，來源 `LBProduct.description` 為 optional(`description?: string`，
   * `add-product-description-core-rn` 為避免破壞跨套件手寫字面量 typecheck 而刻意選擇
   * optional)——`recommendationsFromOtherGoods()` 映射時容錯為 `''`(`p.description ?? ''`)，
   * 賦值後恆為明確字串。欄位型別宣告為 optional(`?`)理由同 `brief`：維持
   * `react-native-reference-ui` 手寫字面量的跨套件相容性。
   */
  readonly description?: string;
}

/**
 * 純函式(可獨立測試)：過濾掉 `productId` 自身(`other_goods[]` 不保證不含目前商品,資料
 * 正確性防線由 template 負責,見 design.md D1),映射為精簡的 {@link LBProductRecommendation}。
 * MUST NOT 裁切張數(裁切屬 reference-ui 版面決定)。
 */
export function recommendationsFromOtherGoods(
  otherGoods: readonly LBProduct[],
  productId: string,
): LBProductRecommendation[] {
  return otherGoods
    .filter((p) => p.id !== productId)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      priceShow: p.priceShow,
      pic: p.pic,
      videoId: p.videoId,
      soldOut: p.soldOut,
      originalPriceShow: p.originalPriceShow,
      brief: p.brief,
      description: p.description ?? '',
    }));
}

/**
 * Host-bindable product-detail snapshot (design `LBPBottomSheet` + `LBPProductRow`).
 * Directly mirrors the relevant `LBProduct` fields (avoids a parallel model). The
 * variant / qty data lives in the variant-picker / qty-stepper view-models, which
 * are derived from `specifications` / `specOptions` / `stock` / `soldOut`.
 */
export interface LBProductDetailState {
  readonly productId: string;
  readonly name: string;
  readonly priceShow: string;
  /** "" when the product has no original price. */
  readonly originalPriceShow: string;
  /** Numeric price as string (host self-parses; same precision rationale as id). */
  readonly price: string;
  readonly stock: number;
  /** 0 | 1 — API integer, not boolean. */
  readonly soldOut: number;
  readonly photos: readonly string[];
  readonly specifications: readonly LBSpec[];
  readonly specOptions: readonly LBSpecOption[];
  /**
   * 「更多商品」推薦清單 — 過濾後的完整 `LBChannel.otherGoods`(排除目前商品,不裁切張數,
   * expose-other-goods-recommendations-template design.md D1)。無 channel 情境時為空陣列。
   */
  readonly recommendations: readonly LBProductRecommendation[];
}

/**
 * Map an `LBProduct` → product-detail snapshot. `otherGoods` is the current
 * channel's `LBChannel.otherGoods` (empty when no channel context, e.g. a
 * headless unit test) — mapped into `recommendations` via {@link
 * recommendationsFromOtherGoods}. Pure.
 */
function detailFromProduct(p: LBProduct, otherGoods: readonly LBProduct[] = []): LBProductDetailState {
  return {
    productId: p.id,
    name: p.name,
    priceShow: p.priceShow,
    originalPriceShow: p.originalPriceShow ?? '',
    price: p.price,
    stock: p.stock,
    soldOut: p.soldOut,
    photos: p.photos ?? [],
    specifications: p.specifications ?? [],
    specOptions: p.specOptions ?? [],
    recommendations: recommendationsFromOtherGoods(otherGoods, p.id),
  };
}

/** Shallow-compare two recommendation lists field-by-field. Pure. */
function recommendationsEqual(
  a: readonly LBProductRecommendation[],
  b: readonly LBProductRecommendation[],
): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const o = b[i]!;
      return (
        r.productId === o.productId &&
        r.name === o.name &&
        r.priceShow === o.priceShow &&
        r.pic === o.pic &&
        r.videoId === o.videoId &&
        r.soldOut === o.soldOut &&
        r.originalPriceShow === o.originalPriceShow &&
        r.brief === o.brief &&
        r.description === o.description
      );
    })
  );
}

/**
 * Shallow-compare two product-detail snapshots on the mapped scalar fields +
 * `photos` + `recommendations` (the variant / spec arrays are re-derived from
 * `specifications` / `specOptions`, so the scalar identity is what decides
 * 「same sheet」). Pure. Mirrors the iOS diff-then-notify equality
 * (`LBProductDetailState` value type).
 */
function detailEquals(a: LBProductDetailState, b: LBProductDetailState): boolean {
  return (
    a.productId === b.productId &&
    a.name === b.name &&
    a.priceShow === b.priceShow &&
    a.originalPriceShow === b.originalPriceShow &&
    a.price === b.price &&
    a.stock === b.stock &&
    a.soldOut === b.soldOut &&
    a.photos.length === b.photos.length &&
    a.photos.every((v, i) => v === b.photos[i]) &&
    recommendationsEqual(a.recommendations, b.recommendations)
  );
}

/**
 * product-detail view-model. The owning template feeds {@link openDetail} (a
 * `diversion==0` productTap) and {@link clearDetail}; the host reads {@link
 * detail} and re-renders on the template's change notification. Single value
 * (newest overwrites prior, modal semantics — D1).
 */
export class DefaultProductSheet {
  private _detail: LBProductDetailState | null = null;

  /** Latest product-detail snapshot, or null when no sheet is open. */
  get detail(): LBProductDetailState | null {
    return this._detail;
  }

  /**
   * Open a product-detail sheet from an `LBProduct` (a `diversion==0` productTap).
   * `otherGoods` is the current channel's `LBChannel.otherGoods` (empty/omitted
   * when no channel context, e.g. a headless unit test) — mapped into
   * `recommendations` (expose-other-goods-recommendations-template). Returns the
   * mapped snapshot (the template resets variant/qty + recomputes qty bounds from
   * it). DIFF-THEN-NOTIFY (parity with iOS): re-opening the SAME product
   * (identical mapped fields) while its sheet is still open is a NO-OP — the snapshot
   * object identity is preserved so the owning template coalesces no change. The
   * companion {@link closeProductDetail} clears the sheet so a later re-open of the
   * same product DOES surface (mirrors iOS — a closed sheet re-opens on the same tap).
   * @internal
   */
  openDetail(product: LBProduct, otherGoods: readonly LBProduct[] = []): LBProductDetailState {
    const next = detailFromProduct(product, otherGoods);
    if (this._detail !== null && detailEquals(this._detail, next)) {
      // Same product, sheet still open → no-op (keep the existing snapshot identity).
      this._lastOpenChanged = false;
      return this._detail;
    }
    this._detail = next;
    this._lastOpenChanged = true;
    return this._detail;
  }

  /**
   * Whether the most recent {@link openDetail} actually changed the open sheet
   * (false when it was a no-op re-open of the same product). The owning template
   * reads this to decide whether to reset variant/qty + fire ONE notification.
   * @internal
   */
  get lastOpenChanged(): boolean {
    return this._lastOpenChanged;
  }
  private _lastOpenChanged = false;

  /** Close the sheet. Returns whether it changed. @internal */
  clearDetail(): boolean {
    if (this._detail === null) return false;
    this._detail = null;
    return true;
  }

  /** Reset on teardown / new video. Returns whether it changed. @internal */
  clear(): boolean {
    return this.clearDetail();
  }
}

// ---------------------------------------------------------------------------
// 2. variant-picker — groups from specOptions, selection template-owned,
//    selectedSpec resolved from specifications (D2).
// ---------------------------------------------------------------------------

/** One spec dimension for `LBPVariantPicker` (`{ label, options }`). */
export interface LBVariantGroup {
  readonly label: string;
  readonly options: readonly string[];
}

/**
 * Host-bindable variant-picker snapshot. `groups` is derived from `specOptions`;
 * `selection` is the template-owned `{ groupIndex → optionIndex }` (host updates
 * via `selectVariant`); `selectedSpec` / `selectedSpecificationId` are resolved
 * from `specifications` (null until the selection is complete / when no specs).
 */
export interface LBVariantState {
  readonly groups: readonly LBVariantGroup[];
  /** groupIndex → chosen optionIndex (-1 = unchosen). */
  readonly selection: readonly number[];
  readonly selectedSpec: LBSpec | null;
  readonly selectedSpecificationId: string | null;
}

/** Map `specOptions` → `groups` for the chip picker. Pure. */
function groupsFromOptions(specOptions: readonly LBSpecOption[]): LBVariantGroup[] {
  return specOptions.map((o) => ({ label: o.name, options: (o.child ?? []).slice() }));
}

/**
 * Resolve the selected `LBSpec` from the current selection. The backend spec
 * `name` is the group values joined (existing `LBSpec.name` convention, design
 * D2). The selection is complete only when every group has a chosen option; the
 * chosen option labels (in group order) are matched against each spec's `name`
 * split on the common separators. A product with no spec dimensions resolves to
 * its single spec (or null). Pure — unit-testable.
 */
export function resolveSelectedSpec(
  groups: readonly LBVariantGroup[],
  selection: readonly number[],
  specifications: readonly LBSpec[],
): LBSpec | null {
  // No spec dimensions → the single purchasable spec (or null when none).
  if (groups.length === 0) {
    return specifications.length === 1 ? (specifications[0] ?? null) : null;
  }
  // Selection must be complete (every group chosen).
  const chosen: string[] = [];
  for (let g = 0; g < groups.length; g++) {
    const optIdx = selection[g] ?? -1;
    const opt = groups[g]!.options[optIdx];
    if (optIdx < 0 || opt === undefined) return null;
    chosen.push(opt);
  }
  // Match the chosen labels against each spec's name (order-independent set).
  const want = chosen.slice().sort();
  for (const spec of specifications) {
    const parts = specNameParts(spec.name);
    if (parts.length !== want.length) continue;
    const got = parts.slice().sort();
    if (got.every((v, i) => v === want[i])) return spec;
  }
  return null;
}

/** Split a spec `name` into its dimension values (tolerant of common separators). */
function specNameParts(name: string): string[] {
  return name
    .split(/[\/,，、·\-\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * variant-picker view-model. The template seeds {@link reset} from a product's
 * `specOptions` / `specifications`, and the host updates the selection via {@link
 * selectVariant}. `selectedSpec` / `selectedSpecificationId` are re-resolved on
 * each selection. Each mutator returns whether it changed. @internal mutators.
 */
export class DefaultVariantPicker {
  private _groups: readonly LBVariantGroup[] = [];
  private _selection: number[] = [];
  private _specifications: readonly LBSpec[] = [];
  private _selectedSpec: LBSpec | null = null;

  get groups(): readonly LBVariantGroup[] {
    return this._groups;
  }
  get selection(): readonly number[] {
    return this._selection;
  }
  get selectedSpec(): LBSpec | null {
    return this._selectedSpec;
  }
  get selectedSpecificationId(): string | null {
    return this._selectedSpec?.id ?? null;
  }

  get current(): LBVariantState {
    return {
      groups: this._groups,
      selection: this._selection.slice(),
      selectedSpec: this._selectedSpec,
      selectedSpecificationId: this.selectedSpecificationId,
    };
  }

  /**
   * Re-seed groups + specifications from a newly-opened product and reset the
   * selection (each group unchosen). For a no-spec product `selectedSpec` resolves
   * to the single spec immediately (D2). Always reports a change. @internal
   */
  reset(specOptions: readonly LBSpecOption[], specifications: readonly LBSpec[]): boolean {
    this._groups = groupsFromOptions(specOptions);
    this._specifications = specifications.slice();
    this._selection = this._groups.map(() => -1);
    this._selectedSpec = resolveSelectedSpec(this._groups, this._selection, this._specifications);
    return true;
  }

  /**
   * Host chose an option in a group. Updates the selection and re-resolves the
   * selected spec. Returns whether the selected spec actually changed (a redundant
   * re-pick of the same option reports false). @internal
   */
  selectVariant(groupIndex: number, optionIndex: number): boolean {
    if (groupIndex < 0 || groupIndex >= this._groups.length) return false;
    const group = this._groups[groupIndex]!;
    if (optionIndex < 0 || optionIndex >= group.options.length) return false;
    if (this._selection[groupIndex] === optionIndex) return false;
    this._selection[groupIndex] = optionIndex;
    this._selectedSpec = resolveSelectedSpec(this._groups, this._selection, this._specifications);
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (this._groups.length === 0 && this._selection.length === 0 && this._selectedSpec === null) {
      return false;
    }
    this._groups = [];
    this._selection = [];
    this._specifications = [];
    this._selectedSpec = null;
    return true;
  }
}

// ---------------------------------------------------------------------------
// 3. qty-stepper — { qty, min, max }, max from selectedSpec/product stock (D3).
// ---------------------------------------------------------------------------

/** Host-bindable qty-stepper snapshot (design `LBPQtyStepper`). */
export interface LBQtyState {
  readonly qty: number;
  readonly min: number;
  readonly max: number;
}

/**
 * qty-stepper view-model. The template calls {@link recomputeBounds} when a sheet
 * opens / a variant changes (max = selectedSpec.stock or product stock; soldOut /
 * stock≤0 → min=max=qty=0). The host drives `setQty` / `incQty` / `decQty`, all
 * clamped to `[min, max]` (D3). @internal mutators.
 */
export class DefaultQtyStepper {
  private _qty = 0;
  private _min = 0;
  private _max = 0;

  get current(): LBQtyState {
    return { qty: this._qty, min: this._min, max: this._max };
  }
  get qty(): number {
    return this._qty;
  }
  get min(): number {
    return this._min;
  }
  get max(): number {
    return this._max;
  }

  /**
   * Recompute `{ min, max }` from a stock + soldOut flag and re-clamp `qty`:
   *   soldOut==1 || stock<=0 → { qty:0, min:0, max:0 } (host draws 缺貨)
   *   otherwise              → min=1, max=stock, qty re-clamped into [1, stock]
   * `keepQty` (variant switch) re-clamps the current qty; otherwise qty resets to
   * `min`. Returns whether the snapshot changed. @internal
   */
  recomputeBounds(stock: number, soldOut: number, keepQty: boolean): boolean {
    let min: number;
    let max: number;
    let qty: number;
    if (soldOut === 1 || stock <= 0) {
      min = 0;
      max = 0;
      qty = 0;
    } else {
      min = 1;
      max = stock;
      qty = keepQty ? clamp(this._qty, min, max) : min;
    }
    if (this._qty === qty && this._min === min && this._max === max) return false;
    this._qty = qty;
    this._min = min;
    this._max = max;
    return true;
  }

  /** Set qty clamped to [min, max]. Returns whether it changed. @internal */
  setQty(value: number): boolean {
    const next = clamp(value, this._min, this._max);
    if (next === this._qty) return false;
    this._qty = next;
    return true;
  }

  /** +1 clamped to max. Returns whether it changed. @internal */
  incQty(): boolean {
    return this.setQty(this._qty + 1);
  }

  /** -1 clamped to min. Returns whether it changed. @internal */
  decQty(): boolean {
    return this.setQty(this._qty - 1);
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    if (this._qty === 0 && this._min === 0 && this._max === 0) return false;
    this._qty = 0;
    this._min = 0;
    this._max = 0;
    return true;
  }
}

/** Clamp `v` into `[lo, hi]` (returns lo when hi < lo). */
function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// ---------------------------------------------------------------------------
// 4. mini-cart — peek { productId, name, priceShow, soldOut } (D4).
// ---------------------------------------------------------------------------

/** Host-bindable mini-cart peek (design `LBPMiniCart`). */
export interface LBMiniCartPeek {
  readonly productId: string;
  readonly name: string;
  readonly priceShow: string;
  /** 0 | 1 — API integer. */
  readonly soldOut: number;
  /**
   * 商品圖 URL（rb-rn-vod-now-introducing-multi-template，問題 9/10）。預設 `''` → 既有呼叫 /
   * demo / setPeek byte-identical、placeholder 不變；reference-ui 的 VOD 介紹輪播以
   * `photos[0] ?? pic` 填入。鏡像 iOS / Android / Flutter `LBMiniCartPeek.pic`。
   */
  readonly pic: string;
}

/**
 * mini-cart view-model. The peek source is **ONLY** the latest successfully
 * added product (minicart-peek-add-only / tmpl-ios-remove-minicart-peek-fallback):
 * the 講解中商品 (`narrate_status == 2`) is shown by the pinned card (LIVE) /
 * now-introducing card (VOD), so the mini-cart peek is NOT seeded from it (that
 * duplicated the same MiniCartView component and leaked the VOD-only peek into
 * LIVE). The host reads {@link peek} and re-renders. @internal mutators.
 */
export class DefaultMiniCart {
  private _peek: LBMiniCartPeek | null = null;

  get peek(): LBMiniCartPeek | null {
    return this._peek;
  }

  /** Set the peek to a product snapshot. Returns whether it changed. @internal */
  setPeek(p: {
    productId: string;
    name: string;
    priceShow: string;
    soldOut: number;
    // 商品圖 URL（rb-rn-vod-now-introducing-multi-template，問題 9/10）。預設 '' → 既有呼叫 byte-identical。
    pic?: string;
  }): boolean {
    const pic = p.pic ?? '';
    if (
      this._peek !== null &&
      this._peek.productId === p.productId &&
      this._peek.name === p.name &&
      this._peek.priceShow === p.priceShow &&
      this._peek.soldOut === p.soldOut &&
      this._peek.pic === pic
    ) {
      return false;
    }
    this._peek = { productId: p.productId, name: p.name, priceShow: p.priceShow, soldOut: p.soldOut, pic };
    return true;
  }

  /** Dismiss the peek. Returns whether it changed. @internal */
  dismissMiniCart(): boolean {
    if (this._peek === null) return false;
    this._peek = null;
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    return this.dismissMiniCart();
  }
}

// ---------------------------------------------------------------------------
// 5. cart CTA — { count } per-session add count (D4).
// ---------------------------------------------------------------------------

/** Host-bindable cart CTA snapshot (design `LBPCartCTA`). */
export interface LBCartCTAState {
  readonly count: number;
}

/**
 * cart CTA view-model. `count` = the per-session count of successful route-B adds
 * via the template (+1 each success). NOT a persistent local cart — the real cart
 * / `buy_no` lives on the backend (D4). The host wires `openCart` to its own
 * checkout. @internal mutators.
 */
export class DefaultCartCTA {
  private _count = 0;

  get count(): number {
    return this._count;
  }
  get current(): LBCartCTAState {
    return { count: this._count };
  }

  /** A successful add → +1. Always reports a change. @internal */
  incrementOnAdd(): boolean {
    this._count += 1;
    return true;
  }

  /** Reset the per-session count (release / new video, OQ2). Returns whether changed. @internal */
  resetForSession(): boolean {
    if (this._count === 0) return false;
    this._count = 0;
    return true;
  }

  /** Reset to initial. Returns whether it changed. @internal */
  clear(): boolean {
    return this.resetForSession();
  }
}
