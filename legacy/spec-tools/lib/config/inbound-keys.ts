/**
 * 受信の署名の鍵として指されている設定の id(外部連携カタログの `signature_key`)。K6 がこの鍵の行に `strength` を求める。
 */

import type { ExternalCatalogSpec } from '../model/external/types.js';
import { isInbound } from '../model/external/types.js';

/**
 * 受信の署名の鍵の id を集める(署名しない口 `none` は鍵を持たない)。
 *
 * @param catalog 外部連携カタログ(無ければ空)
 * @returns 鍵の id(重複なし・宣言順)
 */
export function inboundSignatureKeys(catalog: Pick<ExternalCatalogSpec, 'integrations'> | null | undefined): readonly string[] {
  const keys = (catalog?.integrations ?? []).filter(isInbound).flatMap((integration) => (integration.signature === 'none' ? [] : [integration.signatureKey]));
  return [...new Set(keys)];
}
