/**
 * **生成器の変異テスト**の実測(束 ⑳-5c)。製品 + fixture 4 題材の仕様を機械で 1 か所壊し、
 * 生成物・期待・検査のどれかが必ず変わることを見る。
 *
 * 仕様: docs/rules/process/backend/specification/standards/guarantee-spec-writing.md §変異の目録
 *       BACKLOG「外部レビュー の外部レビュー 9 件」⑤(生成器の変異テスト)
 *       目録は `lib/mutation/**`、対応表の生成は `lib/generate/render/book/mutation-section.ts`
 *
 * ここが赤くなる意味は 2 つしかない。
 *   1. **検査に漏れができた** —— どの検査もその変異に気づかない(直し方: 検査を足す。免除しない)
 *   2. 壊し方が仕様として成り立たなくなった(直し方: 変異器を直す)
 *
 * 実 DB は使わない(設計 §1: 実 DB で実行する変異は CI に入れない)。見ているのは
 * 「生成された執行点の本文」「期待の中身」「検査の Finding」という**シミュレーション上の観測**である。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../lib/guard/services.js';
import { loadSpecModel } from '../../lib/model/loader.js';
import { loadActionSpecModel } from '../../lib/model/trace/loader.js';
import { loadDataTableSpecModel } from '../../lib/model/data/loader.js';
import { loadJobSpecModel } from '../../lib/model/job/loader.js';
import { ALL_MUTATION_OPERATORS } from '../../lib/mutation/operators.js';
import { ALL_MUTATION_DETECTORS } from '../../lib/mutation/detectors.js';
import { mutationRows, mutationSubjectOf, operatorsWithoutSite } from '../../lib/mutation/matrix.js';
import { exemptedOf, holesOf, namedOf } from '../../lib/kernel/mutation-report.js';
import type { MutationSubject } from '../../lib/mutation/types.js';
import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import { TEST_ROOTS } from '../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../helpers/platform.js';

/** このリポジトリのルート(`legacy/spec-tools/__tests__/mutation` から 4 段上)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** fixture の置き場。 */
const SAMPLES_ROOT = fileURLToPath(new URL('../fixtures/samples/', import.meta.url));

/** 題材(ホスト + fixture 4 題材)。 */
const SUBJECTS: readonly { readonly name: string; readonly specs: string }[] = [
  { name: 'host', specs: path.join(REPO_ROOT, 'docs/specs') },
  // `archive` は**可視性に状態の条件(`reads[].when`)を持つ唯一の題材**である(束 §14)。
  // ホストにその宣言が 1 つも無いので、ここに居なければ `drop_read_when` はどの題材でも
  // 壊す場所を持たず、「捕られるか」を 1 度も measure しないまま緑になる。
  { name: 'archive', specs: path.join(SAMPLES_ROOT, 'archive/docs/specs') },
  { name: 'expenses', specs: path.join(SAMPLES_ROOT, 'expenses/docs/specs') },
  { name: 'library', specs: path.join(SAMPLES_ROOT, 'library/docs/specs') },
  { name: 'rooms', specs: path.join(SAMPLES_ROOT, 'rooms/docs/specs') },
  { name: 'stores', specs: path.join(SAMPLES_ROOT, 'stores/docs/specs') },
];

/**
 * 題材 1 つを読む(CLI と同じローダーで、仕様だけを読む —— app は見ない)。
 *
 * @param name 題材の名前
 * @param specs `docs/specs` の絶対パス
 * @returns 変異テストに渡す材料(読めなければ null)
 */
function loadSubject(name: string, specs: string): MutationSubject | null {
  const options = { repoRoot: REPO_ROOT } as const;
  const { model } = loadSpecModel(path.join(specs, 'domain'), options);
  if (model === null) return null;
  const guards = createGuardServices();
  const actions = loadActionSpecModel(path.join(specs, 'backend/actions'), options).model ?? undefined;
  const dataTables = loadDataTableSpecModel(path.join(specs, 'backend/data/tables'), options).model ?? undefined;
  const jobs = loadJobSpecModel(path.join(specs, 'backend/jobs.md'), options).model ?? undefined;
  const context = {
    repoRoot: REPO_ROOT,
    roots: TEST_ROOTS,
    platform: TEST_PLATFORM, layout: TEST_LAYOUT,
    guards,
    ...(actions === undefined ? {} : { actions }),
    ...(dataTables === undefined ? {} : { dataTables }),
  } as GenerateContext;
  return mutationSubjectOf({ name, model, guards, actions, dataTables, jobs, context });
}

