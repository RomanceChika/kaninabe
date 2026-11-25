/**
 * 正典(`guarantee-spec-writing.md` §変異の目録)が挙げる**検査の一覧**と、実際に登録されて
 * いる `ALL_MUTATION_DETECTORS` の突合。
 *
 * 対応表(`docs/book/guarantees.md` の変異 × 検査)は生成物なので、検査を 1 つ足せば列が 1 本
 * 増える。ところが**列の正を宣言しているのは規約文書の側**であり、そこは生成物ではないので
 * 黙って腐る —— 束 ㉓ で 6 つ目の検査(`ddl`)を足したとき、実際に一覧が 5 つのまま残った
 * (独立レビュー B-2)。`matrix-range-parity.test.ts` が enforcement-matrix の範囲表記を
 * 登録配列と突き合わせるのと同じ流儀で、ここは**検査の題名が規約文書に現れること**を見る。
 *
 * 見るのは題名の字面である —— 検査の `title` は対応表の見出しにそのまま出るので、
 * 規約が同じ語で数えていなければ「人が読む一覧」と「機械が回す一覧」が別物になる。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_MUTATION_DETECTORS } from '../../../lib/mutation/detectors.js';

/** リポジトリルート(このファイルは legacy/spec-tools/__tests__/unit/gates/ にある)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** 変異の目録の正典。 */
const GUARANTEE_SPEC =
  'docs/rules/process/backend/specification/standards/guarantee-spec-writing.md';

/** 検査の題名から、規約文書に現れる語を取り出す(括弧の中は補足なので落とす)。 */
function headline(title: string): string {
  return title.replace(/[((].*$/u, '').trim();
}

describe('guarantee-spec-writing §変異の目録 ⇔ 登録された検査(ALL_MUTATION_DETECTORS)', () => {
  const document = readFileSync(path.join(REPO_ROOT, GUARANTEE_SPEC), 'utf-8');

  it('登録されている検査の題名が、規約の一覧にすべて現れる', () => {
    const missing = ALL_MUTATION_DETECTORS.map((detector) => headline(detector.title)).filter(
      (title) => !document.includes(title),
    );
    expect(missing, '規約の「検査(捕る側)は…」の一覧に足す(検査を増やしたら正典も直す)').toEqual([]);
  });

  it('検査は 1 つ以上あり、ID が重複していない', () => {
    const ids = ALL_MUTATION_DETECTORS.map((detector) => detector.id);
    expect(ids.length).toBeGreaterThan(0);
    expect([...new Set(ids)]).toEqual(ids);
  });
});
