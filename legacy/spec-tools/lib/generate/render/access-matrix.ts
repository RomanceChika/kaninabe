/**
 * 各集約の access.md にある `access-matrix` マーカーに、アクセス権限表を生成するジェネレーター。
 *
 * access_spec(domain-spec-writing.md §access_spec)は読み取り(reads)・作成(creates)・
 * 編集(writes)・削除(deletes)・隠しフィールド(fields_hidden)の 5 種類の規則を持つ。
 * reads は必須(V4 が全域性を検証)だが creates / writes / deletes / fields_hidden は
 * 省略可能なので、それぞれ存在する場合だけ見出しと表を追加する。
 *
 * 「ロール」列は roles.md の label(あれば)を `id(label)` の形で併記する。ロール ID が
 * roles.md に無い場合(定義漏れなど)は ID のみを表示する。
 */

import { readFilterPath } from '../../model/read-filter-path.js';
import type {
  AccessSpec,
  CreateRule,
  DeleteRule,
  FieldHiddenRule,
  ReadRule,
  ReadScope,
  RoleDef,
  WriteRule,
} from '../../model/types.js';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';

const READ_HEADER = ['ロール', 'スコープ'] as const;

/**
 * 実行者の属性で狭める境界(テナント)を宣言しているシステムでの読み取りの見出し。
 *
 * 列を**宣言しているときだけ**足すのは、使っていない語彙の空列が並ぶのを避けるためである
 * (境界を持たないシステムの表は 2 列のまま)。
 */
const READ_HEADER_WITH_FILTERS = ['ロール', 'スコープ', '実行者の属性で狭める'] as const;

/** 行の状態で見え方を絞る条件(`reads[].when`)を宣言している集約での読み取りの見出し。 */
const READ_HEADER_WITH_WHEN = ['ロール', 'スコープ', '実行者の属性で狭める', '行の状態の条件'] as const;
const CREATE_HEADER = ['ロール', '条件'] as const;
const WRITE_HEADER = ['ロール', '編集可能フィールド', '条件', '副作用'] as const;
const DELETE_HEADER = ['ロール', '条件'] as const;
const HIDDEN_HEADER = ['フィールド', '隠す対象ロール'] as const;

/** ロール ID → 日本語名。label を持つロールのみ含む。 */
type RoleLabels = ReadonlyMap<string, string>;

/** 各集約の access.md の access-matrix セクションを生成するジェネレーター。 */
export const accessMatrixGenerator: DocGenerator = {
  id: 'access-matrix',

  generate(model: SpecModel, _ctx: GenerateContext): GeneratedSection[] {
    const roleLabels = buildRoleLabels(model.roles.roles);
    const sections: GeneratedSection[] = [];
    for (const aggregate of model.aggregates.values()) {
      const access = aggregate.access;
      if (access === undefined) continue;
      sections.push({
        file: access.location.file,
        marker: 'access-matrix',
        content: renderAccessMatrix(access, roleLabels),
      });
    }
    return sections;
  },
};

/** roles.md のロール定義から、label を持つものだけの id → label 写像を作る。 */
function buildRoleLabels(roles: readonly RoleDef[]): RoleLabels {
  const map = new Map<string, string>();
  for (const role of roles) {
    if (role.label !== undefined) map.set(role.id, role.label);
  }
  return map;
}

/** ロール ID を `id(label)` の形にする。label が無い(未定義ロール含む)場合は ID のみ。 */
function roleCell(id: string, roleLabels: RoleLabels): string {
  const label = roleLabels.get(id);
  return label === undefined ? id : `${id}(${label})`;
}

