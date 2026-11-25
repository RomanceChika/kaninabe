/**
 * invariant_spec の `enforced_by`(db 制約・トリガ)→ **制約名 → 不変条件 ID の 1 表**
 * (`app/src/domain/generated/constraint-invariants.ts`)の生成器。
 *
 * 各リポジトリが手書きしている `CONSTRAINT_TO_INVARIANT` の生成版である。PostgREST は例外の
 * `constraint` フィールドを返さないので、書き込み側は例外の本文から制約名を拾って
 * `invariant_violated` に写す —— その写像表の正は invariant_spec の `enforced_by[].ref` である。
 *
 * 保存点の実行器(`operation/_template/usecase.ts`)は集約をまたいで書くので、**集約ごとの
 * 手書き表では足りない**(1 保存点が entry / entry_participant / piece の制約を同時に踏む)。
 * ここで全集約ぶんを 1 表にまとめる。既存の手書き表の置き換えはこの束では行わない。
 *
 * **表の組み立てと名前の一意性の判定は持たない。** どちらも V10 と共有の 1 本
 * (意味解析の層 `semantics/constraint-owners.ts` の `constraintOwners`)が行い、
 * ここは受け取った表を字面にするだけである —— 判定が 2 実装あると、DB 執行の種別を片方だけに
 * 足したときに「verify は緑のまま generate が止まる」が作れてしまう(束 ⑲-1)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import { constraintOwners } from '../../semantics/constraint-owners.js';
import { ownerConflictOf } from '../../messages/messages-owner-conflict.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 出力先(1 ファイルに全集約ぶん)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'constraint-invariants.ts');

/**
 * 全 invariant_spec から制約名 → 不変条件 ID の表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/constraint-invariants.ts`(ファイル全体)。
 */
export const constraintInvariantsGenerator: DocGenerator = {
  id: 'code-constraint-invariants',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    // 名前の一意性の判定は V10 と共有の 1 本(semantics/constraint-owners.ts の
    // constraintOwners)。ここは表を字面にするだけで、種別の判定を持たない。衝突の文面は
    // V10 と共有の文言の層(`messages/messages-owner-conflict.ts` の `ownerConflictOf`)が持つ。
    const { owner, clashes } = constraintOwners(model);
    if (clashes.length > 0) {
      // V10 が先に見ている前提が破れている = 検査の穴なので、その検査器の ID を示して止める。
      preconditionFailure(
        'V10',
        clashes.map((clash) => {
          const entry = ownerConflictOf(clash);
          return {
            message: entry.message,
            suggestion: entry.suggestion,
            counterexample: entry.counterexample,
            location: entry.invariant.location,
          };
        }),
      );
    }
    if (owner.size === 0) return [];
    const specFiles = [...model.aggregates.values()]
      .map((specs) => specs.invariants?.location.file)
      .filter((file): file is string => file !== undefined)
      .sort((a, b) => a.localeCompare(b));
    return [{ file: outputFile(ctx.roots), content: renderFile(owner, specFiles), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(owner: ReadonlyMap<string, string>, specFiles: readonly string[]): string {
  const table: Record<string, LiteralValue> = {};
  for (const [ref, invariantId] of [...owner].sort(([a], [b]) => a.localeCompare(b))) {
    table[ref] = invariantId;
  }
  return [
    generatedHeader(specFiles),
    '',
    docComment([
      'DB 制約・トリガの名前 → 不変条件 ID(invariant_spec の `enforced_by[].ref`)。',
      '',
      'PostgREST は例外の `constraint` フィールドを載せないので、書き込み側は例外の本文',
      '(message / details / hint)から**この表の鍵**を探して `invariant_violated` に写す。',
      '鍵が本文に出ない書き方をしたトリガは写せない(ARCH-SP-BE-0001 §テーブル仕様)。',
    ]),
    `export const constraintInvariants: Readonly<Record<string, string>> = ${renderLiteral(table)};`,
    '',
    docComment([
      '例外の本文から既知の制約名を探し、対応する不変条件 ID を返す(見つからなければ undefined)。',
      '',
      '**不変条件 ID そのものが本文に出ていても拾う。** トリガの中には制約名ではなく ID を文面の',
      '先頭に置くものがあり(`raise exception \'INV-…-002: …\'`)、制約名だけを探すとその種の',
      'トリガの違反が「想定外の失敗」として例外になる —— 束 ⑰-2 の切り替えで実測した。',
    ]),
    'export function invariantOfMessage(haystack: string): string | undefined {',
    '  const byConstraint = Object.keys(constraintInvariants).find((name) => haystack.includes(name));',
    '  if (byConstraint !== undefined) return constraintInvariants[byConstraint];',
    '  return Object.values(constraintInvariants).find((id) => haystack.includes(id));',
    '}',
    '',
  ].join('\n');
}
