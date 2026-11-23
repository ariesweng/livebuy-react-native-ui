import type { LBProduct, LBSpec } from 'livebuy-react-native';
// 與 DefaultTemplate 互相 import：這兩個分類函式只在呼叫時讀取（不在模組載入時求值），CJS 循環載入安全。
import { isAddToCartAuthRequired, isAddToCartDeduplicated } from './DefaultTemplate';

// MARK: - 搶購下標與得標視窗（view-model 層，live-bid-rn-template，parity iOS live-bid-ios-template /
// Android live-bid-android-template）
//
// 搶購場直播中（`playerHeaderState.isFlashSale && playerHeaderState.isLive`），
// `DefaultPlayerTemplate.addToCart()` 改走注入的 {@link BidRequester}（預設接 core
// `LivebuySDK.placeBid`），結果寫入 `DefaultPlayerTemplate.bidOutcome`。core `BID_WON` 經
// `TemplateAttachment` 餵入 {@link DefaultBidWon}（「恭喜搶購成功」視窗狀態）。行為 / 狀態 only——不繪製
// 像素、不含任何文字（reference-ui 依狀態與錯誤代碼取文案）。純 TS，無 native 依賴。

/**
 * 一筆搶購下標請求，由 template 從目前商品明細 + 已選規格 + 數量組成（parity iOS / Android
 * `LBBidRequest`）。形狀比照 `CartAddRequest`：`goodsId` / `specificationId` 為數字，
 * 無規格商品省略 `specificationId`；`videoId` 為 template 由 `VIDEO_OPEN` 追蹤的當前影片短碼，
 * 尚未收到時省略。
 */
export interface LBBidRequest {
  readonly goodsId: number;
  readonly num: number;
  readonly specificationId?: number;
  readonly videoId?: string;
}

/**
 * 最近一次搶購下標的結果（parity iOS / Android `LBBidOutcome`）。template 上為 `null` = 這次嘗試 /
 * 這個明細還沒有結果。`failed.code` 為後端 `error_code`（`purchase_limit_exceeded` /
 * `out_of_stock` / …），沒有代碼（網路錯誤、舊後端、未接線）為 `null`，reference-ui 依代碼選文案。
 */
export type LBBidOutcome =
  | { readonly type: 'placed' }
  | { readonly type: 'failed'; readonly code: string | null };

/**
 * 搶購下標 requester。template 在搶購場直播中的 `addToCart()` 呼叫它；resolve = 下標成功，reject =
 * core 的 typed `LBError`（或任意值）。預設接 core `LivebuySDK.placeBid`（lazy require）。
 */
export type BidRequester = (request: LBBidRequest) => Promise<unknown>;

/**
 * 得標確認 requester：`(videoId, buyingIds)`，每次「確定」呼叫一次、帶全部 `buying_id`。預設接 core
 * `LivebuySDK.confirmBidWin`（fire-and-forget，失敗只記 debug log）。
 */
export type BidConfirmRequester = (videoId: string, buyingIds: readonly string[]) => void;

/**
 * 下標 reject 的分類（parity Android `BidRequestOutcome.from`；iOS 在 catch 內直接分支）。
 * JS 沒有協程取消，故無 Android 的 `cancelled` 分支。
 */
export type BidRejection =
  | { readonly type: 'deduplicated' }
  | { readonly type: 'needsLogin' }
  | { readonly type: 'failed'; readonly code: string | null };

/**
 * PURE：下標 reject 值 → 分類。`{ type: 'cartAddDeduplicated' }` → deduplicated（同一商品規格的下標
 * 仍在進行中，結果不變）；`{ type: 'serverError', code: 401 }` → needsLogin；其他 → failed，帶
 * `backendErrorCode`（非空字串才算，否則 `null`）。
 */
export function classifyBidRejection(error: unknown): BidRejection {
  if (isAddToCartDeduplicated(error)) return { type: 'deduplicated' };
  if (isAddToCartAuthRequired(error)) return { type: 'needsLogin' };
  return { type: 'failed', code: backendErrorCodeOf(error) };
}

