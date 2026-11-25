/**
 * T26 **送信の上限の接地**(`functions[].send_limit`。正: ARCH-SP-BE-0001 §送信の上限)。
 *
 * 宣言の中だけで決まる形(鍵・語・本数と幅)はパーサーが見る。ここは宣言の外の事実と突き合わせる。
 *
 *   - `kind: send_limit` は `send_limit` を持ち、本文の書き出し先 `migration` を宣言する(本文は生成物だけ。手書きの口は無い)
 *   - 関数名は `send_limit_` で始まり、数える表(outbox = `jobs`)の data_table に置く(数えるのも積むのもその表)
 *   - `args` / `params` は宣言から導いた署名(種別・鍵・payload の欄の順)と一致する(呼ぶ側の本文が名前で呼ぶ)
 *   - `types` の各種別はジョブカタログにある(数える種別と積む種別は同じ 1 つの並び。カタログに無い種別を積めない)
 *   - `blocked` の表は data_table にあり、列はその集約の**状態の欄**、値はその状態機械の状態(閉じた値域だけ)
 *   - `unit.via`(数える単位の辿り方)の各歩は、data_table の表の entity_spec の**参照の欄**(`ref(…)`)で、行き先がその参照の集約の表。
 *     歩は途切れず(前の行き先 = 次の表)、最後の行き先は最初の表(単位は鍵と同じ種類の値。例: メンバー → 招待 → 発行したメンバー)
 *   - `unit`(数える単位の欄)は**試験段階で未決**(2026-11-05 コーディネーターの決定)。宣言すると、接地とは別に警告を 1 件出す
 *     (製品の仕様では `--fail-on-unclassified` の門で止まる = 使うかどうかを決めるまで出荷に載せない)
 *   - どこかの `kind: rpc` が `calls` でこの関数を名指し、その表の集約が `event` の集約と同じ(呼ばれない上限は何も止めない)
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel, SendLimitDecl, SendLimitKey } from '../../model/data/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import { entityStateView } from '../../semantics/entity-state-axes.js';
import { SEND_LIMIT_JOBS_TABLE, SEND_LIMIT_PREFIX, sendLimitSignature } from '../../sql/send-limit.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T26';

/** T26 の指摘を組み立てる。 */
function t26(table: DataTableSpec, fn: DataFunctionDecl, message: string, suggestion: string, counterexample: Readonly<Record<string, string>> = {}): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message,
    location: { ...table.location, pointer: `functions.${fn.name}` },
    suggestion,
    counterexample: { function: fn.name, ...counterexample },
  };
}

/** 置き場・名前・書き出し先・署名。 */
function shapeFindings(table: DataTableSpec, fn: DataFunctionDecl, decl: SendLimitDecl): Finding[] {
  const findings: Finding[] = [];
  if (fn.migration === undefined) {
    findings.push(t26(table, fn, `${fn.name} は送信の上限ですが migration(本文の書き出し先)の宣言がありません`, `migration に {14 桁}_${fn.name}.sql を書く(本文は宣言から生成する)`));
  }
  if (!fn.name.startsWith(SEND_LIMIT_PREFIX)) {
    findings.push(t26(table, fn, `送信の上限の関数名 ${fn.name} が ${SEND_LIMIT_PREFIX} で始まっていません`, `名前を ${SEND_LIMIT_PREFIX}{名前} にする(名前から種類が読める)`));
  }
  if (table.table !== SEND_LIMIT_JOBS_TABLE) {
    findings.push(
      t26(table, fn, `送信の上限 ${fn.name} が ${table.table} の data_table にあります`, `数える表であり積む表である ${SEND_LIMIT_JOBS_TABLE} の data_table に移す`, { table: table.table }),
    );
  }
  const signature = sendLimitSignature(decl);
  if (signature.args.join(',') !== fn.args.join(',') || signature.params.join(',') !== fn.params.join(',')) {
    findings.push(
      t26(
        table,
        fn,
        `${fn.name} の args / params が宣言から導いた署名と一致しません`,
        `args: [${signature.args.join(', ')}] と params: [${signature.params.join(', ')}] を書く(種別・keys の順・payload の順)`,
        { args: fn.args.join(','), params: fn.params.join(',') },
      ),
    );
  }
  return findings;
}

