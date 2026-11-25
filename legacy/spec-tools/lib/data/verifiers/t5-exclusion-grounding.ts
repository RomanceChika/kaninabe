/**
 * T5 排他制約の接地(invariant_spec の `formal.type: exclusion` ⇔ data_table の `exclusions`)。
 *
 * 期間の重なりの禁止は**宣言と執行が離れて住む**。宣言は不変条件の形式定義
 * (`keys` + `range`)、執行は DB の排他制約(`exclude using gist`)であり、
 * 片方だけを直すと「宣言はあるのに誰も守っていない」「制約はあるのに何のためか読めない」に
 * なる。この検証器は 3 つを見る。
 *
 *   - (a) `formal.type: exclusion` の不変条件は、`enforced_by` に `kind: db_constraint` を
 *     1 つ以上持ち、その `ref` が**実在する排他制約の宣言**を指すこと
 *   - (b) `exclusions[].invariant` が実在する不変条件を指し、その形式定義が `exclusion` であること
 *   - (c) 宣言の中身(`keys` / `range` / `where` の条件)が不変条件と制約で一致していること
 *
 * (c) が要るのは、名前だけを合わせて中身がずれた宣言が一番静かだからである ——
 * 「鍵ごとに重ならない」と書いてあるのに制約は別の鍵ごと、という食い違いは DB を見ない限り
 * 分からない。実 DB との突合(制約の実在・鍵・期間・`where` の条件)は統合テスト
 * (data-table-parity)が `pg_get_constraintdef` と突き合わせる。
 *
 * **`where` は中身まで比べる(点検 14 回目 A14-3)。** 不変条件の側はガード式(`state not in [cancelled]`)、data_table の側は SQL 断片(`state <> 'cancelled'`)で
 * 語彙が違うので、どちらも閉じた原子の連言に読み替えて比べる(`partial-condition.ts`。T23 と同じ読み手)。読めない形は同じ条件だと言えないので error にする。
 */

