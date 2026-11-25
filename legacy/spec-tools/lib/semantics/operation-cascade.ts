/**
 * 遷移 1 つが**同じトランザクションで他の行に及ぼす書き込み**(連鎖)の事実の抽出(操作の属性の材料)。
 *
 * 連鎖の出どころは 3 つで、どれも宣言から読む(集約の関数の本数や形から推測しない):
 *
 *   1. **効果が名指しした RPC**(ジョブカタログの `realized_by[イベント]`)
 *   2. **遷移そのものが通る RPC**(命名規約の遷移 RPC)。手書きの本文が不変条件の後始末を持つと、効果を外しても
 *      後始末は残る —— 効果の名指しだけを見ていると危険の表示が黙って落ちる。イベントごとの分は `event_writes`
 *   3. 1・2 の本文が呼ぶ関数(`calls`。推移的)
 *
 * 宣言の読み方(自表・イベントごと・呼び先)は `model/data/rpc-writes.ts` の 1 か所にある。
 * **読めない材料は「未検査」として名指しし、安全側(破壊的とみなす)に倒す** —— カタログが無い・名指しの RPC が
 * 無い・composite の自表の宣言が無い、を「連鎖なし」と読むと、確認の文言から「データが削除されます」が黙って落ちる。
 *
 * 純関数であり、文言(日本語)も出力の形も知らない。アプリの語彙は 1 語も持たない。
 */

import type { EntitySpec, SpecModel } from '../model/types.js';
import { pluralizeEntity } from '../model/table-name.js';
import { findStateMachines } from './domain-lookup.js';
import { findRealizedRpcs, realizingRpcName } from '../model/data/realized-rpcs.js';
import { alsoWritesAt, calleesOf, homeTableOf, selfWriteKindsOf, transitionRpcOf } from '../model/data/rpc-writes.js';
import type { DataFunctionDecl, DataTableSpec, DataWriteKind } from '../model/data/types.js';
import { isInTransactionJob, type OperationCatalogs } from './operation-catalogs.js';

/** テーブル名 → entity_spec の逆引き表。 */
function entityByTable(model: SpecModel): ReadonlyMap<string, EntitySpec> {
  const map = new Map<string, EntitySpec>();
  for (const specs of model.aggregates.values()) {
    if (specs.entity === undefined) continue;
    map.set(specs.entity.table ?? pluralizeEntity(specs.entity.entity), specs.entity);
  }
  return map;
}

/**
 * 他の表の**写し**(公開用の投影など)と宣言されている表の名前(entity_spec の `mirror: true`)。
 *
 * 写し直しや取り下げで写しの行が消えても元のデータは残るので、写しの表への `delete` は破壊的な書き込みに数えない。
 * 宣言が snapshot.to と一致することは V12 が、写しの表が写像以外で書かれないことは V25 が見る。
 * **`scrub` は写しでも数える**(写しに残る個人データを消すのは、元を消すのと同じ重さである)。
 * 写しの表に添える内部テーブル(data_table の `mirror_of`)も写しと同じに数える。値が写しの表でなければ数えない(閉じる側)。
 *
 * @param model ドメイン仕様全体
 * @param tables 読み込み済みの data_table
 * @returns 写しの表の名前
 */
export function mirrorTables(model: SpecModel, tables: readonly DataTableSpec[]): ReadonlySet<string> {
  const mirrors = [...model.aggregates.values()].flatMap((specs) =>
    specs.entity?.mirror === true ? [specs.entity.table ?? pluralizeEntity(specs.entity.entity)] : [],
  );
  const attached = tables.flatMap((table) => (table.mirrorOf !== undefined && mirrors.includes(table.mirrorOf) ? [table.table] : []));
  return new Set([...mirrors, ...attached]);
}

/** personal 列を持つ書き込み先(表名と、その列名)。 */
export interface PersonalTable {
  readonly table: string;
  readonly columns: readonly string[];
}

/** 破壊的な書き込み 1 件(表と種類)。 */
export interface DestructiveWrite {
  readonly table: string;
  readonly kind: 'delete' | 'scrub';
}

/** 連鎖を確かめられなかった理由(未検査。安全側に倒した根拠の材料)。 */
export type UnverifiedCascade =
  | { readonly kind: 'jobs_unavailable'; readonly jobs: readonly string[] }
  | { readonly kind: 'job_unknown'; readonly job: string }
  | { readonly kind: 'rpc_unnamed'; readonly job: string }
  | { readonly kind: 'data_tables_unavailable'; readonly rpcs: readonly string[] }
  | { readonly kind: 'rpc_missing'; readonly rpc: string }
  | { readonly kind: 'self_writes_unknown'; readonly rpc: string }
  | { readonly kind: 'callee_missing'; readonly rpc: string; readonly callee: string };

