/**
 * data_table 個別ファイルの本文ブロック(`data-table-body`)の生成器。
 *
 * YAML フロントマターが正であり、本文はそのマトリクスにすぎない(生成は情報を足さない)。
 * 宣言の無い節は見出しごと出さず、「無い」ことを 1 行で明示する(集め忘れと区別するため)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { DataFunctionDecl, DataTableSpec, DataTriggerDecl } from '../../model/data/types.js';
import { isAppendDerivation } from '../../model/data/types.js';
import { indexRequirementsOfModels, type IndexRequirement } from '../../relations/index-requirements/index.js';
import { frameworkFunctionDecls, frameworkTriggerDecls } from '../../world/index.js';
import { ceilingDeclsOf } from '../../model/data/ceiling-plan.js';
import { refCounterpartDeclsOf } from '../../model/data/ref-check-shape.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先ディレクトリ(リポジトリルート相対)。 */
function tablesDir(roots: ProductRoots): string {
  return specPath(roots, 'backend/data/tables');
}

/** 対応表(このファイルが何者か)。 */
function identitySection(spec: DataTableSpec): string {
  const rows = [
    ['テーブル', cell(`\`${spec.table}\``)],
    spec.internal
      ? ['対応', cell('—(内部テーブル。ドメイン仕様に現れない台帳)')]
      : ['対応する entity_spec', cell(`\`${spec.entity ?? ''}\``)],
    [
      '読み取りポリシー',
      spec.internal
        ? cell('0 本(全不可視)が期待 — policy-parity が内部テーブルとして突合')
        : cell('正は access_spec の reads(生成: rls-expectations.ts。ここには書かない)'),
    ],
  ];
  return ['### 対応', '', markdownTable(['項目', '値'], rows)].join('\n');
}

/**
 * 索引の由来の文面(不変条件 ID・query_spec・関数の `lookup` を並べる。どれも無ければ `—`)。
 *
 * query_spec・`lookup` の由来は T2 と**同じ導出**(関係の層の `IndexRequirements`)から引く —— 列の並びが
 * ちょうど一致する期待索引の要求元である(短い候補が長い候補に畳まれた場合は、長い方の索引の由来に集まる)。
 */
function indexOrigin(
  spec: DataTableSpec,
  index: DataTableSpec['indexes'][number],
  derived: readonly IndexRequirement[],
): string {
  const candidate = derived.find(
    (entry) => entry.table === spec.table && entry.columns.join(',') === index.on.join(','),
  );
  const parts = [
    ...(index.invariant === undefined ? [] : [index.invariant]),
    ...(candidate === undefined || candidate.queries.length === 0 ? [] : [`query: ${candidate.queries.join(', ')}`]),
    ...(candidate === undefined || candidate.lookups.length === 0 ? [] : [`lookup: ${candidate.lookups.join(', ')}`]),
  ];
  return parts.length === 0 ? '—' : parts.join(' / ');
}

/** インデックスの表。 */
function indexSection(spec: DataTableSpec, derived: readonly IndexRequirement[]): string {
  if (spec.indexes.length === 0) return '### インデックス\n\n主キーの裏のインデックス以外はありません。';
  const rows = spec.indexes.map((index) => [
    cell(`\`${index.name}\``),
    cell(index.on.join(', ')),
    cell(index.unique ? 'unique' : '—'),
    cell(index.where === undefined ? '—' : `\`${index.where}\``),
    cell(indexOrigin(spec, index, derived)),
  ]);
  return ['### インデックス(主キー以外の全数)', '', markdownTable(['名前', '列', '一意', '部分(where)', '由来'], rows)].join('\n');
}

/** 採番の器の表(列の既定値が `nextval` で呼ぶもの)。 */
function sequenceSection(spec: DataTableSpec): string {
  if (spec.sequences.length === 0) return '### 採番の器\n\nありません。';
  const rows = spec.sequences.map((sequence) => [
    cell(`\`${sequence.name}\``),
    cell(sequence.start === undefined ? '—' : String(sequence.start)),
  ]);
  return [
    '### 採番の器(全数。表より前に作る)',
    '',
    markdownTable(['名前', '最初の値'], rows),
  ].join('\n');
}

/** 排他制約の表(期間の重なりの禁止)。 */
function exclusionSection(spec: DataTableSpec): string {
  if (spec.exclusions.length === 0) return '### 排他制約\n\nありません。';
  const rows = spec.exclusions.map((exclusion) => [
    cell(`\`${exclusion.name}\``),
    cell(exclusion.keys.join(', ')),
    cell(`[${exclusion.range[0]}, ${exclusion.range[1]})`),
    cell(exclusion.where === undefined ? '—' : `\`${exclusion.where}\``),
    cell(exclusion.invariant ?? '—'),
  ]);
  return [
    '### 排他制約(全数。期間の重なりの禁止)',
    '',
    markdownTable(['名前', '一致で見る鍵', '期間(半開)', '部分(where)', '由来'], rows),
  ].join('\n');
}

