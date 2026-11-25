/**
 * V2(参照整合)のうち、entity_spec の **`context` 宣言の接地**を見る部分。
 *
 * `context` の値は「この行 1 つから、相手のエンティティの行 1 つへ辿る道」であり、ガード式・
 * binding・`scope: context(...)`・query_spec の**スコープ条件**がすべてここから導かれる。ここが無検査だと
 * 「実在しない列」「向きが逆の関係」の上に可視性が積み上がるため、値の形・向き・型まで見る。
 *
 * パス解決の共通部品(索引・Finding ファクトリ・フィールド実在判定)は v2-paths.ts にある。
 * Finding の verifier はどちらも V2 である(利用者から見れば 1 つの検査)。
 */

import type { EntitySpec, FieldDef, FieldType } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { fieldReason, refError, type RefIndex } from './v2-paths.js';

/** context の値として書ける参照パスの形(`{エンティティ名}.{フィールド名}` の 2 段固定)。 */
const CONTEXT_PATH_PATTERN = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

/** フィールド型を仕様の書き方(`ref(workshop)` 等)に戻す。メッセージに出すためだけに使う。 */
function typeText(type: FieldType): string {
  if (type.kind === 'ref') return `ref(${type.entity})`;
  if (type.kind === 'state') return `state(${type.machine})`;
  if (type.kind === 'enum') return `enum([${type.values.join(', ')}])`;
  return type.kind;
}

/**
 * entity_spec の `context` の値を検査する。
 *
 * `context` は「この行 1 つから、相手のエンティティの行 1 つへ辿る道」の宣言であり、
 * ガード式・binding・`scope: context(...)`・query_spec の**スコープ条件**がすべてここから導かれる。
 * 書けるのは **自エンティティのフィールドから相手を指す前方参照**だけとする。
 *
 * - 起点は必ず自エンティティ(`{自分}.{フィールド}`)。相手側の列から自分を指す**逆参照**
 *   (`reservation.event_id` を event の context に書く形)は書けない。逆参照は 1:N であって
 *   「1 行 → 1 行」の解決にならず、そこに乗る読み取り仕様の返す集合が静かに多対多になるためである
 *   (Cheers ストレステスト第 3 弾 C-2)。必要になったら DSL 拡張として ADR で判断する。
 * - 相手が自分自身でない場合、そのフィールドの型は `ref({相手})` でなければならない。
 *   型まで見ることで「実在するが別のものを指している」列(綴りが近い外部キーの取り違え)も落ちる。
 * - 相手が自分自身(`workshop: workshop.id` のような自己参照)は**主キー相当の列**
 *   (`uuid` かつ `auto: true`)を指していなければならない。自己参照は「自分の行そのもの」の
 *   解決であり、外部キー列を指していれば別のエンティティの行に届いてしまう。
 *
 * @param entity 検査対象の entity_spec
 * @param index 参照可能な名前の索引
 * @returns context の宣言ごとの Finding(すべて健全なら空)
 */
export function checkContextDeclarations(entity: EntitySpec, index: RefIndex): Finding[] {
  const findings: Finding[] = [];
  for (const [key, path] of Object.entries(entity.context)) {
    const finding = checkContextEntry(entity, key, path, index);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

/** context の 1 エントリ(`{相手}: {参照パス}`)を検査する。違反が無ければ undefined。 */
function checkContextEntry(
  entity: EntitySpec,
  key: string,
  path: string,
  index: RefIndex,
): Finding | undefined {
  const base = { entity: entity.entity, context_key: key, path };
  const forwardHint =
    `context には「自分の行から相手を辿る前方参照」だけを書けます` +
    `(例: ${key}: ${entity.entity}.${key}_id、その列の型は ref(${key}))。`;

  const matched = CONTEXT_PATH_PATTERN.exec(path.trim());
  if (matched === null) {
    return refError(
      `${entity.entity} の context.${key} "${path}": "{エンティティ名}.{フィールド名}" 形式ではありません`,
      entity.location,
      forwardHint,
      base,
    );
  }
  const [, root = '', fieldName = ''] = matched;
  if (root !== entity.entity) {
    return refError(
      `${entity.entity} の context.${key} "${path}": 参照パスの起点が ${entity.entity} ではありません`,
      entity.location,
      `${forwardHint}相手側の列から自分を指す逆参照(1:N)は、1 行 → 1 行の解決にならないため書けません。` +
        `その関係の上に乗る読み取り仕様の返す集合が静かに多対多になります。`,
      base,
    );
  }
  const missing = fieldReason(entity, fieldName);
  if (missing !== undefined) {
    return refError(
      `${entity.entity} の context.${key} "${path}": ${missing}`,
      entity.location,
      `${entity.entity} の fields に ${fieldName} を追加するか、実在するフィールドへ直してください。${forwardHint}`,
      base,
    );
  }
  const field = entity.fields.find((f: FieldDef) => f.name === fieldName);
  if (key === entity.entity) return selfReferenceFinding(entity, key, path, field, base);

  if (!index.entities.has(key)) {
    return refError(
      `${entity.entity} の context.${key}: エンティティ ${key} が未定義です`,
      entity.location,
      `specs/domain/${key}/entity.md を追加するか、context のキーを既存のエンティティ名に直してください。`,
      base,
    );
  }
  if (field === undefined || (field.type.kind === 'ref' && field.type.entity === key)) return undefined;
  return refError(
    `${entity.entity} の context.${key} が指す ${path} は ref(${key}) 型ではありません` +
      `(型: ${typeText(field.type)})`,
    entity.location,
    `${key} へ辿るには ref(${key}) 型のフィールドを指す必要があります。` +
      `参照先を正しい外部キー列に直すか、${entity.entity} に ref(${key}) 型のフィールドを追加してください。`,
    { ...base, field_type: typeText(field.type) },
  );
}

/**
 * 自己参照(`workshop: workshop.id`)が主キー相当の列を指しているかを見る。
 * 外部キー列を指していると「自分の行」ではなく別のエンティティの行に届いてしまう。
 */
function selfReferenceFinding(
  entity: EntitySpec,
  key: string,
  path: string,
  field: FieldDef | undefined,
  base: Readonly<Record<string, string>>,
): Finding | undefined {
  if (field === undefined || (field.type.kind === 'uuid' && field.auto)) return undefined;
  return refError(
    `${entity.entity} の context.${key} が指す ${path} は主キー相当の列(uuid かつ auto: true)ではありません`,
    entity.location,
    `自己参照は「自分の行そのもの」を指す宣言です。${entity.entity} の主キー列(例: ${entity.entity}.id)へ直してください。` +
      `外部キー列を指すと、解決先が別のエンティティの行になります。`,
    { ...base, field_type: typeText(field.type), auto: String(field.auto) },
  );
}
