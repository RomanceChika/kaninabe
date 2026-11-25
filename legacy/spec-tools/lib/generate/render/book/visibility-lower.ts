/**
 * 可視性の章の下段(導出): 全エンティティ × 全ロールの一覧・個人データ・読み取り経路・索引。
 *
 * 可視性の宣言(access_spec の `reads` / `fields_hidden`)は集約ごとのファイルに散っており、公理は集約の章が数える。
 * ここは、それを**横断で読む**ための表である。可視性は一度間違えると静かに漏れる種類の宣言なので、全エンティティ × 全ロールを
 * 1 か所に集める。後半は読み取り経路(query_spec)の一覧 —— どの宣言の上にどの経路が立っているかまでを 1 章で読む。
 *
 * すべて折りたたむ。件数は表の行の数(構造テストが一致を見る)。
 */

import type { EntitySpec, SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import type { QuerySpec } from '../../../model/query/types.js';
import { indexRequirementsOfModels, type IndexRequirement } from '../../../relations/index-requirements/index.js';
import type { ExternalCatalogSpec } from '../../../model/external/types.js';
import { findField } from '../../../semantics/domain-index.js';
import { pluralizeEntity } from '../../../model/table-name.js';
import { cell, withLabel } from '../../../gen-kit/state-machine-table.js';
import { bypassRole, dependentQueries, hiddenFieldsFor, readKey, roleLabels, scopeJa, WIDE_READ_NOTE } from './access-view.js';
import { markdownFoldedTable, type FoldedTable } from './lower-table.js';
import { OPEN_WRITES_HEADER, OPEN_WRITES_LEAD, openWriteRows } from './visibility-open-writes.js';

/** 下段の材料(折りたたみの断片と、その件数の合計)。 */
export interface VisibilityLower {
  readonly blocks: string[];
  /** 折りたたみごとの材料(行が無い表は含まない。HTML 版が同じ行・同じ文を使う)。 */
  readonly tables: readonly FoldedTable[];
  readonly count: number;
  /** 表ごとの行の数(章頭の「参照」の内訳に出す)。 */
  readonly rows: { readonly matrix: number; readonly personal: number; readonly queries: number; readonly index: number; readonly open: number };
}

/** 一覧の導入(定型)。 */
const MATRIX_LEAD =
  'access_spec の `reads` と `fields_hidden` を全集約から集めた一覧。' +
  'ここが RLS ポリシー(第二防衛線)と読み取りクエリ(query_spec)の両方の正になる。' +
  '「見えない(none)」の行も含めて全ロール分を載せているので、各行を' +
  '**「このロールに、このデータが、この範囲で見えるのは正しいか?」**と読んで確認する。';

/** 依存 query 列の読み方(定型)。 */
const DEPENDENT_NOTE =
  '最右列は、その宣言の上に立っている読み取り経路である。**空欄は「この可視性を使っている経路がまだ無い」**ことを意味し、' +
  '名前が並んでいる行を狭めると、そこに挙がった query が壊れる(Q2 / Q5 がエラーで指す)。';

/** 全エンティティ × 全ロールの可視性一覧の行。 */
function matrixRows(model: SpecModel, ctx: GenerateContext): string[][] {
  const labels = roleLabels(model);
  const queries = dependentQueries(ctx.queries);
  const bypass = bypassRole(model);
  const rows: string[][] = [];
  for (const specs of model.aggregates.values()) {
    const access = specs.access;
    if (access === undefined) continue;
    for (const rule of access.reads) {
      if (rule.by === bypass) continue;
      rows.push([
        cell(access.entity),
        cell(withLabel(rule.by, labels.get(rule.by))),
        // 行の状態で絞る条件(`reads[].when`)は「見える範囲」そのものなので同じ欄に出す ——
        // 別の列にすると、条件を持つ集約が 1 つも無いシステムでも空列が並ぶ。
        cell(rule.when === undefined ? scopeJa(rule.scope) : `${scopeJa(rule.scope)}(状態の条件: \`${rule.when}\`)`),
        cell(hiddenFieldsFor(access, rule.by)),
        cell((queries.get(readKey(access.entity, rule.by)) ?? []).join(', ')),
      ]);
    }
  }
  return rows;
}

/** 個人データ(消去の対象)の節の導入(定型)。 */
const PERSONAL_LEAD =
  'entity_spec の `personal: true` を全集約から集めた一覧('
  + '「特定の個人に結びつき、その人が消去を求めうる値」— security-surface-proposal.md §3)。'
  + 'この列の値は監査ログ(`domain_events.payload`)に書かれず、列名だけが `redacted` に残る'
  + '(app/src/domain/generated/personal-expectations.ts が閉世界)。'
  + '`placeholder` は手順 2(anonymize。未着手)が書く置換値の宣言であり、手順 1 ではまだ使われない。';

/** personal: true の列だけを entity_spec の宣言順に返す。 */
function personalFields(entity: EntitySpec): readonly EntitySpec['fields'][number][] {
  return entity.fields.filter((field) => field.personal);
}

/** placeholder の表示(null は「NULL にする」と読めるように書く)。 */
function placeholderJa(placeholder: string | null): string {
  return placeholder === null ? 'null' : `\`${placeholder}\``;
}

/** 個人データ(消去の対象)の行。personal な列を 1 つも持たないテーブルは載せない。 */
function personalRows(model: SpecModel): string[][] {
  const rows: string[][] = [];
  for (const specs of model.aggregates.values()) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    const table = entity.table ?? pluralizeEntity(entity.entity);
    for (const field of personalFields(entity)) {
      rows.push([
        cell(table),
        cell(withLabel(field.name, field.label)),
        cell(field.personalPlaceholder === undefined ? '—' : placeholderJa(field.personalPlaceholder)),
      ]);
    }
  }
  return rows;
}