/** PURE：讀 typed `LBError.backendErrorCode`；缺、非字串、空字串 → `null`。 */
function backendErrorCodeOf(error: unknown): string | null {
  if (error == null || typeof error !== 'object') return null;
  const code = (error as { backendErrorCode?: unknown }).backendErrorCode;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * PURE（parity iOS `isBuyButtonHidden(product:saleKeywordRequired:)` / Android
 * `DefaultPlayerTemplate.isBuyButtonHidden`）：直播管家搶購場需要關鍵字（`saleKeywordRequired`）而
 * 這個商品沒設 → 隱藏購買鈕（同網頁 `xslNoKeyword`）。不綁直播狀態。`saleKeyword` 缺值視為空字串。
 */
export function isBuyButtonHidden(
  product: Pick<LBProduct, 'saleKeyword'>,
  saleKeywordRequired: boolean,
): boolean {
  return saleKeywordRequired && (product.saleKeyword ?? '').length === 0;
}

/**
 * PURE：有效每人限購——已選規格的 `limitNum > 0` 取規格值，否則取商品層 `productLimit`；非搶購場
 * 直播中（`bidMode` false）為 0（parity Android `effectiveLimitNum`）。
 */
export function effectiveLimitNum(
  productLimit: number,
  spec: Pick<LBSpec, 'limitNum'> | null,
  bidMode: boolean,
): number {
  if (!bidMode) return 0;
  const specLimit = spec?.limitNum ?? 0;
  if (specLimit > 0) return specLimit;
  return productLimit;
}

/** 「恭喜搶購成功」視窗中的一筆得標（parity iOS / Android `LBBidWonItem`）。 */
export interface LBBidWonItem {
  readonly buyingId: string;
  readonly productId: string;
  /** 無具名規格為 `''`。 */
  readonly specificationId: string;
  /** 後端組好的名稱，例如 `'保溫杯(紅)'`。 */
  readonly name: string;
  readonly num: number;
  /** `ordered` / `failed`（core `BID_WON.status`）。 */
  readonly status: string;
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === 'string' ? value : '';
}

/**
 * keyword-bid-result-toast-rn-template（parity iOS `keywordBidOutcome`）：聊天關鍵字下標的
 * `BID_PLACE_RESULT` params → 結果（每次回傳新物件，reference-ui 的 effect 以參考比對，連續相同結果也會提示）；
 * 按鈕下標（`is_keyword` 為假）回 null。`is_keyword` 接受 boolean、`1` 或 `'1'`。
 */
export function keywordBidOutcome(params: Record<string, unknown>): LBBidOutcome | null {
  const raw = params.is_keyword;
  const isKeyword = raw === true || raw === 1 || raw === '1';
  if (!isKeyword) return null;
  if (params.status === 'placed') return { type: 'placed' };
  const code = params.backend_error_code;
  return { type: 'failed', code: typeof code === 'string' && code !== '' ? code : null };
}

/** PURE：`BID_WON` params → 一筆得標；沒有非空字串 `buying_id` 回 `null`。 */
export function bidWonItemFromParams(params: Record<string, unknown>): LBBidWonItem | null {
  const buyingId = stringParam(params, 'buying_id');
  if (buyingId.length === 0) return null;
  const num = params.num;
  return {
    buyingId,
    productId: stringParam(params, 'product_id'),
    specificationId: stringParam(params, 'specification_id'),
    name: stringParam(params, 'name'),
    num: typeof num === 'number' && Number.isFinite(num) ? num : 0,
    status: stringParam(params, 'status'),
  };
}

/**
 * 「恭喜搶購成功」視窗 view-model（parity iOS / Android `DefaultBidWon`，`template.bidWon`）。收到
 * `BID_WON`（`ordered` 或 `failed` 都算得標）→ {@link record}；「確定」→ {@link confirm}；「取消」/
 * 換片 → {@link clear}。各 mutator 回傳「是否變更」，由 `DefaultPlayerTemplate` 統一發一次變更通知。
 */
export class DefaultBidWon {
  private _items: readonly LBBidWonItem[] = [];
  private _isPresented = false;

  /** 待呈現的得標（加入順序）。 */
  get items(): readonly LBBidWonItem[] {
    return this._items;
  }

  /** 視窗是否呈現中。 */
  get isPresented(): boolean {
    return this._isPresented;
  }

  /** 加入一筆（同 `buyingId` 不重複）並呈現。回傳是否變更。@internal */
  record(item: LBBidWonItem): boolean {
    if (this._items.some((it) => it.buyingId === item.buyingId)) {
      if (this._isPresented) return false;
      this._isPresented = true;
      return true;
    }
    this._items = [...this._items, item];
    this._isPresented = true;
    return true;
  }

  /**
   * 「確定」：先清空關閉，再以全部 `buyingId` 呼叫 `forward` 一次（不等結果，同網頁）。`forward` 同步
   * 丟錯也只記 debug log——確認失敗 MUST NOT 讓 items 回來。回傳是否變更。@internal
   */
  confirm(forward: (buyingIds: readonly string[]) => void): boolean {
    const ids = this._items.map((it) => it.buyingId);
    const changed = this.clear();
    if (ids.length === 0) return changed;
    try {
      forward(ids);
    } catch (e) {
      if (__DEV__) console.log('[DefaultBidWon] confirm requester threw', e);
    }
    return changed;
  }

  /** 「取消」/ 換片：清空關閉，不確認。回傳是否變更。@internal */
  clear(): boolean {
    if (this._items.length === 0 && !this._isPresented) return false;
    this._items = [];
    this._isPresented = false;
    return true;
  }
}