/** 外部キーの表。 */
function foreignKeySection(spec: DataTableSpec): string {
  if (spec.foreignKeys.length === 0) return '### 外部キー\n\nありません。';
  const rows = spec.foreignKeys.map((fk) => [
    cell(fk.column),
    cell(`\`${fk.references}\``),
    cell(fk.onDelete),
  ]);
  return ['### 外部キー(全数)', '', markdownTable(['列', '参照先', 'on delete'], rows)].join('\n');
}

/**
 * トリガの表。
 *
 * **設計図が持つ執行点も並べる**(仕組みが自分で持つ表の追記専用トリガ)。正の置き場は
 * `world/framework-triggers.ts`(本体は `sql/framework-guards.ts`)だが、この節が示しているのは「この表に在るトリガの全数」であり、
 * 宣言の場所で数を変えると見出しが嘘になる。**未ログインの作成の天井**(access_spec の `creates[].abuse` から生成されるトリガ)と、
 * **参照の欄が指す行を読む条件の相手の端**(別の表の執行点の宣言と不変条件の `formal` から生成されるトリガ。`model/data/ref-check-shape.ts`)も
 * 同じ理由で並べる。
 */
function triggerSection(spec: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): string {
  const ceiling = ceilingDeclsOf(spec, domain).triggers;
  const counterparts = refCounterpartDeclsOf(spec, domain, tables).triggers;
  const triggers = [...spec.triggers, ...frameworkTriggerDecls(spec), ...ceiling, ...counterparts];
  if (triggers.length === 0) return '### トリガ\n\nありません。';
  const rows = triggers.map((trigger) => [
    cell(`\`${trigger.name}\``),
    cell(`\`${trigger.functionName}\``),
    cell(trigger.fires ?? '—'),
    cell(ceiling.includes(trigger) ? ceilingOriginOf(trigger) : counterparts.includes(trigger) ? counterpartOriginOf(trigger) : originOf(trigger)),
  ]);
  return ['### トリガ(全数)', '', markdownTable(['名前', '関数', '発火', '由来'], rows)].join('\n');
}

/** 天井のトリガの由来の欄(宣言の出どころ + 名指す不変条件)。 */
function ceilingOriginOf(trigger: DataTriggerDecl): string {
  return trigger.invariant === undefined ? 'access_spec の abuse' : `${trigger.invariant} / access_spec の abuse`;
}

/** 相手の端の由来の欄(名指す不変条件 + 宣言の出どころ)。 */
function counterpartOriginOf(trigger: DataTriggerDecl): string {
  return `${trigger.invariant ?? ''} / 相手の端(別の表の執行点から生成)`;
}

/** トリガの由来の欄(不変条件、なければ導出の宣言。どちらも無ければ —)。 */
function originOf(trigger: DataTriggerDecl): string {
  if (trigger.invariant !== undefined) return trigger.invariant;
  if (trigger.derives === undefined || trigger.derives.length === 0) return '—';
  return trigger.derives
    .map((derivation) =>
      isAppendDerivation(derivation)
        ? `導出: ${derivation.column} = ${derivation.within} の下の末尾の番号(${derivation.mode})`
        : `導出: ${derivation.column} = ${derivation.from} ${derivation.offset}(${derivation.mode})`,
    )
    .join(' / ');
}

/** 関数の帰属の表(設計図が持つトリガ関数も並べる。`triggerSection` と同じ理由)。 */
function functionSection(spec: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): string {
  const functions = [...spec.functions, ...frameworkFunctionDecls(spec), ...ceilingDeclsOf(spec, domain).functions, ...refCounterpartDeclsOf(spec, domain, tables).functions];
  if (functions.length === 0) return '### 関数の帰属\n\nこの表を持ち場とする関数はありません。';
  const rows = functions.map((fn) => [
    cell(`\`${fn.name}\``),
    cell(fn.args.length === 0 ? '—' : fn.args.join(', ')),
    cell(fn.params.length === 0 ? '—' : fn.params.join(', ')),
    cell(fn.kind),
    cell(fn.shape ?? '—'),
    cell(fn.alsoWrites.length === 0 ? '—' : fn.alsoWrites.map((written) => alsoWriteCell(fn, written)).join(', ')),
  ]);
  return [
    '### 関数の帰属(この表を持ち場とする public スキーマの関数)',
    '',
    markdownTable(['関数', '引数型', '引数名', '種別', '形', '併せて書く表'], rows),
    ...enforcesBlock(spec),
  ].join('\n');
}

