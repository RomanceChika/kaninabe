/**
 * data_table の `functions` + access_spec → RPC 本文の期待表(`app/src/domain/generated/rpc-expectations.ts`)の生成器。
 *
 * ## 何のための表か(束 ⑳-2 以後)
 *
 * 定型 5 形の本文は `code-rpc-bodies.ts` が migration に書き出す**生成物**になった。したがって
 * この表の役目は 2 つに絞られる。
 *
 * 1. **どの関数の本文が生成物か**(`migration`)を app 側に渡す —— 統合テスト `rpc-parity` はそれがあれば「生成した SQL と実 DB の本文が丸ごと一致するか」だけを見る。
 * 2. **本文が手書きの関数**(`shape: composite` と、定型だが `handwritten` を宣言するもの)に
 *    ついて、**意味のある断片**の期待を渡す —— 許可列・楽観的並行制御・空を渡された列の扱い。
 *    完全一致は空白・コメント・整形の差で落ちるので、手書きにはこの見方しか使えない。
 *
 * **書き込み先の表**(`also_writes`)だけは両方に効く —— 連鎖の書き忘れは形にも出どころにも
 * 依らないからである(実穴: E3 第3段で `workshops` に料金の列を足し `writes` にも並べたのに
 * `update_workshop` の許可列を作り直しておらず、値を入れる経路が 1 つも無い状態が緑で通っていた)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { DataFunctionDecl, DataTableSpec } from '../../model/data/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltOperation } from '../../usecase/operation-plan.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';
import type { ResolvedParam } from '../../usecase/param-source.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import { rpcValueColumns } from '../../sql/rpc-facts.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { generatedFile } from '../../gen-kit/code-emit.js';
import { renderRpcExpectationsFile } from './code-rpc-expectations-file.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import { selfWriteKindsOf } from '../../model/data/rpc-writes.js';
import { pluralizeEntity } from '../../model/table-name.js';
import { transitionTargetOf } from '../../sql/rpc-transition-machine.js';
import { actorBindStatement } from '../../sql/rpc-transition-columns.js';
import { handwrittenResendExpectation } from '../../sql/rpc-resend-handwritten.js';
import { digestAnchorsLiteral, digestSaves } from './code-rpc-digest-anchors.js';
import type { DigestSave } from '../../usecase/resend-policy.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'rpc-expectations.ts');

/**
 * 状態遷移は例外なく「判断したときの状態」を条件に書き込む(ARCH-BE-0013)。
 * この前提が変わったらここも変わる。
 */
const TRANSITION_USES_OCC = true;

/**
 * 全 data_table の `kind: rpc` から RPC 本文の期待表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/rpc-expectations.ts`(全テーブルで 1 ファイル・全体生成)。
 */
export const rpcExpectationsGenerator: DocGenerator = {
  id: 'code-rpc-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const tables = ctx.dataTables?.tables ?? [];
    if (tables.length === 0) return [];

    // 空を渡された列の契約は**実行計画そのもの**から引く(導出を 1 つに寄せる。独立レビュー 3-B)。
    const operations = buildOperationPlans({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions,
      dataTables: ctx.dataTables,
      jobs: ctx.jobs,
    }).operations;
    // 要約の錨の期待は保存点の宣言から引く(点検 23 回目 A23-4)。
    const saves = digestSaves(model, ctx.usecases, ctx.actions, ctx.dataTables);
    const byName: Record<string, LiteralValue> = {};
    for (const table of tables) {
      for (const fn of table.functions) {
        if (fn.kind !== 'rpc') continue;
        byName[fn.name] = expectationLiteral(fn, table, { model, operations, tables, actions: ctx.actions, jobs: ctx.jobs, saves });
      }
    }
    if (Object.keys(byName).length === 0) return [];

    return [
      {
        file: outputFile(ctx.roots),
        content: renderRpcExpectationsFile(byName, personalColumnsByTable(model, tables), tables.map((table) => table.location.file), erasureAddresseesByTable(tables)),
        wholeFile: true,
      },
    ];
  },
};

/** 期待の組み立てに要る文脈(モデル・実行計画・全表・action_spec)。 */
interface ExpectationContext {
  readonly model: SpecModel;
  readonly operations: readonly BuiltOperation[];
  readonly tables: readonly DataTableSpec[];
  readonly actions: ActionSpecModel | undefined;
  readonly jobs: JobSpecModel | undefined;
  readonly saves: readonly DigestSave[];
}