/** 外部サービスへ送る個人データの節の導入(定型)。 */
const EXTERNAL_PERSONAL_LEAD =
  'external_spec の `sends.fields` のうち、entity_spec で `personal: true` の列を全連携から集めた一覧。' +
  'この列の値は実際に外部サービスへ送信される(相手・何のためは[外部連携の章](./external.md)を見る)。';

/** sends.fields のうち personal: true の列だけを連携の宣言順に返す。 */
function personalSendsRows(model: SpecModel, catalog: ExternalCatalogSpec): string[][] {
  const rows: string[][] = [];
  for (const integration of catalog.integrations) {
    for (const ref of integration.sends.fields) {
      const dot = ref.indexOf('.');
      if (dot < 0) continue;
      const field = findField(model, ref.slice(0, dot), ref.slice(dot + 1));
      if (field === null || !field.personal) continue;
      rows.push([cell(`\`${integration.id}\``), cell(integration.service), cell(`\`${ref}\``)]);
    }
  }
  return rows;
}

/** スコープの表記(可視性の表と同じ書き方に揃える)。 */
function scopeText(query: QuerySpec): string {
  const scope = query.scopeUsed;
  return scope.kind === 'context' ? `context(${scope.entity})` : scope.kind;
}

/** 返し方の表記(returns と paging を 1 セルにまとめる)。 */
function returnsText(query: QuerySpec): string {
  const paging = query.paging;
  if (paging === undefined) return query.returns;
  const detail = paging.kind === 'limit' ? `limit(${paging.max})` : paging.kind;
  return `${query.returns} / ${detail}`;
}

/** 可視性の供給元(source の via と併読ごとの via を 1 セルに畳む)。 */
function viaText(query: QuerySpec): string {
  const parts = query.via === undefined ? [] : [query.via.role];
  for (const include of query.includes) {
    if (include.via !== undefined) parts.push(`${include.entity}: ${include.via.role}`);
  }
  return parts.join(', ');
}

/** 読み取り経路の導入(定型)。 */
const QUERIES_LEAD =
  '上の可視性の宣言を、実際に「読む形」にした経路の一覧。' +
  '`via` は「実行者のどの関係が行の可視性を供給しているか」の借用宣言である' +
  '(ログインしている資格で実行するが、その行が見えるのは自分がその行の関係者だから、という形)。';

/** 読み取り経路(query_spec)の行。 */
function queryRows(ctx: GenerateContext): string[][] {
  const model = ctx.queries;
  if (model === undefined || !model.available) return [];
  return model.queries.map((query) => [
    cell(`\`${query.name}\``),
    cell(query.source),
    cell(query.forRoles.join(', ')),
    cell(viaText(query)),
    cell(scopeText(query)),
    cell(returnsText(query)),
  ]);
}

/** 索引の節の導入(定型)。 */
const INDEX_LEAD =
  '各 query の filters(等値・in)・via のスコープ条件(自表内の列だけ)・sort と、関数(トリガ関数・' +
  'ジョブを取り出す関数など。data_table の `functions[].lookup`)が引く列から機械的に導いた索引候補。' +
  '導出規則・前方一致の畳み込みは `legacy/spec-tools/lib/relations/index-requirements/index-derivation.ts` が正で、' +
  'data_table の `indexes:` に全部宣言されていることを T2 が見る(宣言漏れはエラー)。' +
  '複数の要求元が同じ行に並ぶのは、列の並びが前方一致して 1 本の索引に畳まれたことを意味する。';

