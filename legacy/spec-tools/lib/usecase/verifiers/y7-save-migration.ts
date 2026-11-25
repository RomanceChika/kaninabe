/**
 * Y7 保存点の `migration`(複合 RPC の生成先)の形式と一意性。
 *
 * usecase-spec-writing.md の要求:
 *   - `{14 桁}_usecase_{name}_{save}.sql` の形であること(生成器がこの名前でファイルを書く)
 *   - 全ユースケース・全保存点で一意であること(2 つの保存点が同じファイルを取り合わない)
 *
 * **なぜ名前を仕様に書かせるのか。** migration は追記専用の歴史であり、生成物で上書きできる
 * のは「まだ適用していないファイル」だけである。ファイル名を仕様の宣言にしておくと、
 * SQL が変わる変更をしたときに**名前を新しくする**という 1 手で「旧ファイルは歴史として残し、
 * 新ファイルを生成する」が成立する(migrations.md §生成 migration)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { UsecaseInput } from '../derive.js';
import type { UsecaseSaveDecl } from '../../model/usecase/types.js';
import { usecaseFinding, type UsecaseVerifier } from '../verifier.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'Y7';

/** 先頭の連番(migration の並び順を決める 14 桁)。 */
const SEQUENCE = /^\d{14}$/;

/** Y7 の実装。 */
export const saveMigrationVerifier: UsecaseVerifier = {
  id: VERIFIER_ID,
  title: '保存点の migration(複合 RPC の生成先)の形式と一意性',

  verify(input: UsecaseInput): Finding[] {
    const findings: Finding[] = [];
    const seen = new Map<string, string>();
    for (const usecase of input.usecases.usecases) {
      for (const save of usecase.saves) {
        const expected = `_usecase_${usecase.name}_${save.id}.sql`;
        findings.push(...checkShape(usecase.name, save, expected));
        const first = seen.get(save.migration);
        if (first !== undefined) {
          findings.push(
            usecaseFinding(VERIFIER_ID, {
              message: `migration ${save.migration} が ${first} と重複しています`,
              location: { ...save.location, pointer: `saves.${save.id}.migration` },
              suggestion: '保存点 1 つにつき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
              counterexample: { usecase: usecase.name, save: save.id, migration: save.migration, first },
            }),
          );
          continue;
        }
        seen.set(save.migration, `${usecase.name}.${save.id}`);
      }
    }
    return findings;
  },
};

/** ファイル名が `{14 桁}_usecase_{name}_{save}.sql` の形かを見る。 */
function checkShape(name: string, save: UsecaseSaveDecl, expectedSuffix: string): Finding[] {
  const migration = save.migration;
  const index = migration.indexOf('_');
  const sequence = index === -1 ? '' : migration.slice(0, index);
  if (SEQUENCE.test(sequence) && migration.slice(index) === expectedSuffix) return [];
  return [
    usecaseFinding(VERIFIER_ID, {
      message: `migration ${migration} が保存点から導かれる名前になっていません`,
      location: { ...save.location, pointer: `saves.${save.id}.migration` },
      suggestion:
        `"{14 桁の連番}${expectedSuffix}" の形に直す` +
        '(名前から「どのユースケースのどの保存点か」が一意に読めることが、生成先の唯一の手がかり)',
      counterexample: { usecase: name, save: save.id, migration, expected: `{14 桁}${expectedSuffix}` },
    }),
  ];
}
