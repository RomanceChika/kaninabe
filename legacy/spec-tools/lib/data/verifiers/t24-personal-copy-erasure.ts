/**
 * T24 **参照を辿って本人に届く個人列と、消去される個人列の写しは、同じ消去で消える**(点検 13 回目 A13-2・14 回目 A14-2・15 回目 A15-3)。
 *
 * V12 / T15 の個人列の判定は「写し先も `personal: true` か」までで、`personal: true` は消去の連鎖を作らない。他の表の消去は、効果を実現する RPC の
 * 書き込みの宣言(`also_writes`)と本文にある。宣言をそろえるだけだと、公開の写しに実名が残ったまま検査が緑になる。
 *
 * 判定(効果 × イベントごと。読むのは宣言だけで、推測しない):
 *
 *   - **消える表** = `anonymizes` の集約の表 + `realized_by[イベント]` の RPC が消す表(`rpc-writes.ts` の `erasedTablesAt`。自表・`also_writes`・呼び先の `scrub` / `delete`)
 *   - 個人列の写し(`effects[].snapshot` の写像と、写しのトリガ)で、写し元も写し先も `personal: true` のものについて、写し元の表が消える表なら、写し先の表も消える表である
 *
 *   - **参照を辿って本人(`ref({anonymizes の集約})`)に届く表の個人列**は、写しでなくても、その表が消える表である。段の数は問わない(`pieces.entry_id → entries.owner_id → members`。点検 15 回目 A15-3)。
 *     `ref` の宣言だけを辿る閉じた閉包で、持ち主かどうかは推測しない。消えない理由があるなら表の `erasure_accept` に、この表の参照の列(`via`。1 段目)・個人列・理由を名指す
 *     (閉じた受け入れ。受け入れた後に個人列が増えれば赤、本人に届かなくなった参照や個人列が消えた受け入れと連鎖に入った表の受け入れは腐りとして赤)
 *
 *   - **消える表でも、道ごとに見る**(点検 16 回目 A16-3)。`scrub` は表の単位で、同じ表に本人へ届く別の道があっても宣言からは見えない。本人へ届く道の全部が、RPC の `scrub_via`(本文でこの道の行を消す)か
 *     `erasure_accept`(この道の行は別の人のもの)のどちらかに載る
 *   - **本人の行が指す表の個人列**(逆向きの道。`members.invited_via` → 招待の宛先メモ。A16-2)は、持ち主が宛先なら `erasure_addressee`、そうでなければ `erasure_accept` に分類する。分類の無い個人列は赤
 *   - **内部テーブル**(entity_spec が無い。A16-7)は、本人へ届く外部キーを持つなら `personal_columns` が必須で(空の並びは「持たない」の宣言)、個人列があれば同じ道の検査に入る
 *
 * 写し元の表が消える表に入らない写しは見ない(元の値が残る表の写しは、この約束の外)。消去の効果を持たない製品は何も鳴らない(J5 と同じ扱い)。
 * 写し先が `personal` でない写しは V12 / T15 が止め、`copy_accept` の `on: personal` で受け入れた写しはここへ来ない。受け入れの口は増やさない。
 * 宣言と本文の一致は、本文を読む rpc-parity と製品の erase-parity が**列の単位で**見る(`scrub` の表の個人列の全部が、その表の set 句にあること。14 回目 A14-1)。
 * ここは本文を読まないので宣言の単位である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 *
 * @oversize 本人へ届く道の数え方(`ref` の閉包・内部テーブルの外部キー・仕組みの表の実行者の列と錨の列)と、道ごとの判定・写しの判定は、
 * 同じ 1 回の消去の文脈(`EraseWhere`)と同じ道の表を読む 1 つの検査で、道の数え方だけを別のファイルへ割ると判定が道の綴りの約束を 2 か所に持つ。
 * @split-review 割る案は、道の数え方(`pathToTarget` / `pathsByColumn` / `internalPaths` / `anchorPath`)を `model/data` の下の道の部品へ出す案。
 * 採らなかった: 道の綴り(`{表}.{列}` の並び)は指摘の文面と腐りの判定(`scrub_via` / `erasure_accept` の `via`)の両方がこの検査の中で読む約束で、
 * ほかに読む検査が無い(部品にすると使い手 1 つの公開の口が増えるだけ)。2 つ目の読み手が現れたら出す。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SourceLocation, SpecModel } from '../../model/types.js';
import { pluralizeEntity } from '../../model/table-name.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import type { JobDecl, JobSpecModel } from '../../model/job/types.js';
import { erasedTablesAt, findRpcByName } from '../../model/data/rpc-writes.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import { copyDeclarationsOf } from '../../world/index.js';
import { frameworkActorColumnsOf, frameworkAnchorColumnsOf } from '../../sql/framework-tables.js';
import { rowsRemovable } from '../../semantics/row-removal.js';
import { digestCoverOf } from '../../usecase/resend-digest-cover.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T24';

/** 個人列の写し 1 本。 */
interface PersonalCopy {
  readonly from: { readonly entity: string; readonly field: string };
  readonly to: { readonly entity: string; readonly field: string };
  readonly location: SourceLocation;
}