/** access_spec 1 件分の Markdown(読み取り表 + 任意で編集表・隠しフィールド表)を組み立てる。 */
function renderAccessMatrix(access: AccessSpec, roleLabels: RoleLabels): string {
  // 列は**宣言している軸の数だけ**出す(使っていない語彙の空列を並べない)。
  const withFilters = access.reads.some((rule) => (rule.filters ?? []).length > 0);
  const withWhen = access.reads.some((rule) => rule.when !== undefined);
  const header = withWhen ? READ_HEADER_WITH_WHEN : withFilters ? READ_HEADER_WITH_FILTERS : READ_HEADER;
  const blocks: string[] = [
    '### 読み取り',
    renderTable(
      header,
      access.reads.map((rule) => renderReadRow(rule, roleLabels, header.length)),
    ),
  ];

  if (access.creates.length > 0) {
    blocks.push(
      '### 作成',
      renderTable(CREATE_HEADER, access.creates.map((rule) => renderCreateRow(rule, roleLabels))),
    );
  }

  if (access.writes.length > 0) {
    blocks.push(
      '### 編集',
      renderTable(WRITE_HEADER, access.writes.map((rule) => renderWriteRow(rule, roleLabels))),
    );
  }

  if (access.transitionWrites.length > 0) {
    // 遷移だけが書く列。ロールを持たず、編集の経路を作らない(編集の表とは別に出す)。
    blocks.push(
      '### 遷移だけが書く列',
      `人の編集の経路も内部実行の編集の経路も持たない列(状態遷移の RPC だけが書く): ${access.transitionWrites.map((field) => `\`${field}\``).join(', ')}`,
    );
  }

  if (access.deletes.length > 0) {
    blocks.push(
      '### 削除',
      renderTable(DELETE_HEADER, access.deletes.map((rule) => renderDeleteRow(rule, roleLabels))),
    );
  }

  if (access.fieldsHidden.length > 0) {
    blocks.push('### 隠しフィールド', renderTable(HIDDEN_HEADER, access.fieldsHidden.map(renderHiddenRow)));
  }

  return blocks.join('\n\n');
}

/**
 * 読み取り規則 1 件を表の 1 行に変換する(境界と状態の条件の列は宣言があるときだけ)。
 *
 * @param rule 読み取り規則
 * @param roleLabels ロール ID → 日本語名
 * @param columns 出す列の数(2 = スコープまで / 3 = 境界まで / 4 = 状態の条件まで)
 * @returns 表の 1 行
 */
function renderReadRow(rule: ReadRule, roleLabels: RoleLabels, columns: number): string[] {
  const base = [roleCell(rule.by, roleLabels), scopeToString(rule.scope)];
  if (columns < 3) return base;
  const filters = rule.filters ?? [];
  const text =
    filters.length === 0
      ? '—'
      : filters.map((filter) => `\`${readFilterPath(filter)} = actor.${filter.actorField}\``).join(' / ');
  if (columns < 4) return [...base, text];
  return [...base, text, rule.when === undefined ? '—' : `\`${rule.when}\``];
}

/** 読み取りスコープの文字列表現(own / all / none / context(entity))。 */
function scopeToString(scope: ReadScope): string {
  return scope.kind === 'context' ? `context(${scope.entity})` : scope.kind;
}

/** 作成規則 1 件を表の 1 行に変換する。when が無ければ常に許可を意味する「—」。 */
function renderCreateRow(rule: CreateRule, roleLabels: RoleLabels): string[] {
  return [roleCell(rule.by, roleLabels), rule.when === undefined ? '—' : `\`${rule.when}\``];
}

/** 編集規則 1 件を表の 1 行に変換する。when / effects が無ければ「—」。 */
function renderWriteRow(rule: WriteRule, roleLabels: RoleLabels): string[] {
  return [
    roleCell(rule.by, roleLabels),
    rule.fields.join(', '),
    rule.when === undefined ? '—' : `\`${rule.when}\``,
    rule.effects === undefined || rule.effects.length === 0 ? '—' : rule.effects.join(', '),
  ];
}

/** 削除規則 1 件を表の 1 行に変換する。when が無ければ常に許可を意味する「—」。 */
function renderDeleteRow(rule: DeleteRule, roleLabels: RoleLabels): string[] {
  return [roleCell(rule.by, roleLabels), rule.when === undefined ? '—' : `\`${rule.when}\``];
}

/** 隠しフィールド規則 1 件を表の 1 行に変換する。 */
function renderHiddenRow(rule: FieldHiddenRule): string[] {
  return [rule.field, rule.from.join(', ')];
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