/** 連鎖の事実(destructive / affects_others / bulk / touches_personal の材料)。 */
export interface CascadeFacts {
  /** 効果を実現する RPC が名指しされ、data_table に実在したか(bulk の材料)。 */
  readonly compositeUsed: boolean;
  /** 自分以外の集約の表に書くか(affects_others の材料)。 */
  readonly touchesOtherAggregate: boolean;
  /** personal 列を持つ表に書くか(touches_personal の材料)。 */
  readonly touchesPersonal: boolean;
  /**
   * 破壊的な書き込みをするか(destructive の材料)。行を消す(`delete`。写しの表は除く)か個人列を置き換えて消す(`scrub`)
   * 書き込みが 1 つでもあるか、**未検査の材料が 1 つでもあれば** true(安全側)。
   */
  readonly destructive: boolean;
  /** 破壊的な書き込みの内訳(表と種類。根拠の文言の材料)。 */
  readonly destructiveWrites: readonly DestructiveWrite[];
  /** 名指しされた RPC がこのイベントで他の表に書く表(連鎖が無ければ空。根拠の文言の材料)。 */
  readonly alsoWrites: readonly string[];
  /** 書き込み先のうち personal 列を持つもの(初出の順。根拠の文言の材料)。 */
  readonly personalTables: readonly PersonalTable[];
  /** 名指しされた RPC(名指しの順・重複なし。根拠の文言の材料)。 */
  readonly rpcs: readonly string[];
  /** 確かめられなかったこと(空なら全部の材料を読めた)。 */
  readonly unverified: readonly UnverifiedCascade[];
}

/** 連鎖の材料にする RPC 1 本と、その役割。 */
interface CascadeSource {
  readonly fn: DataFunctionDecl;
  /** 効果が名指しした RPC か(根拠の文言の `rpcs` / `alsoWrites` に載る)。 */
  readonly realized: boolean;
}

/** 効果の並びから、名指しの RPC 名と未検査の理由を引く。 */
function realizedNames(
  catalogs: OperationCatalogs,
  event: string,
  jobIds: readonly string[],
  unverified: UnverifiedCascade[],
): readonly string[] {
  if (jobIds.length === 0) return [];
  // 製品がジョブカタログを採っていない(置き場が無い = `available: false`)のは事実であり、同じトランザクションで実現される
  // 効果を宣言する口(`kind` の in_transaction と realized_by)がそもそも無い —— 連鎖は遷移の RPC の宣言だけから導く(黙る)。
  // 渡されなかった(undefined)・採ったのに読めない(catalog が null)は「分からない」なので未検査にする。
  if (catalogs.jobs?.available === false) return [];
  const catalog = catalogs.jobs?.available === true ? catalogs.jobs.catalog : null;
  if (catalog === null || catalog === undefined) {
    unverified.push({ kind: 'jobs_unavailable', jobs: jobIds });
    return [];
  }
  const byId = new Map(catalog.jobs.map((job) => [job.id, job]));
  return jobIds.flatMap((id) => {
    const job = byId.get(id);
    if (job === undefined) {
      unverified.push({ kind: 'job_unknown', job: id });
      return [];
    }
    if (!isInTransactionJob(job)) return [];
    const name = realizingRpcName(job, event);
    if (name === undefined) {
      unverified.push({ kind: 'rpc_unnamed', job: id });
      return [];
    }
    return [name];
  });
}

/** 連鎖の材料にする RPC の並び(名指し → 遷移の RPC → 呼び先。重複なし)。 */
function cascadeSources(
  tables: readonly DataTableSpec[],
  realized: readonly DataFunctionDecl[],
  own: DataFunctionDecl | undefined,
  unverified: UnverifiedCascade[],
): readonly CascadeSource[] {
  const sources: CascadeSource[] = realized.map((fn) => ({ fn, realized: true }));
  if (own !== undefined && !realized.includes(own)) sources.push({ fn: own, realized: false });
  for (const source of [...sources]) {
    const callees = calleesOf(tables, source.fn);
    for (const callee of callees.missing) unverified.push({ kind: 'callee_missing', rpc: source.fn.name, callee });
    for (const fn of callees.found) {
      if (!sources.some((existing) => existing.fn === fn)) sources.push({ fn, realized: false });
    }
  }
  return sources;
}