/** 索引(query_spec・関数の lookup → 索引候補の対応表)の行。 */
function indexRows(model: SpecModel, ctx: GenerateContext): string[][] {
  const queries = ctx.queries;
  if (queries === undefined || !queries.available || queries.queries.length === 0) return [];
  const candidates = indexRequirementsOfModels(model, ctx.guards, { queries, ...(ctx.dataTables === undefined ? {} : { dataTables: ctx.dataTables }) }).requirements.candidates;
  const byOrigin = new Map<string, IndexRequirement>();
  for (const candidate of candidates) {
    for (const name of candidate.queries) byOrigin.set(`\`${name}\``, candidate);
    for (const name of candidate.lookups) byOrigin.set(`lookup: \`${name}\``, candidate);
  }
  return [...byOrigin.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([origin, candidate]) => [cell(origin), cell(candidate.table), cell(`(${candidate.columns.join(', ')})`)]);
}

/**
 * 可視性の章の下段を組む。
 *
 * @param model ドメイン仕様
 * @param ctx 生成コンテキスト
 */
export function visibilityLower(model: SpecModel, ctx: GenerateContext): VisibilityLower {
  const matrix = matrixRows(model, ctx);
  const personal = personalRows(model);
  const external = ctx.external?.catalog === undefined || ctx.external.catalog === null ? [] : personalSendsRows(model, ctx.external.catalog);
  const queries = queryRows(ctx);
  const index = indexRows(model, ctx);
  const open = openWriteRows(model, ctx);
  // 行が無い表は折りたたみごと出さない(下で外す)。
  const candidates: FoldedTable[] = [
    {
      fold: { kind: 'table', title: '誰に何が見えるか(エンティティ × ロール)', count: matrix.length, hint: '集約の章のアクセスの宣言を、横断で読む表', element: 'visibility.matrix' },
      before: [MATRIX_LEAD],
      headers: ['エンティティ', 'ロール', '見える範囲', '隠すフィールド', 'この宣言に乗っている query'],
      rows: matrix,
      after: [WIDE_READ_NOTE, DEPENDENT_NOTE],
    },
    {
      fold: { kind: 'table', title: '未ログインに開いた書き込み', count: open.length, hint: '作成の天井と、更新・削除・遷移の理由つき受け入れ', element: 'visibility.matrix' },
      before: [OPEN_WRITES_LEAD],
      headers: OPEN_WRITES_HEADER,
      rows: open,
      after: [],
    },
    {
      fold: { kind: 'table', title: '個人データ(消去の対象)', count: personal.length, hint: 'entity_spec の personal: true を集めた表', element: 'visibility.personal' },
      before: [PERSONAL_LEAD],
      headers: ['テーブル', '列', 'placeholder(手順 2)'],
      rows: personal,
      after: [],
    },
    {
      fold: { kind: 'table', title: '外部サービスへ送る個人データ', count: external.length, hint: '外部連携の sends.fields のうち個人データ', element: 'visibility.personal' },
      before: [EXTERNAL_PERSONAL_LEAD],
      headers: ['連携', '相手', 'entity.field'],
      rows: external,
      after: [],
    },
    {
      fold: { kind: 'table', title: '読み取り経路(query)', count: queries.length, hint: 'どの宣言の上にどの経路が立っているか', element: 'visibility.query' },
      before: [QUERIES_LEAD],
      headers: ['クエリ', '何を読むか', '実行ロール(for)', '可視性の供給元(via)', 'スコープ', '返し方'],
      rows: queries,
      after: [],
    },
    {
      fold: { kind: 'table', title: '索引', count: index.length, hint: '読み取り経路から導いた索引候補', element: 'visibility.query' },
      before: [INDEX_LEAD],
      headers: ['要求元(クエリ / 関数)', 'テーブル', '索引候補(列の並び)'],
      rows: index,
      after: [],
    },
  ];
  const tables = candidates.filter((entry) => entry.rows.length > 0);
  return {
    count: matrix.length + open.length + personal.length + external.length + queries.length + index.length,
    rows: { matrix: matrix.length, personal: personal.length + external.length, queries: queries.length, index: index.length, open: open.length },
    tables,
    blocks: tables.flatMap(markdownFoldedTable),
  };
}
