/**
 * roles.md の `role-table` マーカーに、ロール一覧表を生成するジェネレーター。
 *
 * ロールはグローバル(binding 無し)と文脈依存(binding 有り)の 2 種類(domain-spec-writing.md
 * §role_spec)。binding が無いロールは表上「—」で示す。
 * ロール階層(`implies`)は権限の包含関係の推論に使われる宣言なので、レビューできるよう
 * 同じ表に列として出す。
 */

import type { RoleDef, SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';

const TABLE_HEADER = ['ロールID', '名前', '種別', 'binding', '含意するロール'] as const;

/** roles.md の role-table セクションを生成するジェネレーター。 */
export const roleTableGenerator: DocGenerator = {
  id: 'role-table',

  generate(model: SpecModel, _ctx: GenerateContext): GeneratedSection[] {
    return [
      {
        file: model.roles.location.file,
        marker: 'role-table',
        content: renderRoleTable(model.roles.roles),
      },
    ];
  },
};

/**
 * ロール定義の配列からロール一覧表(Markdown)を組み立てる。
 * roles.md の生成ブロックと、ハンドブック(docs/book/README.md)が同じ表を使う。
 * @param roles roles.md の全ロール定義
 * @returns ヘッダー行込みの Markdown テーブル
 */
export function renderRoleTable(roles: readonly RoleDef[]): string {
  const rows = roles.map((role) => [
    role.id,
    role.label ?? '—',
    kindLabel(role),
    bindingCell(role),
    impliesCell(role),
  ]);
  return renderTable(TABLE_HEADER, rows);
}

/** binding の有無からロールの種別を判定する。 */
function kindLabel(role: RoleDef): string {
  return role.binding === undefined ? 'グローバル' : '文脈依存';
}

/** binding セル。無ければ「—」、あればコード表記。 */
function bindingCell(role: RoleDef): string {
  return role.binding === undefined ? '—' : `\`${role.binding}\``;
}

/** implies セル。無ければ「—」、あればロール ID をカンマ区切りで並べる。 */
function impliesCell(role: RoleDef): string {
  const implies = role.implies ?? [];
  return implies.length === 0 ? '—' : implies.join(', ');
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