/** 列が個人列か。 */
function isPersonal(domain: SpecModel, entity: string, field: string): boolean {
  return findEntityFields(domain, entity)?.find((candidate) => candidate.name === field)?.personal === true;
}

/** 集約名(エンティティ名)の表。 */
function tableOf(domain: SpecModel, entity: string): string {
  for (const specs of domain.aggregates.values()) {
    if (specs.entity?.entity === entity) return specs.entity.table ?? pluralizeEntity(entity);
  }
  return pluralizeEntity(entity);
}

/** スナップショットの写像の写し。 */
function snapshotCopies(domain: SpecModel): readonly PersonalCopy[] {
  const maps = [...domain.aggregates.values()].flatMap((specs) => specs.stateMachines.flatMap((machine) => machine.effects.flatMap((effect) => (effect.snapshot === undefined ? [] : [effect.snapshot]))));
  return maps.flatMap((snapshot) =>
    snapshot.fields.flatMap((map) => {
      const [entity, field, extra] = map.from.split('.');
      return entity === undefined || field === undefined || extra !== undefined ? [] : [{ from: { entity, field }, to: { entity: snapshot.to, field: map.to }, location: map.location }];
    }),
  );
}

/** 写しのトリガの写し。 */
function triggerCopies(domain: SpecModel, dataTables: DataTableSpecModel): readonly PersonalCopy[] {
  return dataTables.tables.flatMap((table) => {
    const entity = table.entity;
    if (entity === undefined) return [];
    return table.triggers.flatMap((trigger) => {
      if (trigger.derives !== undefined) return [];
      return copyDeclarationsOf(domain, entity, trigger.invariant)
        .resolved.filter((copy) => trigger.supplies.includes(copy.column))
        .map((copy) => ({ from: { entity: copy.fromEntity, field: copy.fromColumn }, to: { entity, field: copy.column }, location: { ...table.location, pointer: `triggers.${trigger.name}` } }));
    });
  });
}

/**
 * 集約から `ref` を辿って本人へ届く道(最短。列の並び。届かなければ `null`)。
 *
 * @param domain ドメイン仕様モデル
 * @param from 出発の集約
 * @param target 本人の集約
 * @param seen 辿り済みの集約(循環で止まる)
 * @returns `表の参照の列 → … ` の綴りの並び
 */
function pathToTarget(domain: SpecModel, from: string, target: string, seen: ReadonlySet<string>): readonly string[] | null {
  const hops = (findEntityFields(domain, from) ?? []).flatMap((field) => (field.type.kind === 'ref' ? [{ column: field.name, entity: field.type.entity }] : []));
  const paths = hops.flatMap(({ column, entity }) => {
    const label = `${from}.${column}`;
    if (entity === target) return [[label]];
    if (seen.has(entity)) return [];
    const rest = pathToTarget(domain, entity, target, new Set([...seen, entity]));
    return rest === null ? [] : [[label, ...rest]];
  });
  return shortest(paths);
}

/** 1 段目の参照の列 → 本人への道。 */
function pathsByColumn(domain: SpecModel, entity: string, target: string): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>();
  for (const field of findEntityFields(domain, entity) ?? []) {
    if (field.type.kind !== 'ref') continue;
    const label = `${entity}.${field.name}`;
    if (field.type.entity === target) {
      paths.set(field.name, [label]);
      continue;
    }
    const rest = pathToTarget(domain, field.type.entity, target, new Set([entity, field.type.entity]));
    if (rest !== null) paths.set(field.name, [label, ...rest]);
  }
  return paths;
}

/** 1 回の消去の文脈。 */
interface EraseWhere {
  readonly event: string;
  readonly job: string;
  readonly rpc: string;
  /** 本人の表。 */
  readonly home: string;
  /** 本人の集約。 */
  readonly target: string;
  /** 消す表。 */
  readonly erased: ReadonlySet<string>;
  /** 消去の RPC の `scrub_via`(表 → 参照の列)。 */
  readonly via: Readonly<Record<string, readonly string[]>>;
}