/** 書き込みの集計の器。 */
interface Tally {
  readonly destructive: DestructiveWrite[];
  readonly personal: PersonalTable[];
  otherAggregate: boolean;
}

/** 表 1 つへの書き込みを集計に足す(`selfOnlyDestructive` は自表の insert / update を材料にしない)。 */
function tallyWrite(
  tally: Tally,
  context: { readonly entities: ReadonlyMap<string, EntitySpec>; readonly mirrors: ReadonlySet<string>; readonly aggregate: string },
  table: string,
  kinds: readonly DataWriteKind[],
  selfOnlyDestructive: boolean,
): void {
  const destructiveKinds = kinds.filter((kind): kind is 'delete' | 'scrub' => kind === 'scrub' || (kind === 'delete' && !context.mirrors.has(table)));
  if (selfOnlyDestructive && destructiveKinds.length === 0) return;
  for (const kind of destructiveKinds) {
    if (!tally.destructive.some((write) => write.table === table && write.kind === kind)) tally.destructive.push({ table, kind });
  }
  const entity = context.entities.get(table);
  if (entity === undefined) return;
  if (entity.entity !== context.aggregate) tally.otherAggregate = true;
  const columns = entity.fields.filter((field) => field.personal).map((field) => field.name);
  if (columns.length > 0 && !tally.personal.some((entry) => entry.table === table)) tally.personal.push({ table, columns });
}

/** 遷移 1 つの位置(集約・状態機械・イベント)。 */
export interface CascadeTarget {
  /** 遷移元の集約名。 */
  readonly aggregate: string;
  /** 状態機械の名前(遷移の RPC の命名規約に使う)。 */
  readonly machine: string;
  /** ドメインイベント ID(`{machine}.{event}`。`realized_by` / `event_writes` のキー)。 */
  readonly event: string;
  /** その遷移の effects に並ぶジョブ ID。 */
  readonly jobIds: readonly string[];
}

/**
 * 遷移 1 つの連鎖の事実を返す。
 *
 * @param model ドメイン仕様全体
 * @param catalogs テーブル仕様・ジョブカタログ
 * @param target 遷移の位置
 * @returns 連鎖の事実(未検査の理由つき)
 */
export function cascadeFacts(model: SpecModel, catalogs: OperationCatalogs, target: CascadeTarget): CascadeFacts {
  const unverified: UnverifiedCascade[] = [];
  const names = realizedNames(catalogs, target.event, target.jobIds, unverified);
  const tablesAvailable = catalogs.dataTables?.available === true;
  const tables = tablesAvailable ? catalogs.dataTables?.tables ?? [] : [];
  if (!tablesAvailable && names.length > 0) unverified.push({ kind: 'data_tables_unavailable', rpcs: [...new Set(names)] });
  const { found, missing } = findRealizedRpcs(tables, tablesAvailable ? names : []);
  for (const rpc of missing) unverified.push({ kind: 'rpc_missing', rpc });
  const own = tablesAvailable ? transitionRpcOf(tables, target.aggregate, target.machine, findStateMachines(model, target.aggregate).length === 1) : undefined;
  const sources = cascadeSources(tables, found, own, unverified);

  const context = { entities: entityByTable(model), mirrors: mirrorTables(model, tables), aggregate: target.aggregate };
  const tally: Tally = { destructive: [], personal: [], otherAggregate: false };
  const alsoWrites: string[] = [];
  for (const source of sources) {
    const writes = alsoWritesAt(source.fn, target.event);
    for (const [table, kinds] of Object.entries(writes)) {
      tallyWrite(tally, context, table, kinds, false);
      if (source.realized && !alsoWrites.includes(table)) alsoWrites.push(table);
    }
    const home = homeTableOf(tables, source.fn);
    const self = selfWriteKindsOf(source.fn);
    if (self === undefined) unverified.push({ kind: 'self_writes_unknown', rpc: source.fn.name });
    if (home !== undefined) tallyWrite(tally, context, home, self ?? ['delete', 'scrub'], true);
  }
  return {
    compositeUsed: found.length > 0,
    touchesOtherAggregate: tally.otherAggregate,
    touchesPersonal: tally.personal.length > 0,
    destructive: tally.destructive.length > 0 || unverified.length > 0,
    destructiveWrites: tally.destructive,
    alsoWrites,
    personalTables: tally.personal,
    rpcs: found.map((fn) => fn.name),
    unverified,
  };
}
