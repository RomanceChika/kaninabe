/**
 * 各集約の entity.md にある `field-table` マーカーに、フィールド定義表を生成するジェネレーター。
 *
 * 型・制約は entity.md のフロントマターの唯一の定義(domain-spec-writing.md §entity_spec)
 * から人間可読な文字列表現へ変換するだけで、新たな情報は付け加えない。
 */

import { isSystemSupplied, type FieldDef, type FieldType, type SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';

const TABLE_HEADER = ['フィールド', '型', '必須', '制約', '説明'] as const;

/** 各集約の entity.md の field-table セクションを生成するジェネレーター。 */
export const fieldTableGenerator: DocGenerator = {
  id: 'field-table',

  generate(model: SpecModel, _ctx: GenerateContext): GeneratedSection[] {
    const sections: GeneratedSection[] = [];
    for (const aggregate of model.aggregates.values()) {
      const entity = aggregate.entity;
      if (entity === undefined) continue;
      sections.push({
        file: entity.location.file,
        marker: 'field-table',
        content: renderFieldTable(entity.fields),
      });
    }
    return sections;
  },
};

/**
 * フィールド定義表 1 枚を組み立てる(entity.md の field-table と book のデータ節が共用)。
 *
 * `label` を 1 つでも持つエンティティでは「表示名」列をフィールド名の隣に足す。
 * 持たないエンティティの表は従来のまま(無い列を全行 — で埋めた表は読み手に
 * 「表示名という宣言があるのに書いていない」と誤読させる)。
 */
export function renderFieldTable(fields: readonly FieldDef[]): string {
  const { headers, rows } = fieldTableRows(fields);
  return renderTable(headers, rows);
}

/** フィールド定義表の見出しと行(Markdown の表と HTML の表が同じ行を使う)。 */
export function fieldTableRows(fields: readonly FieldDef[]): { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] } {
  const withLabel = fields.some((field) => field.label !== undefined);
  if (!withLabel) return { headers: TABLE_HEADER, rows: fields.map(renderFieldRow) };
  const [name, ...rest] = TABLE_HEADER;
  return {
    headers: [name, '表示名(label)', ...rest],
    rows: fields.map((field) => {
      const [nameCell, ...restCells] = renderFieldRow(field);
      return [nameCell ?? '', field.label ?? '—', ...restCells];
    }),
  };
}

/**
 * フィールド 1 件を表の 1 行(セル配列)に変換する。
 *
 * entity.md の field-table のほか、action_spec / query_spec の本文ブロックが
 * `{entity}.{field}` 参照の型・制約を展開するときも同じ行表現を使う(表現を 1 つに保つ)。
 */
export function renderFieldRow(field: FieldDef): string[] {
  return [
    field.name,
    fieldTypeToString(field.type),
    requiredCell(field),
    constraintsCell(field),
    field.description ?? '—',
  ];
}

/**
 * 「必須」列の表示。
 *
 * この列が答えているのは**入力として必須か**であり、システムが供給するフィールド(auto / state 型)は
 * そこでは「必須ではない」(そもそも入力に現れない)。ただし行としては必ず値があるので、
 * 「—」だけだとマトリクスが「無いことがある」と読める。生成される row スキーマの意味論
 * (domain-spec-writing.md §entity_spec)をそのまま写して、両方を 1 セルに書く。
 */
function requiredCell(field: FieldDef): string {
  if (field.suppliedBy === 'db') {
    return field.required ? '—（DB が供給。行では必須）' : '—（DB が供給）';
  }
  if (isSystemSupplied(field)) return '—（行では必須）';
  return field.required ? '✓' : '—';
}

/** フィールド型をフロントマター記法と同じ文字列表現に戻す(例: ref(workshop))。 */
function fieldTypeToString(type: FieldType): string {
  switch (type.kind) {
    case 'enum':
      return `enum([${type.values.join(', ')}])`;
    case 'ref':
      return `ref(${type.entity})`;
    case 'state':
      return `state(${type.machine})`;
    default:
      return type.kind;
  }
}

/**
 * max_length/min/max/pattern/auto/labels/supplied_by を "key=value" 形式でカンマ区切りにする。
 * 無ければ「—」。
 *
 * `labels`(enum の値の表示名)と `supplied_by`(値の供給元)もここに出す —— どちらも
 * フロントマターの宣言であり、`auto=true` と同じ「この欄に付いている印」として読める。
 */
function constraintsCell(field: FieldDef): string {
  const parts: string[] = [];
  if (field.maxLength !== undefined) parts.push(`max_length=${field.maxLength}`);
  if (field.min !== undefined) parts.push(`min=${field.min}`);
  if (field.max !== undefined) parts.push(`max=${field.max}`);
  if (field.pattern !== undefined) parts.push(`pattern=${field.pattern}`);
  if (field.format !== undefined) parts.push(`format=${field.format}`);
  if (field.auto) parts.push('auto=true');
  if (field.suppliedBy !== undefined) parts.push(`supplied_by=${field.suppliedBy}`);
  if (field.bearer !== undefined) parts.push(field.bearer.kind === 'reusable' ? 'bearer=reusable' : 'bearer=expiring');
  if (field.labels !== undefined) {
    const pairs = Object.entries(field.labels).map(([value, label]) => `${value}=${label}`);
    parts.push(`labels(${pairs.join(' / ')})`);
  }
  return parts.length === 0 ? '—' : parts.join(', ');
}

/**
 * 単純な GFM テーブルを組み立てる。
 * @param header 列見出し
 * @param rows 各行のセル値(header と同じ列数)
 */
function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const headerLine = `| ${header.join(' | ')} |`;
  const separatorLine = `| ${header.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((row) => `| ${row.join(' | ')} |`);
  return [headerLine, separatorLine, ...bodyLines].join('\n');
}