/** その RPC を `realized_by` で名指す効果の ID(辞書順・重複なし)。本文に効果 ID のリテラル(目印)があることを突き合わせる。 */
function realizedEffects(jobs: JobSpecModel | undefined, rpc: string): readonly string[] {
  const catalog = jobs?.available === true ? jobs.catalog : null;
  return [...new Set((catalog?.jobs ?? []).filter((job) => Object.values(job.realizedBy ?? {}).includes(rpc)).map((job) => job.id))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** 表 → personal 列(個人列を持つ表だけ。update の set 句に個人列があれば scrub の宣言を要求する材料)。 */
function personalColumnsByTable(model: SpecModel, tables: readonly DataTableSpec[]): Readonly<Record<string, LiteralValue>> {
  const result: Record<string, LiteralValue> = {};
  for (const table of tables) if ((table.personalColumns ?? []).length > 0) result[table.table] = [...(table.personalColumns ?? [])];
  for (const specs of [...model.aggregates.values()]) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    const columns = entity.fields.filter((field) => field.personal).map((field) => field.name);
    if (columns.length > 0) result[entity.table ?? pluralizeEntity(entity.entity)] = columns;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

/** 表 → 持ち主が宛先の個人列(`erasure_addressee` の列と本人からの参照)。宣言のある表だけ。消去の本文が宛先の行を本人の参照で引くことを erase-parity が見る(点検 17 回目 A17-1)。 */
function erasureAddresseesByTable(tables: readonly DataTableSpec[]): Readonly<Record<string, LiteralValue>> {
  const result: Record<string, LiteralValue> = {};
  for (const table of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
    const rows = table.erasureAddressees ?? [];
    if (rows.length > 0) result[table.table] = rows.map((row) => ({ column: row.column, via: row.via }));
  }
  return result;
}

/** RPC 1 本の期待をリテラルに写す。 */
function expectationLiteral(fn: DataFunctionDecl, table: DataTableSpec, ctx: ExpectationContext): LiteralValue {
  const model = ctx.model;
  const base: Record<string, LiteralValue> = {
    table: table.table,
    shape: fn.shape ?? 'composite',
    alsoWrites: [...fn.alsoWrites].sort((a, b) => a.localeCompare(b)),
    alsoWriteKinds: Object.fromEntries([...fn.alsoWrites].sort((a, b) => a.localeCompare(b)).map((w) => [w, [...(fn.alsoWriteKinds?.[w] ?? [])]])),
    selfWriteKinds: [...(selfWriteKindsOf(fn) ?? [])],
    selfWritesDeclared: fn.selfWriteKinds !== undefined,
    realizes: [...realizedEffects(ctx.jobs, fn.name)],
    calls: [...(fn.calls ?? [])].sort((a, b) => a.localeCompare(b)),
    dynamicSql: fn.dynamicSql !== undefined,
    scrubVia: Object.fromEntries(Object.entries(fn.scrubVia ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([written, columns]) => [written, [...columns]])),
    ...(fn.migration === undefined ? {} : { migration: fn.migration }),
  };
  if (fn.shape === 'transition') {
    base['optimisticLock'] = TRANSITION_USES_OCC;
    const contracts = eventColumnContracts(
      ctx.operations
        .filter((operation) => operation.plan.rpcName === fn.name)
        .map((operation) => ({ op: operation.op, params: operation.params })),
    );
    if (Object.keys(contracts).length > 0) base['columnContracts'] = contracts;
    const bound = actorBoundColumns(fn, table, model, ctx.actions);
    if (Object.keys(bound).length > 0) base['actorBound'] = bound;
  }
  if (fn.shape === 'update') {
    base['columns'] = writableColumns(model, table);
    base['optimisticLock'] = hasAccessGuard(model, table, 'writes');
  }
  if (fn.shape === 'create') {
    base['optimisticLock'] = hasAccessGuard(model, table, 'creates');
    // 列の既定値の突合を双方向にするための母集合(本文の生成と同じ写像から引く。独立レビュー 1-D)。
    const columns = rpcValueColumns({
      name: fn.name,
      params: fn.params,
      args: fn.args,
      shape: 'create',
      table,
      domain: model,
      tableOf: (entity) => ctx.tables.find((candidate) => candidate.entity === entity)?.table ?? null,
      actions: ctx.actions,
    });
    if (columns.length > 0) base['valueColumns'] = [...columns];
  }
  if (fn.shape === 'delete') base['optimisticLock'] = hasAccessGuard(model, table, 'deletes');
  const anchors = digestAnchorsLiteral(fn, table, ctx.tables, model, ctx.saves);
  if (anchors !== null) base['digestAnchors'] = anchors;
  const resend = handwrittenResendExpectation(fn, table, ctx.operations);
  if (resend !== null) base['resendInput'] = { word: resend.word, compared: [...resend.compared], signal: resend.signal, deleted: resend.deleted };
  return base;
}

/** 空を渡された列に RPC が要求される扱い(値域)。 */
export type ColumnContract = 'assign' | 'coalesce';

/** 1 つの遷移(= 1 つのドメインイベント)の解決済み引数。 */
export interface ContractEntry {
  readonly op: string;
  readonly params: readonly ResolvedParam[];
}

/**
 * 遷移 RPC が受け取る**自集約の列**について、空を渡されたときに要求する扱い(束 ⑰-3)。
 *
 * 遷移の RPC は状態列のほかに `p_{列}` を受け取ることがある(対応者・紐づくアカウント)。
 * その列にその遷移が何を要求するかは、**実行計画が既に決めている** ——
 * `{kind: 'not_written', contract}` がそれであり、`cleared` なら空を空として入れる = 代入、
 * `untouched` なら空で上書きしない = `coalesce` である。値を供給する遷移(入力・実行者から
 * 決まる列)は `not_written` ではないので、そもそも契約を持たない。
 *
 * **鍵はイベントである。** 宣言(state_spec の `clears`)がイベント単位なのだから、期待も
 * イベント単位で持つ —— 列単位に潰すと「ある遷移は空にする / 別の遷移は触れてはいけない」
 * 同じ列が**黙って代入になり**、触れないはずの遷移がその列を消す(独立レビュー 3-A)。
 * 同居したときに本文へ何を要求するかは rpc-parity が決める(イベントで分岐していなければ赤)。
 *
 * **導出はここ 1 つである。** 以前は state_spec の `clears` をこの生成器がもう一度読んでいて、
 * 計画が運ぶ `contract` と**同じ事実の 2 つの導出**が誰にも突き合わされていなかった
 * (独立レビュー 3-B)。いまは計画の値がそのまま期待になる。
 *
 * @param entries その RPC を呼ぶ遷移と、その解決済み引数
 * @returns ドメインイベント ID → 列 → 契約(契約を持つ遷移だけが鍵になる)
 */
export function eventColumnContracts(
  entries: readonly ContractEntry[],
): Readonly<Record<string, LiteralValue>> {
  const contracts: Record<string, LiteralValue> = {};
  for (const entry of entries) {
    const byColumn: Record<string, LiteralValue> = {};
    for (const param of entry.params) {
      if (param.source.kind !== 'not_written') continue;
      byColumn[param.source.field] = param.source.contract === 'cleared' ? 'assign' : 'coalesce';
    }
    if (Object.keys(byColumn).length > 0) contracts[entry.op] = byColumn;
  }
  return contracts;
}

/**
 * 遷移 RPC が受ける `records_actor` の列 → その列の縛りの代入文の字面(本文が書き込みの前に引数を縛る。A7-1)。
 *
 * 本文の生成(`rpc-transition-columns.ts` の `actorBindStatement`)と**同じ 1 本**から字面を引き、rpc-parity が
 * 実 DB の本文にその文がちょうど 1 回・最初の `update` より前にあることを見る(手書きの置き換えで縛りが消える・
 * `else` の枝が呼び手の値になる・`update` の後ろに置かれる、のどれでも赤になる。点検 8 回目 A8-2)。
 */
function actorBoundColumns(fn: DataFunctionDecl, table: DataTableSpec, model: SpecModel, actions: ActionSpecModel | undefined): Readonly<Record<string, LiteralValue>> {
  const entity = table.entity;
  const target = entity === undefined ? null : transitionTargetOf(fn.name, entity, model);
  if (entity === undefined || target === null || !target.ok) return {};
  const machine = target.target.machine;
  const bound: Record<string, LiteralValue> = {};
  for (const param of fn.params) {
    const column = param.startsWith('p_') ? param.slice(2) : param;
    const statement = actorBindStatement({ machine, column, entity, actions });
    if (statement !== null) bound[column] = statement;
  }
  return bound;
}

/** その表のエンティティが `writes` で許している列の和(宣言順ではなく辞書順で安定させる)。 */
function writableColumns(model: SpecModel, table: DataTableSpec): readonly string[] {
  const access = table.entity === undefined ? null : findAccessSpec(model, table.entity);
  const fields = new Set((access?.writes ?? []).flatMap((rule) => rule.fields));
  return [...fields].sort((a, b) => a.localeCompare(b));
}

/**
 * `creates` / `deletes` / `writes` に条件つきの規則があるか。
 *
 * あるなら「可否は読んだ時点の状態に対して下されている」ので、同じ状態を条件にした
 * 書き込み(楽観的並行制御)が要る。条件が 1 本も無い表(会場・チェック項目テンプレート)の
 * 編集は状態に依らないので、判断が古びるという事態が起きない。
 *
 * **作成にもこれが効く。** 作成は「判断時の対象」を持たないが、**従属集約は可否が親の状態に
 * 依存する**(`creates[].when: workshop.state in [...]`)。判断してから書き込むまでに親が動くと、
 * 条件を書いていない実装は「もう作ってはいけない行」を作る。0 行にするには親の状態を
 * 引数で受け取って同じ文の中で確かめるしかない(実物: `insert_workshop_part`)。
 */
function hasAccessGuard(
  model: SpecModel,
  table: DataTableSpec,
  op: 'creates' | 'deletes' | 'writes',
): boolean {
  const access = table.entity === undefined ? null : findAccessSpec(model, table.entity);
  if (access === null) return false;
  const rules: readonly { readonly when?: string }[] = access[op] ?? [];
  return rules.some((rule) => rule.when !== undefined);
}
