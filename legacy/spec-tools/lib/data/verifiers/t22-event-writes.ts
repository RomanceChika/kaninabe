/**
 * T22 **複数のイベントが通る RPC の破壊的な書き込みは、イベントごとに宣言する**(`event_writes`)。
 *
 * 遷移の RPC は集約に 1 本で、その集約の全イベントが通る。手書きの本文が一部のイベントでだけ後始末(行の削除など)を
 * する場合、`also_writes` は全イベントの和なので「どのイベントが消すか」が宣言から読めない。そこで操作の属性の連鎖を
 * **効果の名指し(`realized_by`)だけ**から導いていたが、後始末が効果ではなく不変条件のためのものだと、効果を外した
 * 瞬間に destructive が黙って落ちる。
 *
 * この検査は、破壊的な書き込み(写しでない表の `delete`・`scrub`)を持つ RPC を 2 つ以上のイベントが通るとき、
 * `event_writes` が**全部のイベントについて**そのイベントで行う書き込み(行わないなら `{}`)を宣言していることを要求する:
 *
 *   - 通るイベント = その集約の状態機械の遷移の RPC(命名規約)である全イベント + `realized_by` でこの RPC を名指すイベント
 *   - キーは通るイベントと過不足なく一致する(余るキーは通らないイベントを名指している)
 *   - 各イベントの書き込みは `also_writes` の部分集合(表も種類も)で、`also_writes` の各書き込みはどれかのイベントが行う
 *   - 自表の破壊的な書き込みはイベントごとに言えないので、複数のイベントが通る RPC では持てない(RPC を分ける)
 *
 * 宣言の形はパーサー(T0)が、本文との一致は rpc-parity が見る。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { allMachines } from '../../model/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import { selfWriteKindsOf, transitionRpcOf } from '../../model/data/rpc-writes.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel, DataWriteKind } from '../../model/data/types.js';
import { mirrorTables } from '../../semantics/operation-cascade.js';
import { findStateMachines } from '../../semantics/domain-lookup.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T22';

/** T22 の指摘を組み立てる。 */
function finding(table: DataTableSpec, fn: DataFunctionDecl, message: string, suggestion: string, counterexample: Record<string, string>): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message,
    location: { ...table.location, pointer: `functions.${fn.name}.event_writes` },
    suggestion,
    counterexample: { function: fn.name, ...counterexample },
  };
}

/** RPC 名 → それを通るイベント ID(遷移の RPC と `realized_by` の名指し)。 */
function eventsByRpc(domain: SpecModel, tables: readonly DataTableSpec[], jobs: JobSpecModel | undefined): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  const add = (rpc: string, event: string): void => {
    const list = result.get(rpc) ?? [];
    if (!list.includes(event)) list.push(event);
    result.set(rpc, list);
  };
  for (const { aggregate, machine } of allMachines(domain)) {
    const rpc = transitionRpcOf(tables, aggregate, machine.machine, findStateMachines(domain, aggregate).length === 1);
    if (rpc === undefined) continue;
    for (const event of machine.events) add(rpc.name, `${machine.machine}.${event.id}`);
  }
  for (const job of jobs?.available === true ? jobs.catalog?.jobs ?? [] : []) {
    for (const [event, rpc] of Object.entries(job.realizedBy ?? {})) add(rpc, event);
  }
  return result;
}

/** 破壊的な種類か(写しでない表の delete / scrub)。 */
function isDestructive(table: string, kinds: readonly DataWriteKind[], mirrors: ReadonlySet<string>): boolean {
  return kinds.includes('scrub') || (kinds.includes('delete') && !mirrors.has(table));
}

