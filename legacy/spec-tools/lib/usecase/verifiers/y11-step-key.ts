/**
 * Y11 手順の鍵(別名 `as`。書かなければ操作 ID)が保存点の中で一意。
 *
 * usecase-spec-writing.md の要求:「同じ操作を 1 つの保存点で 2 回以上書くときは `as` で
 * 別名を付ける。鍵は保存点の中で一意であること」。
 *
 * **なぜ一意でなければならないのか。** 鍵は複合 RPC の `p_input` と戻り値・入力スキーマ
 * (`usecase-inputs.ts`)・実行計画・1 画面フォームの節と testid の**すべて**で使われる。
 * 重なると、後から来た手順が前の手順の入力を上書きする形の生成物になり、**片方の手順の
 * 入力がどこからも渡らない**(しかも SQL としては通る)。Y7 が migration の名前の一意性を
 * 見るのと同じ理由で、名前が衝突したら仕様の時点でエラーにする。
 */

import type { Finding } from '../../kernel/finding.js';
import type { UsecaseInput } from '../derive.js';
import type { UsecaseSaveDecl, UsecaseSpec } from '../../model/usecase/types.js';
import { stepKey } from '../../model/usecase/types.js';
import { usecaseFinding, type UsecaseVerifier } from '../verifier.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'Y11';

/** Y11 の実装。 */
export const stepKeyVerifier: UsecaseVerifier = {
  id: VERIFIER_ID,
  title: '手順の鍵(別名 as。無ければ操作 ID)が保存点の中で一意',

  verify(input: UsecaseInput): Finding[] {
    if (!input.usecases.available) return [];
    return input.usecases.usecases.flatMap((usecase) =>
      usecase.saves.flatMap((save) => checkSave(usecase, save)),
    );
  },
};

/** 保存点 1 つ分の鍵の一意性を見る。 */
function checkSave(usecase: UsecaseSpec, save: UsecaseSaveDecl): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, string>();
  for (const step of save.steps) {
    const key = stepKey(step);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, step.op);
      continue;
    }
    findings.push(
      usecaseFinding(VERIFIER_ID, {
        message: `保存点 ${save.id} の手順の鍵 ${key} が重複しています(先に ${first} が使っています)`,
        location: step.location,
        suggestion:
          '同じ操作を 1 つの保存点で 2 回以上実行するときは、手順ごとに別の "as: {別名}" を書く' +
          '(鍵は入力・結果・フォームの節・testid の名前になるので、重なると片方の入力が渡らない)',
        counterexample: { usecase: usecase.name, save: save.id, key, op: step.op, first },
      }),
    );
  }
  return findings;
}