/** 道の並びのうち最短(無ければ null)。 */
function shortest(paths: readonly (readonly string[])[]): readonly string[] | null {
  return paths.reduce<readonly string[] | null>((best, path) => (best === null || path.length < best.length ? path : best), null);
}

/**
 * 保存点の錨の行の id から本人へ届く最短の道(点検 22 回目 A の O22-1)。錨になりうる表は作成の再送の宣言(`resend`)を持つ表で、
 * 要約が誰を覆うかは `usecase/resend-digest-cover.ts` の `digestCoverOf` 1 か所が決める(消去の本文の期待と同じ導出。点検 24 回目 O24-1)。
 * ここは保存点を計画に起こさないので、手順が作る表を「錨を指す表の全部」と広く取り(`created: null`)、参照は ref の宣言で読む。
 * 要約は錨の行と子の行の入力から作るので、子の行にしか載らない人(同行者)の消去でも要約に届く。
 */
function anchorPath(domain: SpecModel, dataTables: readonly DataTableSpec[], target: string, home: string): readonly string[] | null {
  const entityOf = (table: string): string | undefined => dataTables.find((candidate) => candidate.table === table)?.entity;
  const refs = (table: string, to: string): readonly string[] => {
    const from = entityOf(table);
    const pointed = entityOf(to);
    if (from === undefined || pointed === undefined) return [];
    return (findEntityFields(domain, from) ?? []).flatMap((field) => (field.type.kind === 'ref' && field.type.entity === pointed ? [field.name] : []));
  };
  const names = dataTables.map((table) => table.table);
  const anchors = dataTables.filter((table) => table.resend !== undefined && table.entity !== undefined);
  return shortest(
    anchors.flatMap((anchor): (readonly string[])[] => {
      const entity = anchor.entity ?? '';
      // 錨の行が作った後に消えうるなら(定義は T28 と共有の `semantics/row-removal.ts`)、錨が消えると子の行・紐づけの記録の道も一緒に消える。
      // その後の要約には今の関係では届かないので、消去は錨の無い要約も消す(本文は erase-parity が保存点の宣言から導いた期待で見る。点検 23 回目 A23-2)。
      const label = rowsRemovable(domain, dataTables, entity) ? `(錨: ${anchor.table}。錨が消えると道も消える = 消去は錨の無い要約も消す)` : `(錨: ${anchor.table})`;
      if (anchor.table === home) return [[label]];
      return digestCoverOf(anchor.table, null, names, home, refs).map((branch) => {
        const owner = entityOf(branch.from) ?? branch.from;
        if (branch.kind === 'reverse') return [label, `${target}.${branch.column}(本人の行が錨を指す)`];
        if (branch.kind === 'anchor') return [label, `${owner}.${branch.column}`];
        return [label, `${owner}.${branch.up}(錨の子)`, `${owner}.${branch.column}`];
      });
    }),
  );
}

/**
 * 内部テーブルの外部キーから、本人へ届く道(本人の表を直接指すか、指す先の表の集約から `ref` で届くもの)。
 * 仕組みの表の**実行者の列**(設計図の `actorColumns`。外部キーを張らない)も本人の表を直接指す道に数える(点検 21 回目 A21-1)。
 * 保存点の**錨の列**(設計図の `anchorColumns`)は、錨の行か錨の子の行が本人へ届くとき道に数える(`anchorPath`。点検 22 回目 A の O22-1)。
 */
function internalPaths(domain: SpecModel, dataTables: readonly DataTableSpec[], spec: DataTableSpec, target: string, home: string): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>();
  for (const column of frameworkActorColumnsOf(spec.framework)) paths.set(column, [`${spec.table}.${column}`]);
  const anchored = frameworkAnchorColumnsOf(spec.framework).length > 0 ? anchorPath(domain, dataTables, target, home) : null;
  if (anchored !== null) for (const column of frameworkAnchorColumnsOf(spec.framework)) paths.set(column, [`${spec.table}.${column}`, ...anchored]);
  for (const key of spec.foreignKeys) {
    const label = `${spec.table}.${key.column}`;
    if (key.references === home) {
      paths.set(key.column, [label]);
      continue;
    }
    const entity = dataTables.find((table) => table.table === key.references)?.entity;
    const rest = entity === undefined ? null : pathToTarget(domain, entity, target, new Set([entity]));
    if (rest !== null) paths.set(key.column, [label, ...rest]);
  }
  return paths;
}