/** 全題材の実測(1 度だけ実行して共有する)。 */
const measured = SUBJECTS.map((entry) => {
  const subject = loadSubject(entry.name, entry.specs);
  return {
    name: entry.name,
    subject,
    rows: subject === null ? [] : mutationRows(subject),
    withoutSite: subject === null ? [] : operatorsWithoutSite(subject.model),
  };
});

describe('生成器の変異テスト', () => {
  for (const entry of measured) {
    describe(entry.name, () => {
      it('仕様を読めている', () => {
        expect(entry.subject).not.toBeNull();
        expect(entry.rows.length).toBeGreaterThan(0);
      });

      it('どの変異も、捕られるか・検査器が報告するか・宣言された例外である(それ以外は検査の漏れ)', () => {
        const uncaught = holesOf(entry.rows).map((row) => `${row.operator}: ${row.at}`);
        expect(uncaught, '捕る検査が無い変異(= 検査の漏れ。免除ではなく検査を足して直す)').toEqual([]);
      });

      it('捕られなかった変異の分類は、仕様の宣言か検査器の警告に接地している', () => {
        // 捕られなかった変異が 0 件なのは正しい状態なので、確かめるのは母集合(変異が実際に走った)が空でないことである(15 回目 C15-2)。
        expect(entry.rows.length).toBeGreaterThan(0);
        for (const row of [...namedOf(entry.rows), ...exemptedOf(entry.rows)]) {
          // 報告された漏れは検査器 ID を、宣言された例外は見張りテストの宣言を必ず持つ
          // (どちらも根拠が空なら、それは自由記述の免除である)。
          const grounded =
            row.named !== undefined ? row.named.verifier.length > 0 : (row.exemption?.canaries.length ?? 0) > 0;
          expect(grounded, `${row.operator}: ${row.at}`).toBe(true);
        }
      });

      it('壊せる場所が無かった変異器は、その宣言をこの仕様が持たないものだけ', () => {
        const attempted = new Set(entry.rows.map((row) => row.operator));
        for (const operator of ALL_MUTATION_OPERATORS) {
          const tried = attempted.has(operator.id);
          expect(tried || entry.withoutSite.includes(operator.id), operator.id).toBe(true);
        }
      });
    });
  }

  it('変異器すべてに、少なくとも 1 題材で壊せる場所がある(目録が空振りしない)', () => {
    const attempted = new Set(measured.flatMap((entry) => entry.rows.map((row) => row.operator)));
    expect([...attempted].sort()).toEqual(ALL_MUTATION_OPERATORS.map((operator) => operator.id).sort());
  });

  it('可視性の状態の条件を落とす変異は、執行点(RLS の本文)と期待の入力の両方が捕る(束 §14)', () => {
    // `reads[].when` は**行が返るかどうか**を決める宣言なので、落ちるべきは
    // ポリシーの本文(執行点)と、挙動テストの期待の入力(world の設計図)である。
    // 「検査の Finding」が動かないことも意味がある —— 条件を落としても仕様としては
    // 成り立つ(だから静かに通る)。執行点が動くことだけが検査になる。
    const rows = measured.flatMap((entry) => entry.rows).filter((row) => row.operator === 'drop_read_when');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect([...row.caughtBy].sort(), row.at).toEqual(['rls_policy', 'rls_world']);
    }
  });

  it('未ログインの作成の天井(abuse)を落とす変異は、執行点(DDL に出るトリガ本文の消失)と検査(R5)の両方が捕る(B4-1b の二重)', () => {
    // 天井は宣言だけでは嘘になる —— 生成器がトリガの本文を出すので、宣言を消せば DDL の本文が消える(執行点の側の目)。
    // 同じ変異を R5-1(全体の天井が無い)も捕る(検査の側の目)。どちらかだけが捕る形にしない。
    const rows = measured.flatMap((entry) => entry.rows).filter((row) => row.operator === 'drop_abuse_ceiling');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.caughtBy, row.at).toEqual(expect.arrayContaining(['ddl', 'risk']));
    }
  });

  it('どの検査も、少なくとも 1 つの変異を捕る(飾りの列を作らない)', () => {
    const caught = new Set(measured.flatMap((entry) => entry.rows.flatMap((row) => row.caughtBy)));
    for (const detector of ALL_MUTATION_DETECTORS) {
      expect(caught.has(detector.id), `${detector.id} はどの変異も捕らなかった`).toBe(true);
    }
  });
});
