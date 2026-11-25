/**
 * 受信 Webhook の署名検証（`external_spec` の `signature` が宣言する方式の実体）。
 *
 * 仕様: docs/specs/backend/external.md（`direction: inbound` の `signature`）
 * 規約: docs/rules/process/backend/specification/standards/external-spec-writing.md
 *       docs/rules/architecture/system/backend/ARCH-BE-0014-external-integration.md
 *
 * **方式は体系側の値域である。** 相手の名前（`service`）と違い、受信口の生成が方式で
 * 分岐するためであり、アプリごとに新しい検証方式を発明させない。ここが実装を持つのは
 * `hmac_sha256` の 1 つだけである。`provider_sdk` は相手の SDK が検証する方式なので
 * アダプタ（`port` の実装）が持ち、`none`（検証しない）は**理由つきで宣言した受信口の配線だけ**が
 * 字面で開く（`verify: () => true` と理由のコメントが生成物に残る）。ここに「検証しない」を
 * 受け付ける入口を置かないのは、方式の値を取り違えた呼び出しが黙って開かないためである。
 *
 * **署名は受信したバイト列のまま検証する。** 文字列に復号してから計算すると、相手が生のバイト列に
 * 署名していて本文に不正な UTF-8 や BOM があるとき、復号で中身が変わって検証が永久に合わない。
 *
 * **鍵が無ければ検証は失敗する（口が閉じる）。** 「未設定 = 素通し」は事故の形として最悪
 * なので、既定を閉じる側に倒す（PRIN-0009。Cron の共有秘密と同じ判断）。
 *
 * **鍵の更新の間は新旧どちらの鍵で署名した相手も受ける**（暗号の俊敏性。ASVS V11.2.2）。鍵には現在の鍵と更新前の鍵を並べて渡せる
 * （設定カタログの `previous`）。どの鍵で一致したかを時間に出さないよう、全部の鍵と比べる（`matchesAnySecret`）。
 */

import { createHmac } from 'node:crypto';
import { matchesAnySecret } from './secret.js';

/** この関数が実体を持つ方式（`provider_sdk` はアダプタ、`none` は配線の担当なのでここに来ない）。 */
export type VerifiableSignature = 'hmac_sha256';

/** 方式ごとの要約関数（方式は閉じた和なので、足した方式は型でここに行を要求される）。 */
const DIGEST_OF: Readonly<Record<VerifiableSignature, string>> = { hmac_sha256: 'sha256' };

/**
 * 受信した本文の署名を検証する。
 *
 * @param method - 宣言された方式（`external_spec` の `signature`）
 * @param secret - 共有秘密（`config` が指す設定の値。未設定なら `undefined`）。鍵の更新の間は `[現在の鍵, 更新前の鍵]` の並びで渡せる（どれか 1 つに合えば通る）
 * @param rawBody - 受信した本文のバイト列そのもの（復号もパースもする前。中身を変えると署名が合わない）
 * @param presented - 相手が送ってきた署名（ヘッダの値。無ければ `null`）
 * @returns 検証できたら true。鍵か署名が無ければ false
 */
export function verifyInboundSignature(
  method: VerifiableSignature,
  secret: string | undefined | readonly (string | undefined)[],
  rawBody: Uint8Array,
  presented: string | null,
): boolean {
  if (presented === null || presented === '') return false;
  const secrets = typeof secret === 'string' || secret === undefined ? [secret] : secret;
  const expected = secrets.map((key) =>
    key === undefined || key === '' ? undefined : createHmac(DIGEST_OF[method], key).update(rawBody).digest('hex'),
  );
  return matchesAnySecret(presented.trim().toLowerCase(), expected);
}
