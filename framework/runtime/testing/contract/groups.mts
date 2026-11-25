/**
 * 契約テストの 5 つの群の入口(`@kaninabe/runtime/testing/contract/groups`)。
 *
 * 1 つの試験の束を、adapter を包んだ**ドライバの配列**を引数に取る関数として書いてある。
 * 手元のユニット(偽の通信路)と夜間の統合(実 DB)が、**同じ関数**を呼ぶ —— 差すのはドライバと世界だけである。
 *
 * | 群 | 約束すること |
 * |---|---|
 * | ① 3 値 | 未指定 / null / 値が、どの adapter でも同じ名前付き引数として DB に届く |
 * | ② 拒否の分類 | DB の断り方(UC403 / UC412 / UC409 / 制約違反 / 0 行 / 想定外)が、どの adapter でも同じ種類の結果になる |
 * | ③ 通信の失敗 | 接続の前に落ちたら `not_committed`・送ったあとの切断やタイムアウトは `unknown` |
 * | ④ 再試行しない | 1 回の呼び出しで通信路への要求はちょうど 1 回(コミット不明のあとも) |
 * | ⑤ 受領 | `outbox` は常に `unknown`・`requestedEffects` は単発 = 写し / 複合と受信口 = `null` |
 *
 * どの群も**歩いた回数**を返す。呼び側は 0 でないこと(世界が何も起こさない空振りでないこと)を見る。
 */

export { contractThreeValues } from './three-values.mjs';
export { contractRefusals, REFUSAL_SITUATIONS } from './refusals.mjs';
export { contractTransport, TRANSPORT_SITUATIONS } from './transport.mjs';
export { contractNoRetry, NO_RETRY_SITUATIONS } from './no-retry.mjs';
export { contractReceipt } from './receipt.mjs';
export { neutralOf } from './neutral.mjs';