/** 宣言された event_writes の中身を also_writes と通るイベントに突き合わせる。 */
function declaredFindings(
  table: DataTableSpec,
  fn: DataFunctionDecl,
  events: readonly string[],
  declared: NonNullable<DataFunctionDecl['eventWrites']>,
  jobsKnown: boolean,
): Finding[] {
  const findings: Finding[] = [];
  const also = fn.alsoWriteKinds ?? {};
  for (const event of events.filter((candidate) => declared[candidate] === undefined)) {
    findings.push(
      finding(table, fn, `${fn.name} を ${event} が通りますが、event_writes に ${event} がありません`, `event_writes に "${event}: { … }" を足す(そのイベントで他の表に書かないなら {})`, { event }),
    );
  }
  for (const [event, writes] of Object.entries(declared)) {
    // ジョブカタログが無いと realized_by の名指しが見えないので、余るキーは言わない(通らないとは言い切れない)。
    if (jobsKnown && !events.includes(event)) {
      findings.push(
        finding(table, fn, `${fn.name} の event_writes の ${event} は、この RPC を通るイベントではありません`, `${event} を消す(この RPC を通るイベント: ${events.join(', ') || 'なし'})`, { event }),
      );
    }
    for (const [written, kinds] of Object.entries(writes)) {
      const extra = kinds.filter((kind) => !(also[written] ?? []).includes(kind));
      if (extra.length === 0) continue;
      findings.push(
        finding(
          table,
          fn,
          `${fn.name} の event_writes の ${event} が ${written} に ${extra.join(', ')} を宣言していますが、also_writes にありません`,
          'event_writes の各イベントの書き込みは also_writes の部分集合で書く(also_writes は全イベントの和)',
          { event, table: written, kinds: extra.join(',') },
        ),
      );
    }
  }
  for (const [written, kinds] of Object.entries(also)) {
    const unused = kinds.filter((kind) => !Object.values(declared).some((writes) => (writes[written] ?? []).includes(kind)));
    if (unused.length === 0) continue;
    findings.push(
      finding(
        table,
        fn,
        `${fn.name} の also_writes の ${written}: [${unused.join(', ')}] を、event_writes のどのイベントも行いません`,
        'その書き込みを行うイベントの event_writes に足すか、本文が行わないなら also_writes から外す',
        { table: written, kinds: unused.join(',') },
      ),
    );
  }
  return findings;
}

/** 関数 1 本ぶん。 */
function verifyFunction(
  table: DataTableSpec,
  fn: DataFunctionDecl,
  events: readonly string[],
  context: { readonly mirrors: ReadonlySet<string>; readonly jobsKnown: boolean },
): Finding[] {
  const { mirrors } = context;
  const findings: Finding[] = [];
  const self = selfWriteKindsOf(fn) ?? [];
  if (events.length >= 2 && isDestructive(table.table, self, mirrors)) {
    findings.push(
      finding(
        table,
        fn,
        `${fn.name} は ${events.length} つのイベント(${events.join(', ')})が通るのに、帰属表 ${table.table} に破壊的な書き込み(${self.join(', ')})をします`,
        '自表の削除・個人列の消去はイベントごとに宣言できない。イベントごとに RPC を分ける',
        { events: events.join(', ') },
      ),
    );
  }
  if (fn.eventWrites !== undefined) return [...findings, ...declaredFindings(table, fn, events, fn.eventWrites, context.jobsKnown)];
  const destructive = Object.entries(fn.alsoWriteKinds ?? {}).filter(([written, kinds]) => isDestructive(written, kinds, mirrors));
  if (events.length >= 2 && destructive.length > 0) {
    findings.push(
      finding(
        table,
        fn,
        `${fn.name} は ${events.length} つのイベント(${events.join(', ')})が通り、破壊的な書き込み(${destructive.map(([written, kinds]) => `${written}: ${kinds.join('/')}`).join(', ')})を持つのに、event_writes がありません`,
        'event_writes に全部のイベントについて、そのイベントで行う書き込み(also_writes の部分集合。行わないなら {})を書く' +
          '(どのイベントが消すかを宣言しないと、操作の属性は全イベントを破壊的とみなすか、効果の名指しが外れた瞬間に黙って落とす)',
        { events: events.join(', ') },
      ),
    );
  }
  return findings;
}

/**
 * 全 data_table の書き込み RPC の `event_writes` を、通るイベントと also_writes に突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル(状態機械・写しの宣言)
 * @param dataTables 読み込み済みの data_table
 * @param jobs 読み込み済みのジョブカタログ(無ければ realized_by の名指しは数えない)
 * @returns 違反のリスト
 */
export function verifyEventWrites(domain: SpecModel, dataTables: DataTableSpecModel, jobs: JobSpecModel | undefined): Finding[] {
  if (!dataTables.available) return [];
  const byRpc = eventsByRpc(domain, dataTables.tables, jobs);
  const context = { mirrors: mirrorTables(domain, dataTables.tables), jobsKnown: jobs?.available === true && jobs.catalog !== null };
  return dataTables.tables.flatMap((table) =>
    table.functions.filter((fn) => fn.kind === 'rpc').flatMap((fn) => verifyFunction(table, fn, byRpc.get(fn.name) ?? [], context)),
  );
}