/**
 * `composite` の関数が執行点になる `writes` の規則の表(宣言が 1 つも無ければ何も出さない)。
 *
 * 規則の `when` / `fields` は access_spec が正なので、ここには写さない(名指しと見張りテストだけを並べる)。
 */
function enforcesBlock(spec: DataTableSpec): readonly string[] {
  const rows = spec.functions.flatMap((fn) =>
    (fn.enforces ?? []).map((item) => [
      cell(`\`${fn.name}\``),
      cell(`\`${item.writes}\``),
      cell(item.by),
      cell(item.testCase),
    ]),
  );
  if (rows.length === 0) return [];
  return [
    '',
    '#### 執行点になっている規則(composite の関数が守る access_spec の writes)',
    '',
    markdownTable(['関数', 'writes', 'by', '見張りテスト'], rows),
  ];
}

/** 宣言された CHECK の節の見出し。 */
const CHECK_HEADING = '### CHECK(entity_spec の導出でないもの)';

/** 宣言が 1 本も無いドメインの表の文面。 */
const DERIVED_ONLY = 'ありません(長さ・範囲・状態集合の CHECK は entity_spec / state_spec からの導出)。';

/** 宣言が 1 本も無い仕組みの表の文面(CHECK が無いのではなく、正が設計図にある)。 */
const FRAMEWORK_ONLY =
  'ありません(この表の CHECK は仕組みの設計図 `legacy/spec-tools/lib/sql/framework-tables.ts` が持つ)。';

/**
 * 宣言された(= 導出でない)CHECK の表。
 *
 * 「無い」の意味は表の種類で変わる —— ドメインの表では「長さ・範囲・状態集合は entity_spec /
 * state_spec からの導出なので宣言に現れない」であり、**仕組みが自分で持つ表**(`framework:`)
 * では「CHECK の正が設計図にある」である。同じ文面を出すと、後者は「この表に CHECK が無い」
 * と読めてしまう。
 */
function checkSection(spec: DataTableSpec): string {
  if (spec.checks.length === 0) {
    return `${CHECK_HEADING}\n\n${spec.framework === undefined ? DERIVED_ONLY : FRAMEWORK_ONLY}`;
  }
  const rows = spec.checks.map((check) => [
    cell(`\`${check.name}\``),
    cell(check.rule === undefined ? '—' : `\`${check.rule}\``),
    cell(check.invariant ?? '—'),
  ]);
  return [CHECK_HEADING, '', markdownTable(['名前', '規則', '由来'], rows)].join('\n');
}

/** テストケースの表(query-body と同じ形)。 */
function testCaseSection(spec: DataTableSpec): string {
  const rows = spec.testCases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    cell((testCase.covers ?? []).join(', ')),
    cell(testCase.specIds.join(', ')),
    cell(`\`${testCase.implementation.raw}\``),
  ]);
  return ['### テストケース', '', markdownTable(['ID', 'type', 'covers', 'spec_ids', 'implementation'], rows)].join('\n');
}

/**
 * 読み込み済みの data_table から個別ファイルの本文ブロックを生成するジェネレーター。
 * 出力は各 `{table}.md` の `data-table-body` マーカー。
 */
export const dataTableBodyGenerator: DocGenerator = {
  id: 'data-table-body',

  generate(domain: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.dataTables;
    if (model === undefined || !model.available) return [];
    // 索引の由来は T2 と同じ導出(query_spec + 関数の lookup)から引く。query_spec が無い構成でも lookup は見える。
    const derived = indexRequirementsOfModels(domain, ctx.guards, { ...(ctx.queries === undefined ? {} : { queries: ctx.queries }), dataTables: model }).requirements.candidates;
    return model.tables.map((spec) => ({
      file: `${tablesDir(ctx.roots)}/${spec.relPath}`,
      marker: 'data-table-body',
      content: [
        identitySection(spec),
        indexSection(spec, derived),
        sequenceSection(spec),
        exclusionSection(spec),
        foreignKeySection(spec),
        triggerSection(spec, domain, model.tables),
        functionSection(spec, domain, model.tables),
        checkSection(spec),
        testCaseSection(spec),
      ].join('\n\n'),
    }));
  },
};

/** 併せて書く表 1 つのセル（種類が宣言されていれば「表（種類）」）。 */
function alsoWriteCell(fn: DataFunctionDecl, written: string): string {
  const kinds = fn.alsoWriteKinds?.[written] ?? [];
  return kinds.length === 0 ? written : `${written}（${kinds.join('・')}）`;
}
