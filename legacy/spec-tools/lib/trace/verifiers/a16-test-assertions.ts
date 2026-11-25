/**
 * A16 注釈付きテストの**中身**(assert があるか・母集合が空でも緑にならないか)。
 *
 * action-spec-writing.md の A16:「`@tc` の注釈を持つテストブロックは assert を 1 つ以上持ち、
 * その assert がループの中だけに無いこと」。
 *
 * **なぜ要るのか。** 「注釈 + テスト名 + ファイル」の 3 点は Z1 / A6 / A12 が完全に閉じていた
 * が、`it` の中身は誰も見ていなかった —— 検査の漏れ探し 2026-09-12 §5 の実測では、
 * `rls-enabled.test.ts` の `expect(` を全て潰しても `verify` はエラー 0 / 警告 25 のままで、
 * 仕様側は「見張りテストあり」と数え続けた。**テストの存在を数える仕組みは、テストが何も
 * 確かめていない状態と区別が付かない**。保証台帳(Z 群)と見張りテストの体系は、この下限が
 * 無いと主張だけの目録になる。
 *
 * 2 段で見る。
 *   - **error**: assert が 1 つも無い(`expect(` の直接呼び出しも、`expect` を含むヘルパへの
 *     呼び出しも無い)。
 *   - **warning**: assert はあるが**そのすべてがループの中**にある。母集合が空になった日に
 *     黙って緑になる形である(実測で注釈付き 10 件。全て「宣言と状態機械の交差だけが
 *     ボタンになる」型で、母集合は生成物の `{machine}.states`)。ループの外に
 *     `expect(items).not.toHaveLength(0)` のような非空の主張を 1 行置けば消える。
 *     **ヘルパ呼び出しも assert として数える**(独立レビュー 束 ㉑ の 2-C)—— 「ループの中で
 *     `expectCalls(...)` を呼ぶだけ」のブロックは、直接 assert が無いので error 段はヘルパ免除で
 *     抜け、warning 段は「直接 assert がある」が偽で成立せず、2 段のどちらにも掛からなかった。
 *
 * 構文が読めなかったブロック(`readable: false`)は中身を判定しないが、**黙りもしない** ——
 * 件数を warning で 1 件にまとめて出す。注釈の位置は「`it` の直前の行」に規約で固定してあり
 * (A12 が error で執行する)、それでも読めない形が残るなら検査の下限がそこで切れている
 * ことを人が知るべきである(束 ㉑ の 2-B。以前は注釈を 1 行下げるだけで A16 を外せた)。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { assertionFindings } from '../../testcase/index.js';
import type { TraceInput } from '../input.js';

/** A16: 注釈付きテストが何かを確かめていることを検証する。 */
export const testAssertionsVerifier: TraceVerifier = {
  id: 'A16',
  title: '注釈の中身 — 注釈付きテストは assert を持ち、母集合が空でも緑にならない',

  verify(input: TraceInput): Finding[] {
    // 実装がまだ無い(app/ を読めない)構成では判断材料が無い(A12 と同じ扱い)。
    if (!input.tests.available) return [];
    return assertionFindings(input.tests.testBlocks ?? [], input.tests.assertionHelpers ?? [], 'A16');
  },
};