/** 種別がジョブカタログにあること(カタログが読めなければ見ない)。 */
function typeFindings(table: DataTableSpec, fn: DataFunctionDecl, decl: SendLimitDecl, jobs: JobSpecModel | undefined): Finding[] {
  const catalog = jobs?.catalog;
  if (catalog === null || catalog === undefined) return [];
  const known = new Set(catalog.jobs.map((job) => job.id));
  return decl.types
    .filter((type) => !known.has(type))
    .map((type) => t26(table, fn, `${fn.name} の types の ${type} はジョブカタログにありません`, 'types にはジョブカタログ(jobs.md)の ID だけを書く', { type }));
}

/** `blocked` の表・列・値。 */
function blockedFindings(table: DataTableSpec, fn: DataFunctionDecl, decl: SendLimitDecl, domain: SpecModel, tables: readonly DataTableSpec[]): Finding[] {
  const findings: Finding[] = [];
  for (const key of decl.keys) {
    const blocked = key.blocked;
    if (blocked === undefined) continue;
    const target = tables.find((candidate) => candidate.table === blocked.table);
    const view = target?.entity === undefined ? null : entityStateView(domain, target.entity);
    const axis = view?.axes.find((candidate) => candidate.stateField === blocked.column);
    if (axis === undefined) {
      findings.push(
        t26(
          table,
          fn,
          `${fn.name} の鍵 ${key.name} の blocked は ${blocked.table}.${blocked.column} を指しますが、data_table の表の状態の欄ではありません`,
          'blocked は鍵が指す表(data_table)の、entity_spec の state(...) 型の欄だけを書く(値域が閉じた欄だけ)',
          { key: key.name, table: blocked.table, column: blocked.column },
        ),
      );
      continue;
    }
    for (const value of blocked.values.filter((candidate) => !axis.machine.states.includes(candidate))) {
      findings.push(
        t26(table, fn, `${fn.name} の鍵 ${key.name} の blocked の値 ${value} は状態機械 ${axis.machine.machine} の状態にありません`, `値は ${axis.machine.states.join(' / ')} から書く`, {
          key: key.name,
          value,
        }),
      );
    }
  }
  return findings;
}

/** 1 歩の問題(無ければ null)。 */
function hopProblem(hop: { readonly table: string; readonly column: string; readonly to: string }, domain: SpecModel, tables: readonly DataTableSpec[]): string | null {
  const from = tables.find((candidate) => candidate.table === hop.table);
  const to = tables.find((candidate) => candidate.table === hop.to);
  if (from?.entity === undefined || to?.entity === undefined) return `${hop.table} → ${hop.to} のどちらかが entity を持つ data_table の表ではありません`;
  const field = findEntitySpec(domain, from.entity)?.fields.find((candidate) => candidate.name === hop.column);
  if (field?.type.kind !== 'ref') return `${hop.table}.${hop.column} は参照の欄(ref)ではありません`;
  return field.type.entity === to.entity ? null : `${hop.table}.${hop.column} の参照先は ${field.type.entity} で、${hop.to}(${to.entity})ではありません`;
}

/** `unit.via` の歩の接地(参照の欄・途切れない・最初の表へ戻る)。 */
function unitFindings(table: DataTableSpec, fn: DataFunctionDecl, key: SendLimitKey, domain: SpecModel, tables: readonly DataTableSpec[]): Finding[] {
  const via = key.unit?.via ?? [];
  const problems = via.flatMap((hop, index) => {
    const own = hopProblem(hop, domain, tables);
    const previous = index === 0 ? undefined : via[index - 1];
    const gap = previous !== undefined && previous.to !== hop.table ? `歩が途切れています(${previous.to} の次が ${hop.table})` : null;
    return [own, gap].filter((problem): problem is string => problem !== null);
  });
  const first = via[0];
  const last = via[via.length - 1];
  if (first !== undefined && last !== undefined && last.to !== first.table) problems.push(`最後の行き先 ${last.to} が最初の表 ${first.table} ではありません(単位は鍵と同じ種類の値)`);
  return problems.map((problem) =>
    t26(table, fn, `${fn.name} の鍵 ${key.name} の unit: ${problem}`, 'unit.via は参照の欄(entity_spec の ref)を順に辿り、鍵と同じ表へ戻る形で書く(例: members.invited_via → invitations.issued_by → members)', {
      key: key.name,
    }),
  );
}

