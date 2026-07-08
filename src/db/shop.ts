import { db } from "./index.js";

/** The shop's identity for invoice headers. Single row (id = 1). */
export interface ShopConfig {
  id: number;
  name: string;
  gstin: string;
  address: string;
  state: string;
  phone: string;
}

const getStmt = db.prepare("SELECT * FROM shop_config WHERE id = 1");

export function getShopConfig(): ShopConfig {
  return getStmt.get() as ShopConfig;
}

export type ShopPatch = Partial<Pick<ShopConfig, "name" | "gstin" | "address" | "state" | "phone">>;

/** Update only the provided fields; returns the full config. */
export function updateShopConfig(patch: ShopPatch): ShopConfig {
  const fields = (["name", "gstin", "address", "state", "phone"] as const).filter(
    (k) => patch[k] !== undefined,
  );
  if (fields.length > 0) {
    const setSql = fields.map((k) => `${k} = @${k}`).join(", ");
    const params: Record<string, string> = {};
    for (const k of fields) params[k] = String(patch[k]);
    db.prepare(`UPDATE shop_config SET ${setSql} WHERE id = 1`).run(params);
  }
  return getShopConfig();
}
