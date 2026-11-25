/**
 * invariant_spec → 不変条件の言明表(`app/src/domain/generated/invariants.ts`)の生成器。
 *
 * ## なぜ要るのか
 *
 * `ActionError` の `invariant_violated` は不変条件 ID(`INV-VENUE-002`)しか運ばない。
 * 画面はそれをそのまま出しており、**利用者には「INV-VENUE-002」としか見えない**。
 * 文言を画面が持てば仕様と表示が二重管理になり(状態の `label` を画面に書き写すのと同じ問題)、
 * かといって ID のままでは「使用中のため削除できません」が誰にも伝わらない。
 *
 * 答えは `label` と同じである —— **言明はすでに仕様にある**(`statement`)。生成物として
 * 実装へ渡し、画面は import するだけにする。**画面は文言を発明しない**という規律が保たれ、
 * 仕様の言明を直せば表示も直る。
 *
 * 語彙の閉世界としても効く: `invariantIds` に無い ID を実装が使うことは型で書けない
 * (`ActionError.invariant` はいまのところ `string` だが、突き合わせる相手がここにできる)。
 *
 * ## 相手の端の断りの文言()
 *
 * 参照の欄が指す行を読む条件の相手の端が断るとき、DB は断った端の名前と件数を detail で運ぶ(実行時の分類が `edge` に写す)。画面は
 * 宣言の表示名から生成した文言(`counterpartRefusals`。字面の本体は `model/data/ref-check-refusal.ts` で、DB の本文と同じ 1 本)に件数を
 * 挟んで出す。DB の自由な文言は画面へ運ばない。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { counterpartRefusalOf } from '../../model/data/ref-check-refusal.js';
import { refCounterpartsOf } from '../../model/data/ref-check-shape.js';

/** 出力先(リポジトリルート相対)。全集約で 1 ファイル。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'invariants.ts');

/**
 * 全集約の invariant_spec から言明表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/invariants.ts`(全体生成)。
 */
export const invariantStatementsGenerator: DocGenerator = {
  id: 'code-invariants',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const statements: Record<string, LiteralValue> = {};
    const files: string[] = [];
    for (const specs of model.aggregates.values()) {
      const spec = specs.invariants;
      if (spec === undefined) continue;
      files.push(spec.location.file);
      for (const invariant of spec.invariants) statements[invariant.id] = invariant.statement;
    }
    if (Object.keys(statements).length === 0) return [];
    const tables = ctx.dataTables?.available === true ? ctx.dataTables.tables : [];
    const refusals: Record<string, LiteralValue> = {};
    for (const table of tables) {
      for (const end of refCounterpartsOf(table, model, tables)) {
        const refusal = counterpartRefusalOf(end);
        refusals[end.name] = { before: refusal.before, after: refusal.after };
      }
    }

    return [{ file: outputFile(ctx.roots), content: renderFile(statements, files.sort(), refusals), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(
  statements: Readonly<Record<string, LiteralValue>>,
  specFiles: readonly string[],
  refusals: Readonly<Record<string, LiteralValue>>,
): string {
  return [
    generatedHeader(specFiles),
    '',
    docComment([
      '不変条件 ID → その言明（invariant_spec の `statement`）。',
      '',
      '**画面はこの表から文言を引く。** 仕様に既にある言葉なので、画面が言い換えを持つと',
      '仕様と表示が二重管理になる（状態の `label` と同じ理由）。言明を直せば表示も直る。',
      '',
      '`ActionError` の `invariant_violated` が運ぶのは ID だけであり、',
      '人が読める形にする責務はこの表が受け持つ。',
    ]),
    `export const invariantStatements = ${renderLiteral(statements)} as const;`,
    '',
    docComment(['宣言されている不変条件 ID（仕様に実在する ID の値域）。']),
    'export type InvariantId = keyof typeof invariantStatements;',
    '',
    docComment([
      '不変条件 ID を人が読める言明にする。',
      '',
      '宣言に無い ID は**言い換えずそのまま返す**。仕様に実在しない ID を実装が宣言している',
      '状態であり（PRIN-0008 違反）、それを画面が「不明な不変条件です」と塗り潰すと、',
      'どの ID だったかが失われて追跡できなくなる。',
      '',
      '@param id - 不変条件 ID（`INV-*`）',
      '@returns 仕様の言明。宣言に無ければ ID そのもの',
    ]),
    `export function invariantStatement(id: string): string {
  const statements: Readonly<Record<string, string>> = invariantStatements;
  return statements[id] ?? id;
}`,
    '',
    docComment([
      '相手の端のトリガ名 → 断りの文言の件数の前後(参照の欄が指す行を読む条件。宣言の表示名から生成。DB の本文と同じ字面)。',
    ]),
    `export const counterpartRefusals: Readonly<Record<string, { readonly before: string; readonly after: string }>> = ${renderLiteral(refusals)};`,
    '',
    docComment([
      '相手の端の断りを、件数を挟んだ人の言葉にする(行の中身や id は含まない)。',
      '',
      '@param trigger - 断った相手の端のトリガ名(DB の detail が運ぶ)',
      '@param count - この決まりに合わない自表の行の数',
      '@returns 文言。生成物に無いトリガ名なら undefined(呼び手は言明に倒す)',
    ]),
    `export function counterpartRefusalText(trigger: string, count: number): string | undefined {
  const refusal = counterpartRefusals[trigger];
  return refusal === undefined ? undefined : \`\${refusal.before}\${String(count)}\${refusal.after}\`;
}`,
    '',
  ].join('\n');
}