/** 表の個人列と、本人へ届く道。 */
function reachOf(domain: SpecModel, dataTables: readonly DataTableSpec[], spec: DataTableSpec, where: EraseWhere): { readonly personal: readonly string[]; readonly paths: ReadonlyMap<string, readonly string[]> } {
  if (spec.entity === undefined) return { personal: spec.personalColumns ?? [], paths: internalPaths(domain, dataTables, spec, where.target, where.home) };
  const fields = findEntityFields(domain, spec.entity) ?? [];
  return { personal: fields.filter((field) => field.personal).map((field) => field.name), paths: pathsByColumn(domain, spec.entity, where.target) };
}

/** 本人の行の参照のうち、この表を指すもの(`{本人の表}.{列}`。逆向きの道)。 */
function reverseRefs(domain: SpecModel, spec: DataTableSpec, where: EraseWhere): readonly string[] {
  return (findEntityFields(domain, where.target) ?? []).flatMap((field) => (field.type.kind === 'ref' && field.type.entity === spec.entity ? [`${where.home}.${field.name}`] : []));
}

/** 腐った受け入れと宣言の指摘を作る。 */
function staleFinding(spec: DataTableSpec, key: string, problem: string, via: string): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${spec.table} の ${key} は腐っています: ${problem}`,
    location: { ...spec.location, pointer: key },
    suggestion: '宣言の行を今の参照の列と個人列に直すか、要らなくなった行を消す',
    counterexample: { table: spec.table, via },
  };
}

/** 個人列を持ち、参照を辿って本人へ届く表 1 つぶん(道ごとに見る)。 */
function referencingFindings(domain: SpecModel, dataTables: readonly DataTableSpec[], spec: DataTableSpec, where: EraseWhere): Finding[] {
  const { target, erased } = where;
  const { personal, paths } = reachOf(domain, dataTables, spec, where);
  const accepts = spec.erasureAccepts ?? [];
  const addressees = spec.erasureAddressees ?? [];
  const scrubbed = where.via[spec.table] ?? [];
  const reverse = reverseRefs(domain, spec, where);
  const findings: Finding[] = accepts.flatMap((accept) =>
    [
      ...(paths.has(accept.via) || reverse.includes(accept.via) ? [] : [`via の ${accept.via} は ${target} へ届く参照の列ではありません`]),
      ...accept.columns.filter((column) => !personal.includes(column)).map((column) => `${column} は個人列ではありません`),
      ...(scrubbed.includes(accept.via) ? [`${accept.via} は ${where.rpc} の scrub_via に載っています`] : []),
    ].map((problem) => staleFinding(spec, 'erasure_accept', problem, accept.via)),
  );
  findings.push(
    ...addressees.flatMap((row) =>
      [
        ...(reverse.includes(row.via) ? [] : [`via の ${row.via} は本人の行からこの表を指す参照ではありません`]),
        ...(personal.includes(row.column) ? [] : [`${row.column} は個人列ではありません`]),
        ...(erased.has(spec.table) ? [] : [`${spec.table} は ${where.rpc} の消去の宣言に載っていません`]),
      ].map((problem) => staleFinding(spec, 'erasure_addressee', problem, row.via)),
    ),
  );
  if (spec.internal && paths.size > 0 && spec.personalColumns === undefined) {
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'error',
      message: `内部テーブル ${spec.table} は本人(${target})へ届く外部キー(${[...paths.keys()].join(', ')})を持ちますが、personal_columns の宣言がありません —— 内部テーブルは entity_spec が無いので、個人列の有無を黙って「無い」と読みません`,
      location: spec.location,
      suggestion: '個人列があれば personal_columns に並べ、無ければ personal_columns: [] と書く',
      counterexample: { table: spec.table },
    });
  }
  for (const column of scrubbed) {
    if (!paths.has(column)) findings.push(staleFinding(spec, 'scrub_via', `${column} は ${target} へ届く参照の列ではありません`, column));
    if (!erased.has(spec.table)) findings.push(staleFinding(spec, 'scrub_via', `${spec.table} は ${where.rpc} の消去の宣言に載っていません`, column));
  }
  for (const [via, path] of paths) {
    if (scrubbed.includes(via)) continue;
    const accepted = accepts.filter((accept) => accept.via === via).flatMap((accept) => accept.columns);
    const missing = personal.filter((column) => !accepted.includes(column));
    if (missing.length === 0) continue;
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'error',
      message:
        `${spec.table}.${via} は本人(${target})へ届く参照(${[...path, target].join(' → ')})で、この道の個人列(${missing.join(', ')})は、消去(${where.event} の ${where.job} を実現する ${where.rpc})で消えません` +
        ' —— 表が消去の宣言に載っていても、別の道の行に届くとは限りません(personal: true と書いても、消去の連鎖に入れる手順は自動では起きません)',
      location: spec.location,
      suggestion: `${where.rpc} の also_writes に "${spec.table}: [scrub]"(行ごと消すなら delete)と scrub_via に "${spec.table}: [${via}]" を足して本文でこの道の行を消す。本人の個人データではないなら、表の erasure_accept に via(この表の参照の列)/ columns / reason を書く`,
      counterexample: { table: spec.table, via, columns: missing.join(', '), rpc: where.rpc, event: where.event },
    });
  }
  for (const via of reverse) {
    const classified = [...accepts.filter((accept) => accept.via === via).flatMap((accept) => accept.columns), ...addressees.filter((row) => row.via === via).map((row) => row.column)];
    const missing = personal.filter((column) => !classified.includes(column));
    if (missing.length === 0) continue;
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'error',
      message: `${via} は本人の行から ${spec.table} を指す参照で、この表の個人列(${missing.join(', ')})の持ち主が本人かどうかの分類がありません —— 消去の閉包は「表 → 本人」の向きしか辿らないので、本人を指す行の宛先の値を見落とします`,
      location: spec.location,
      suggestion: `持ち主が宛先(本人)なら erasure_addressee に column / via: ${via} / reason を書いて本文で消す。本人の個人データではないなら erasure_accept に via: ${via} を書く`,
      counterexample: { table: spec.table, via, columns: missing.join(', '), rpc: where.rpc, event: where.event },
    });
  }
  return findings;
}

/** 効果 1 本の 1 イベントぶん。 */
function checkEvent(domain: SpecModel, dataTables: DataTableSpecModel, job: JobDecl, event: string, rpc: string, copies: readonly PersonalCopy[]): Finding[] {
  const fn = findRpcByName(dataTables.tables, rpc);
  if (fn === undefined || job.anonymizes === undefined) return []; // RPC の実在は T19 が見る
  const target = job.anonymizes;
  const home = tableOf(domain, target);
  const erased = new Set([home, ...erasedTablesAt(dataTables.tables, fn, event)]);
  const where: EraseWhere = { event, job: job.id, rpc, home, target, erased, via: fn.scrubVia ?? {} };
  const referencing = dataTables.tables.filter((spec) => spec.table !== home).flatMap((spec) => referencingFindings(domain, dataTables.tables, spec, where));
  const copied = copies.flatMap((copy): Finding[] => {
    const source = tableOf(domain, copy.from.entity);
    const target = tableOf(domain, copy.to.entity);
    if (!erased.has(source) || erased.has(target)) return [];
    return [
      {
        verifier: VERIFIER_ID,
        severity: 'error',
        message:
          `${copy.from.entity}.${copy.from.field} → ${copy.to.entity}.${copy.to.field} は個人列の写しですが、消去(${event} の ${job.id} を実現する ${rpc})の書き込みの宣言に ${target} がありません —— ` +
          '写し先を personal: true にしても、元の行を消去した後に写しの値が残ります',
        location: copy.location,
        suggestion: `${rpc} の also_writes に "${target}: [scrub]"(行ごと消すなら delete)を足し、本文で ${copy.to.field} を消す。値が個人に結びつかないなら、写し先の personal を外して copy_accept の on: personal に理由を書く`,
        counterexample: { from: `${copy.from.entity}.${copy.from.field}`, to: `${copy.to.entity}.${copy.to.field}`, rpc, event },
      },
    ];
  });
  return [...referencing, ...copied];
}

/**
 * 消去の効果ごとに、本人への参照を持つ個人列と個人列の写しが同じ消去で消えるかを見る。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @param jobs 読み込み済みのジョブカタログ(読めない構成では見ない)
 * @returns 違反のリスト
 */
export function verifyPersonalCopyErasure(domain: SpecModel, dataTables: DataTableSpecModel, jobs: JobSpecModel | undefined): Finding[] {
  if (jobs?.available !== true || jobs.catalog === null) return [];
  const erasing = jobs.catalog.jobs.filter((job) => job.anonymizes !== undefined);
  if (erasing.length === 0) return [];
  const copies = [...snapshotCopies(domain), ...triggerCopies(domain, dataTables)].filter((copy) => isPersonal(domain, copy.from.entity, copy.from.field) && isPersonal(domain, copy.to.entity, copy.to.field));
  return erasing.flatMap((job) => Object.entries(job.realizedBy ?? {}).flatMap(([event, rpc]) => checkEvent(domain, dataTables, job, event, rpc, copies)));
}
