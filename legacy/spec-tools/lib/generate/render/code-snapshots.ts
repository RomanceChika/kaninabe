/**
 * state_spec の `effects[].snapshot` → スナップショット写像表
 * (`app/src/domain/generated/snapshots.ts`)の生成器(C-29)。
 *
 * 公開時Fix の写像は「どの列をどこへ写すか」の対応表である。実装(公開の遷移が呼ぶ RPC と、
 * その引数を組み立てる純関数)は**この表が持つ列だけ**を書き、列の並びを手で持たない。
 * app 側のテストがこの表と実際に書いた列を突き合わせるので、仕様に列を足して実装を直し忘れると
 * 赤になる —— V12 が仕様の内側を、この表が仕様と実装の間を見る。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 写像表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'snapshots.ts');

/**
 * 全 state_spec の `effects[].snapshot` から写像表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/snapshots.ts`(ドメイン全体で 1 ファイル・全体生成)。
 */
export const snapshotMapGenerator: DocGenerator = {
  id: 'code-snapshots',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const byEvent: Record<string, LiteralValue> = {};
    const sources = new Set<string>();
    for (const specs of model.aggregates.values()) {
      for (const machine of specs.stateMachines) {
        for (const effect of machine.effects) {
          const snapshot = effect.snapshot;
          if (snapshot === undefined) continue;
          sources.add(machine.location.file);
          const key = `${machine.machine}.${effect.on}`;
          const existing = byEvent[key];
          const targets = Array.isArray(existing) ? [...existing] : [];
          targets.push({
            to: snapshot.to,
            fields: snapshot.fields.map((map) => ({ from: map.from, to: map.to })),
          });
          byEvent[key] = targets;
        }
      }
    }
    if (Object.keys(byEvent).length === 0) return [];

    return [{ file: outputFile(ctx.roots), content: renderFile(byEvent, [...sources].sort()), wholeFile: true }];
  },
};

/** 写像表のファイル全体を組み立てる。 */
function renderFile(
  byEvent: Readonly<Record<string, LiteralValue>>,
  specFiles: readonly string[],
): string {
  return [
    generatedHeader(specFiles),
    '',
    docComment(['スナップショット写像の 1 列分(写像元 → 写像先)。式ではなく列の対応表である。']),
    'export interface SnapshotFieldMap {',
    '  /** 写像元。`{entity}.{field}` の 2 段、または予約語 `now`（この写しを作った時刻）。 */',
    '  readonly from: string;',
    '  /** 写像先の列名。 */',
    '  readonly to: string;',
    '}',
    '',
    docComment(['1 つの写像先エンティティへの写し。']),
    'export interface SnapshotTarget {',
    '  /** 写像先のエンティティ名（公開側集約）。 */',
    '  readonly to: string;',
    '  /** 列の対応表（宣言順）。 */',
    '  readonly fields: readonly SnapshotFieldMap[];',
    '}',
    '',
    docComment([
      'ドメインイベント（`{machine}.{event}`）→ その遷移が作るスナップショットの写像表。',
      '',
      '**実装はこの表が持つ列だけを書く。** 列の並びを実装が手で持つと、公開側に列を足したときに',
      '仕様（V12 の覆い検査）は鳴るのに実装が古いまま、という食い違いが生まれる。',
      '写す値の**変換**（匿名化・連結・切り詰め）はこの表に無く、副作用 ID の実装が持つ',
      '（その正しさは不変条件とプロパティテストが守る）。',
    ]),
    `export const snapshotMaps = ${renderLiteral(byEvent)} as const satisfies Readonly<
  Record<string, readonly SnapshotTarget[]>
>;`,
    '',
    docComment([
      '同じ表を「イベント ID を変数で引ける形」にしたもの。中身は上の定数と同一で、型だけが広い。',
    ]),
    'export const snapshotMapsByEvent: Readonly<Record<string, readonly SnapshotTarget[]>> =',
    '  snapshotMaps;',
    '',
    docComment([
      '写像先エンティティ 1 つぶんの列名（宣言順）を引く。',
      '',
      '@param event ドメインイベント ID（`{machine}.{event}`）',
      '@param target 写像先のエンティティ名',
      '@returns 宣言された列名。宣言が無ければ空配列',
    ]),
    'export function snapshotColumns(event: string, target: string): readonly string[] {',
    '  const targets = snapshotMapsByEvent[event] ?? [];',
    '  const found = targets.find((candidate) => candidate.to === target);',
    '  return (found?.fields ?? []).map((field) => field.to);',
    '}',
    '',
  ].join('\n');
}
