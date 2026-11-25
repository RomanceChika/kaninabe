/**
 * entity_spec の `session: true` 宣言 → セッションプロフィール型
 * (`app/src/domain/generated/session-profile.ts`)の生成器。
 *
 * 「ログインセッション(`app_metadata.profile`)に何を載せるか」は宣言し、実装は
 * 手でキーを書き並べない(手順 1)。V13 が「1 集約にしか付けられない」ことを検査済みなので、
 * ここでは単に `session: true` の列を集めて 1 つの平たい型にする。
 *
 * 入力は entity_spec のみ。`session: true` の列が 0 件でも(まだ何も宣言していない状態でも)
 * 空の型・空の配列を出す(閉世界 — 生成物が「今どうなっているか」を欠かさず言えるようにする)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { EntitySpec, FieldDef, FieldType, SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, tsString } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 生成物の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'session-profile.ts');

/**
 * 全 entity_spec から `session: true` の列を集めて型を生成するジェネレーター。
 * 出力は `app/src/domain/generated/session-profile.ts`(全体生成)。
 */
export const sessionProfileGenerator: DocGenerator = {
  id: 'code-session-profile',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const entities = [...model.aggregates.values()]
      .map((specs) => specs.entity)
      .filter((entity): entity is EntitySpec => entity !== undefined);

    const fields = entities.flatMap((entity) => entity.fields.filter((field) => field.session));
    // V13(1 集約にしか付けられない)を検証済みのモデルでは、session: true を持つ集約は高々 1 つ。
    const sessionEntity = entities.find((entity) => entity.fields.some((field) => field.session));
    const specFiles = [...new Set(entities.map((entity) => entity.location.file))].sort((a, b) =>
      a.localeCompare(b),
    );

    const actorTable = (ctx.dataTables?.tables ?? []).find(
      (table) => table.entity !== undefined && table.entity === sessionEntity?.entity,
    )?.table;
    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(fields, sessionEntity?.entity, actorTable, specFiles, ctx.platform.sessionClaimsPath.join('.')),
        wholeFile: true,
      },
    ];
  },
};

/** FieldType → TypeScript のスカラー型(セッションに載る列は現状すべてスカラーである想定)。 */
function tsScalarType(type: FieldType): string {
  switch (type.kind) {
    case 'uuid':
    case 'string':
    case 'text':
    case 'date':
    case 'datetime':
      return 'string';
    case 'integer':
    case 'decimal':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return type.values.map((value) => tsString(value)).join(' | ');
    case 'ref':
      return 'string';
    case 'state':
      return 'string';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/** ファイル全体を組み立てる。 */
function renderFile(
  fields: readonly FieldDef[],
  sessionEntity: string | undefined,
  actorTable: string | undefined,
  specFiles: readonly string[],
  claimsPath: string,
): string {
  return [
    generatedHeader(specFiles),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      sessionEntity === undefined
        ? `ログインセッション(\`${claimsPath}\`)に載る実行者の欄の型(手順 1)。`
        : `ログインセッション(\`${claimsPath}\`)に載る \`${sessionEntity}\` の欄の型(手順 1)。`,
      '`entity_spec` の `session: true` から導出する(V13: 1 集約にしか付けられない)。',
      'サインイン完了時(composition/sign-in.ts)と `refresh_session_profile` ジョブハンドラの',
      `両方が、この型のキー(\`SESSION_FIELDS\`)だけを \`${claimsPath}\` へ書く。`,
      '書き方の正: docs/rules/process/backend/specification/standards/auth-spec-writing.md §session 属性。',
      '',
      '**`interface` ではなく型の別名で書き出す。** 実行時パッケージ(`@kaninabe/runtime`)は「名前で 1 つ',
      '引ける」ことだけを要求する形(`SessionClaims`)でこれを受けるが、TypeScript は**暗黙の',
      '添字シグネチャを型の別名にだけ与える** —— `interface` にすると同じ形なのに代入できない',
      '(ADR-0013)。欄の閉世界は下の `SESSION_FIELDS` が持つので、別名にしても緩まない。',
    ]),
    'export type SessionProfile = {',
    ...fields.map((field) => `  readonly ${field.name}: ${tsScalarType(field.type)};`),
    '};',
    '',
    docComment([
      '`SessionProfile` のキーの完全集合(閉世界)。宣言順。',
      '書く側(サインイン / ジョブハンドラ)はこの配列だけを読んで書き、手でキーを書き並べない',
      '(H 群の突合対象 — auth-spec-writing.md §session 属性)。',
    ]),
    `export const SESSION_FIELDS = ${frozen(`[${fields.map((field) => tsString(field.name)).join(', ')}] as const satisfies readonly (keyof SessionProfile)[]`)};`,
    '',
    docComment([
      'セッションを持つ集約(`session: true` を宣言した entity_spec)の id 列のジョブ payload キー。',
      '`{集約名}_id` という命名規則から機械的に作る(仕組み側のコードは対象の集約名を',
      '文字列リテラルとして持たない)。session: true の列が 0 件なら `null`。',
    ]),
    `export const SESSION_ID_FIELD: string | null = ${sessionEntity === undefined ? 'null' : tsString(`${sessionEntity}_id`)};`,
    '',
    docComment([
      'セッションを持つ集約の**物理テーブル名**(data_table の `table`)。',
      '',
      'セッション属性を書く側は「実行者の行をどこから読むか」を知る必要がある —— その名前を',
      '文字列リテラルで持つと、別のアプリに移したときに書き換えが要る箇所が 1 つ増える。',
      'session: true の列が 0 件、またはその集約に data_table が無ければ `null`。',
    ]),
    `export const SESSION_ACTOR_TABLE: string | null = ${actorTable === undefined ? 'null' : tsString(actorTable)};`,
    '',
  ].join('\n');
}
