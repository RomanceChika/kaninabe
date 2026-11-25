/**
 * entity_spec の `personal` 宣言 → 監査ペイロード期待表
 * (`app/src/domain/generated/personal-expectations.ts`)の生成器。
 *
 * 「個人データは宣言し、監査ログには書かない」(docs/design/security-surface-proposal.md §3)を
 * 実装する閉世界。insert_* / update_* RPC(supabase/migrations)は、この表に載っている列の
 * **値**を `domain_events.payload` に書かず、変わった列名だけを `redacted` に残す
 * 。
 *
 * 入力は entity_spec のみ(手順 1 の設計凍結どおり)。table ごとに `personal: true` の列を
 * 列挙し、`personal_placeholder`(手順 2 の anonymize が使う置換値。文字列 または NOT NULL
 * でない列向けの null)を添える。全 entity_spec を対象にするので、personal な列が 0 の
 * テーブルも空配列で載る(閉世界 — 見張りテストが「この表はどうなっているか」を欠かさず判定できる)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { EntitySpec, SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { pluralizeEntity } from '../../model/table-name.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'personal-expectations.ts');

/**
 * 全 entity_spec から個人データ列の期待表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/personal-expectations.ts`(全体生成)。
 */
export const personalExpectationsGenerator: DocGenerator = {
  id: 'code-personal-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const entities = [...model.aggregates.values()]
      .map((specs) => specs.entity)
      .filter((entity): entity is EntitySpec => entity !== undefined);
    if (entities.length === 0) return [];

    const personalColumns: Record<string, LiteralValue> = {};
    for (const entity of entities) {
      const table = entity.table ?? pluralizeEntity(entity.entity);
      personalColumns[table] = entity.fields
        .filter((field) => field.personal)
        .map((field) => ({
          column: field.name,
          placeholder: field.personalPlaceholder === undefined ? null : field.personalPlaceholder,
        }));
    }

    const specFiles = [...new Set(entities.map((entity) => entity.location.file))].sort((a, b) =>
      a.localeCompare(b),
    );

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(personalColumns, specFiles),
        wholeFile: true,
      },
    ];
  },
};

/** 期待表のファイル全体を組み立てる。 */
function renderFile(
  personalColumns: Readonly<Record<string, LiteralValue>>,
  specFiles: readonly string[],
): string {
  return [
    generatedHeader(specFiles),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '`personal: true` の 1 列分の期待。',
      '`placeholder` は手順 2(anonymize)が書く置換値(文字列。一意制約のある列は `{id}` を含む)。',
      'NOT NULL でない列は null(手順 1 では宣言のみで、まだどこからも使われない)。',
    ]),
    'export interface PersonalColumnExpectation {',
    '  readonly column: string;',
    '  readonly placeholder: string | null;',
    '}',
    '',
    docComment([
      'テーブル名 → `personal: true` の列の完全集合(閉世界)。',
      '',
      '入力は entity_spec のみ(security-surface-proposal.md §3)。personal な列が 0 のテーブルも',
      '空配列で載る。insert_* / update_* RPC(supabase/migrations)はここに載っている列の値を',
      '`domain_events.payload` に書かず、変わった列名だけを `redacted` に残す。見張りテスト',
      '(app/src/infrastructure/__tests__/guarantees/audit-no-personal-data.test.ts)がこの表を',
      '表駆動で回し、番兵値を書き込んで payload のどこにも現れないことを確かめる。',
    ]),
    `export const personalColumns: Readonly<Record<string, readonly PersonalColumnExpectation[]>> = ${frozen(renderLiteral(personalColumns))};`,
    '',
  ].join('\n');
}