import type { InvariantDef, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import type { DataExclusionDecl } from '../../model/data/types-shape.js';
import { parseFormalGuard } from '../../guard/parser.js';
import { atomsOfGuard, atomsOfSql, sameAtoms } from '../partial-condition.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T5';

/** T5 の指摘を組み立てる。 */
function t5(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 排他制約の宣言 1 本と、それを持つ表。 */
interface OwnedExclusion {
  readonly spec: DataTableSpec;
  readonly decl: DataExclusionDecl;
}

/**
 * 排他制約の宣言と不変条件の突合を実行する。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyExclusionGrounding(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  const byName = new Map<string, OwnedExclusion>();
  for (const spec of dataTables.tables) {
    for (const decl of spec.exclusions) byName.set(decl.name, { spec, decl });
  }
  const invariants = new Map<string, InvariantDef>();
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) invariants.set(invariant.id, invariant);
  }

  return [
    ...[...invariants.values()].flatMap((invariant) => checkInvariantSide(invariant, byName)),
    ...[...byName.values()].flatMap((owned) => checkTableSide(owned, invariants)),
  ];
}

/** (a)(c) 不変条件の側から: 執行点が実在する排他制約を指し、中身が一致すること。 */
function checkInvariantSide(invariant: InvariantDef, byName: ReadonlyMap<string, OwnedExclusion>): Finding[] {
  const formal = invariant.formal;
  if (formal?.kind !== 'exclusion') return [];
  const refs = invariant.enforcedBy.filter((enforcement) => enforcement.kind === 'db_constraint');
  if (refs.length === 0) {
    return [
      t5({
        message: `${invariant.id}: formal.type: exclusion なのに db_constraint の執行点がありません`,
        location: invariant.location,
        suggestion:
          'enforced_by に "- kind: db_constraint / ref: {排他制約の名前}" を足し、data_table の exclusions に' +
          '同じ名前で宣言する(期間の重なりを止められるのは DB の排他制約だけである)',
        counterexample: { invariant: invariant.id, enforced_by: invariant.enforcedBy.map((e) => e.kind).join(', ') },
      }),
    ];
  }
  const matched = refs.map((enforcement) => byName.get(enforcement.ref)).filter((owned) => owned !== undefined);
  if (matched.length === 0) {
    return [
      t5({
        message: `${invariant.id}: 執行点(${refs.map((e) => e.ref).join(' / ')})に対応する排他制約の宣言がありません`,
        location: invariant.location,
        suggestion:
          'data_table の exclusions に "- name: {同じ名前} / keys / range" を足す' +
          '(排他制約は一意索引ではないので indexes には書けない)',
        counterexample: { invariant: invariant.id, refs: refs.map((e) => e.ref).join(', ') },
      }),
    ];
  }
  return matched.flatMap((owned) => compare(invariant, owned));
}

/** (c) 宣言の中身(keys / range / where の条件)が不変条件と制約で一致していること。 */
function compare(invariant: InvariantDef, owned: OwnedExclusion): Finding[] {
  const formal = invariant.formal;
  if (formal?.kind !== 'exclusion') return [];
  const findings: Finding[] = [];
  const location = { ...owned.spec.location, pointer: `exclusions.${owned.decl.name}` };
  findings.push(...compareWhere(invariant, owned));
  if (formal.keys.join(',') !== owned.decl.keys.join(',')) {
    findings.push(
      t5({
        message:
          `排他制約 ${owned.decl.name} の keys(${owned.decl.keys.join(', ')})が ` +
          `${invariant.id} の formal.keys(${formal.keys.join(', ')})と一致しません`,
        location,
        suggestion: 'どちらかを直して同じ列を同じ順で並べる(正は不変条件の側。制約はその執行点である)',
        counterexample: { constraint: owned.decl.name, declared: owned.decl.keys.join(', '), formal: formal.keys.join(', ') },
      }),
    );
  }
  if (formal.range.join(',') !== owned.decl.range.join(',')) {
    findings.push(
      t5({
        message:
          `排他制約 ${owned.decl.name} の range([${owned.decl.range.join(', ')}])が ` +
          `${invariant.id} の formal.range([${formal.range.join(', ')}])と一致しません`,
        location,
        suggestion: 'どちらかを直して同じ 2 列を同じ順で並べる(端の扱いは半開区間に固定されており、宣言では選べない)',
        counterexample: { constraint: owned.decl.name, declared: owned.decl.range.join(', '), formal: formal.range.join(', ') },
      }),
    );
  }
  return findings;
}

/** (c) `formal.where` と制約の `where` が同じ条件か。 */
function compareWhere(invariant: InvariantDef, owned: OwnedExclusion): Finding[] {
  const formal = invariant.formal;
  if (formal?.kind !== 'exclusion') return [];
  const { decl, spec } = owned;
  const parsed = formal.where === undefined ? undefined : parseFormalGuard(formal.where);
  const stated = parsed === undefined ? [] : parsed.ok ? atomsOfGuard(parsed.expr, spec.entity ?? spec.table) : null;
  const declared = decl.where === undefined ? [] : atomsOfSql(decl.where);
  if (stated !== null && declared !== null && sameAtoms(stated, declared)) return [];
  const unreadable = stated === null || declared === null;
  return [
    t5({
      message: unreadable
        ? `排他制約 ${decl.name} の where(${decl.where ?? 'なし'})と ${invariant.id} の formal.where(${formal.where ?? 'なし'})は、比べられる形ではありません`
        : `排他制約 ${decl.name} の where(${decl.where ?? 'なし'})が ${invariant.id} の formal.where(${formal.where ?? 'なし'})と同じ条件ではありません`,
      location: { ...spec.location, pointer: `exclusions.${decl.name}` },
      suggestion:
        '両方を同じ条件にする。比べられる形は、自分の列の等号・不等号・in・not in・is null・is not null の and だけである' +
        '(片方だけが部分制約だと、「全部の行で重なり禁止」と「一部の行は対象外」が宣言と執行に分かれて住む)',
      counterexample: { constraint: decl.name, declared: decl.where ?? '(なし)', formal: formal.where ?? '(なし)' },
    }),
  ];
}

/** (b) 表の側から: `invariant` が実在し、その形式定義が exclusion であること。 */
function checkTableSide(owned: OwnedExclusion, invariants: ReadonlyMap<string, InvariantDef>): Finding[] {
  const id = owned.decl.invariant;
  const location = { ...owned.spec.location, pointer: `exclusions.${owned.decl.name}` };
  if (id === undefined) {
    return [
      t5({
        message: `排他制約 ${owned.decl.name} に由来の不変条件(invariant)がありません`,
        location,
        suggestion:
          'invariant に由来する不変条件 ID を書く(排他制約は業務の禁止そのものなので、' +
          '何を守っているかが仕様の側に無いと意味が読めない)',
        counterexample: { constraint: owned.decl.name, table: owned.spec.table },
      }),
    ];
  }
  const invariant = invariants.get(id);
  if (invariant === undefined) {
    return [
      t5({
        message: `排他制約 ${owned.decl.name} の invariant ${id} は実在しません`,
        location,
        suggestion: '綴りを直すか、その不変条件を invariants.md に宣言する',
        counterexample: { constraint: owned.decl.name, invariant: id },
      }),
    ];
  }
  if (invariant.formal?.kind === 'exclusion') return [];
  return [
    t5({
      message: `排他制約 ${owned.decl.name} の由来 ${id} は formal.type: exclusion ではありません`,
      location,
      suggestion:
        `${id} の formal を "type: exclusion / keys / range" に書き換える` +
        '(期間の重なりを止める制約の由来が uniqueness だと、宣言は鍵の一致しか言っていないことになる)',
      counterexample: { constraint: owned.decl.name, invariant: id, formal: invariant.formal?.kind ?? '(なし)' },
    }),
  ];
}
