/**
 * エンティティのフィールドの表示名の表(`{entity}FieldLabels`)の**字面**(entity_spec の `fields[].label`)。
 *
 * 書き込み規則(`access_spec` の `writes`)の有無に依らず、**entity_spec を持つ全エンティティ**に出す
 * (束 画面 3a)。表・詳細の見出しは読むだけの集約(`invitation` / `public_workshop` …)の欄も引くので、
 * 表が `writes` を持つ集約だけにあると見出しの正が欄ごとに別の場所になる。出力先は `{entity}.labels.ts`
 * (表示名の表の置き場。`code-labels.ts` が状態・イベント・enum の表示名と一緒に 1 ファイルに書く —
 * 1 ファイル 1 生成器の規約のため、字面をここに分けて呼ばれる)。
 *
 * label を宣言していないフィールドはキーを持たない(生成物は仕様の写像であり、無い値を発明しない)。
 * 規約どおりファイル I/O はしない純粋関数である。
 */

import type { EntitySpec } from '../../model/types.js';
import { docComment, renderLiteral, toCamelCase } from '../../gen-kit/code-emit.js';

/**
 * フィールドの表示名の表(宣言順に、label を持つフィールドだけ)。
 *
 * @param entity entity_spec
 * @returns ソースの行(doc コメント + `export const {entity}FieldLabels`)
 */
export function renderFieldLabels(entity: EntitySpec): string[] {
  const labels: Record<string, string> = {};
  for (const field of entity.fields) {
    if (field.label !== undefined) labels[field.name] = field.label;
  }
  return [
    docComment([
      `${entity.entity} のフィールドの表示名(entity_spec の fields[].label)。`,
      '画面は writableFields が返すフィールド名(内部名)や表・詳細の欄で配線し、表示文字列はこの表から引く。',
      `label を宣言していないフィールドはキーを持たない。仕様: ${entity.location.file}`,
    ]),
    `export const ${toCamelCase(entity.entity)}FieldLabels = ${renderLiteral(labels)} as const;`,
  ];
}