/** `unit` の宣言が試験段階(未決)であることの警告の理由の語。 */
export const UNIT_EXPERIMENTAL_REASON = 'send_limit_unit_experimental';

/**
 * `unit` を宣言した鍵への警告(試験段階で未決。2026-11-05 コーディネーターの決定)。
 *
 * 辿り方の接地(`unitFindings`)は宣言どおりに見る。ここは「使ってよいかがまだ決まっていない」ことを、宣言した場所で 1 件だけ言う。
 */
function unitExperimentalFindings(table: DataTableSpec, fn: DataFunctionDecl, key: SendLimitKey): Finding[] {
  if (key.unit === undefined) return [];
  return [
    {
      ...t26(
        table,
        fn,
        `${fn.name} の鍵 ${key.name} が unit(数える単位)を宣言しています。unit は試験段階で、使うかどうかは未決です`,
        'unit を外して鍵の値ごとに数える(既定)。使う必要があるなら、決定を仰いでから ARCH-SP-BE-0001 §送信の上限の「試験段階」の記述を外す',
        { key: key.name },
      ),
      severity: 'warning',
      reason: UNIT_EXPERIMENTAL_REASON,
    },
  ];
}

/** 呼ぶ RPC が居て、その集約が `event` の集約であること。 */
function callerFindings(table: DataTableSpec, fn: DataFunctionDecl, decl: SendLimitDecl, tables: readonly DataTableSpec[]): Finding[] {
  const callers = tables.flatMap((candidate) =>
    candidate.functions.filter((other) => other.kind === 'rpc' && (other.calls ?? []).includes(fn.name)).map((other) => ({ table: candidate, fn: other })),
  );
  if (callers.length === 0) {
    return [t26(table, fn, `送信の上限 ${fn.name} を calls で名指す RPC がありません(呼ばれない上限は何も止めません)`, '積む RPC の calls に名前を足す(本文はその関数を呼んで積む)。使わないなら宣言を消す')];
  }
  const aggregate = decl.event.split('.')[0];
  return callers
    .filter((caller) => caller.table.entity !== aggregate)
    .map((caller) =>
      t26(table, fn, `${fn.name} の event ${decl.event} は、呼ぶ RPC ${caller.fn.name}(集約 ${caller.table.entity ?? '—'})の操作ではありません`, 'event には呼ぶ RPC の集約の操作 ID を書く(拒否の本文の操作が、その RPC を呼ぶ操作になる)', {
        caller: caller.fn.name,
      }),
    );
}

/**
 * 全 data_table の送信の上限を検証する。
 *
 * @param domain ドメイン仕様(状態の欄と状態機械を引く)
 * @param dataTables 読み込み済みの data_table
 * @param jobs ジョブカタログ(無ければ種別の接地を見ない)
 * @returns 違反のリスト
 */
export function verifySendLimits(domain: SpecModel, dataTables: DataTableSpecModel, jobs?: JobSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    for (const fn of table.functions) {
      if (fn.kind !== 'send_limit') continue;
      const decl = fn.sendLimit;
      if (decl === undefined) continue;
      findings.push(
        ...shapeFindings(table, fn, decl),
        ...typeFindings(table, fn, decl, jobs),
        ...blockedFindings(table, fn, decl, domain, dataTables.tables),
        ...decl.keys.flatMap((key) => [...unitFindings(table, fn, key, domain, dataTables.tables), ...unitExperimentalFindings(table, fn, key)]),
        ...callerFindings(table, fn, decl, dataTables.tables),
      );
    }
  }
  return findings;
}
