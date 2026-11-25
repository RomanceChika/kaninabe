/**
 * 受信 Webhook の口の **URL**(相手の管理画面に登録する宛先)。
 *
 * 「1 行 = 1 種類のドメインイベント = 1 URL」(external-spec-writing.md)で、URL は連携 ID から決まる(`/api/inbound/{連携}`)。
 * **URL は製品の外から見える契約**(どのウェブのフレームワークでも成り立つ概念)なのでコアが決め、その URL を**どのファイルに置くか**は
 * アプリの枠の後段の配置(`http-entry`。`lib/model/product/layout.ts`)が決める。ジョブの `endpoint` と同じ URL の空間に入る
 * (2 つが同じ URL を取れば衝突。`job/verifiers/j2-entry-collision.ts` が見る)。
 */

/** 受信 Webhook の URL のパス(連携 ID から)。 */
export function inboundUrlOf(integration: string): string {
  return `/api/inbound/${integration}`;
}
