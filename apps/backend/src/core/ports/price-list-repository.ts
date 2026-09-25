import type { PriceList } from "../domain/config";

/** Read-only access to the versioned pricing catalog (file-backed). */
export interface PriceListRepository {
  getPriceList(): PriceList;
}

export const PRICE_LIST_REPOSITORY = "PriceListRepository";
