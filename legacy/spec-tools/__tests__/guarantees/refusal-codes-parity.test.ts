/**
 * **拒否の分類の語**（errcode・接頭辞・エンジンの拒否理由）が検証器・生成器の側と実行時パッケージの側で
 * 1 つであることの突合（束 ⑳-3 / 束 ⑳-5a-b。束 分離 ②-b2 で app から移設）。
 *
 * 仕様: legacy/spec-tools/lib/sql/refusal-codes.ts（語の正。生成される plpgsql が使う）
 *       framework/runtime/src/refusal/refusal-codes.ts（実行時側の唯一の写し）
 *
 * 2 つはビルドの境界を跨ぐので、実行時パッケージから検証器・生成器の定数を import して使うことは
 * できない（製品のバンドルに道具が混ざる）。**写しを持つこと自体は避けられない**ので、
 * 代わりに「写しがずれていないこと」をここで機械が見る —— ずれると「DB は 403 のつもり・
 * アプリは競合と読む」が黙って作れる（`constraint-invariants.ts` と同じ構えの 1 表）。
 *
 * 製品側（app）が道具の木を import すると B14 が落ちる。この突合の居場所は、借りる向き
 * （道具 → 実行時パッケージ）の側である。DB は使わない（純粋な文字列の突合）。
 */

import { describe, expect, it } from 'vitest';
import {
  REFUSAL_CODES,
  REFUSAL_ENGINE_REASONS,
  REFUSAL_KINDS,
  REFUSAL_MESSAGE_PREFIXES,
} from '../../lib/sql/refusal-codes.js';
import { REFUSALS, refusalCodeOfReason } from '@kaninabe/runtime/refusal/refusal-codes';

describe('拒否の分類の語（検証器・生成器の refusal-codes ⇔ 実行時パッケージの refusal-codes）', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-REFUSALCODES-001
  it('errcode と接頭辞の組が過不足なく一致する', () => {
    // **突合の鍵は errcode である**（分類の名前は検証器・生成器の側が `guard`、実行時パッケージの側が結末の語
    // `guard_unsatisfied` と、読む相手が違うので一致しない）。DB とアプリが同じ 1 つの合図を
    // 同じ意味で読むことが要点であり、その合図は errcode そのものである。
    const fromApp = Object.fromEntries(REFUSALS.map((refusal) => [refusal.code, refusal.prefix]));
    const fromDocs = Object.fromEntries(
      REFUSAL_KINDS.map((kind) => [REFUSAL_CODES[kind], REFUSAL_MESSAGE_PREFIXES[kind]]),
    );
    expect(fromApp).toEqual(fromDocs);
  });

  it('errcode は分類ごとに違う（同じ符号を 2 つの意味に使っていない）', () => {
    const codes = REFUSAL_KINDS.map((kind) => REFUSAL_CODES[kind]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-REFUSALCODES-002
  it('エンジンの拒否理由 → errcode の写像が過不足なく一致する', () => {
    // **engine の理由から errcode を引く経路は 1 表だけである**（束 ⑳-5a-b）。一致の証明
    // （`@kaninabe/runtime/testing/equivalence/oracle`）が別表を持っていたころ、`invalid_from → UC409` はどの 1 表にも無く、
    // doc が約束していた突合も存在しなかった（独立レビュー 1-d）。
    const fromApp = Object.fromEntries(REFUSALS.map((refusal) => [refusal.code, [...refusal.reasons]]));
    const fromDocs = Object.fromEntries(
      REFUSAL_KINDS.map((kind) => [REFUSAL_CODES[kind], [...REFUSAL_ENGINE_REASONS[kind]]]),
    );
    expect(fromApp).toEqual(fromDocs);
  });

  it('一致の証明が引く関数は、その 1 表からしか答えない', () => {
    for (const kind of REFUSAL_KINDS) {
      for (const reason of REFUSAL_ENGINE_REASONS[kind]) {
        expect(refusalCodeOfReason(reason)).toBe(REFUSAL_CODES[kind]);
      }
    }
    expect(refusalCodeOfReason('not_a_reason')).toBeUndefined();
  });
});
