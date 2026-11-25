/**
 * T23 **一意の不変条件 ⇔ 実際の一意の索引**の接地(点検 13 回目 A13-1)。
 *
 * 一意の約束は宣言(`formal.keys`)と執行(data_table の `indexes[]`)が離れて住む。DB で効くのは索引だけで、DDL は索引の `on` / `unique` / `where` から
 * そのまま作られる。宣言だけを見ると、`keys` が境界を含んでいても索引が鍵を落とす形・`unique` を書き忘れた形が黙る(実 DB で `23505` を実測)。
 * 排他制約の T5 と同じ線で、両方向に見る。
 *
 *   - (a) `formal.type: uniqueness` の不変条件は、`enforced_by` の `db_constraint` が実在する索引を指す
 *   - (b) その索引は `unique: true`、`on` の列の集合が `keys` と一致、`where` が `formal.where` と同じ条件、`invariant` がこの不変条件を指す、表がこの不変条件の集約の表である
 *   - (c) `indexes[].invariant` は実在する不変条件を指し、その形式定義が `uniqueness` で、`enforced_by` がその索引を名指す
 *
 * `invariant` を持たない一意の索引のテナントの範囲は V26 が見る。
 *
 * ## `where` の比べ方
 *
 * `formal.where` はガード式、索引の `where` は SQL 断片で語彙が違う。どちらも**閉じた原子の連言**に読み替えて比べる(`partial-condition.ts`)。読めない形は
 * 同じ条件だと言えないので error にする(推測で通さない)。`formal.where` が無くて索引が鍵の列の `is not null` だけを持つ形は同じ意味である
 * (NULL は一意の索引で衝突しない)ので通す。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { InvariantDef, SpecModel } from '../../model/types.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import type { DataIndexDecl } from '../../model/data/types-shape.js';
import { parseFormalGuard } from '../../guard/parser.js';
import { atomsOfGuard, atomsOfSql, sameAtoms, type ConditionAtom } from '../partial-condition.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T23';

/** T23 の指摘を組み立てる。 */
function t23(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 索引 1 本と、それを持つ表。 */
interface OwnedIndex {
  readonly spec: DataTableSpec;
  readonly decl: DataIndexDecl;
}

/** 不変条件 1 本と、それが住む集約。 */
interface OwnedInvariant {
  readonly aggregate: string;
  readonly invariant: InvariantDef;
}

/** 索引の宣言の位置。 */
function indexLocation(owned: OwnedIndex): Finding['location'] {
  return { ...owned.spec.location, pointer: `indexes.${owned.decl.name}` };
}

/** (a) 不変条件の側から。 */
function checkInvariantSide(owned: OwnedInvariant, indexes: ReadonlyMap<string, OwnedIndex>, domain: SpecModel): Finding[] {
  const { invariant } = owned;
  if (invariant.formal?.kind !== 'uniqueness') return [];
  const refs = invariant.enforcedBy.filter((enforcement) => enforcement.kind === 'db_constraint').map((enforcement) => enforcement.ref);
  const found = refs.flatMap((ref) => indexes.get(ref) ?? []);
  if (found.length > 0 && found.length === refs.length) return found.flatMap((index) => compare(owned, index, domain));
  const missing = refs.filter((ref) => !indexes.has(ref));
  return [
    t23({
      message:
        refs.length === 0
          ? `${invariant.id}: formal.type: uniqueness なのに db_constraint の執行点がありません`
          : `${invariant.id}: 執行点(${missing.join(' / ')})に対応する索引の宣言がありません`,
      location: invariant.location,
      suggestion: 'enforced_by に "- kind: db_constraint / ref: {索引の名前}" を書き、data_table の indexes に同じ名前で unique: true の索引を宣言する(一意を守れるのは DB の一意の索引だけである)',
      counterexample: { invariant: invariant.id, refs: refs.join(', ') },
    }),
  ];
}

/** (b) 索引の中身が不変条件と一致すること。 */
function compare(owned: OwnedInvariant, index: OwnedIndex, domain: SpecModel): Finding[] {
  const { invariant, aggregate } = owned;
  const formal = invariant.formal;
  if (formal?.kind !== 'uniqueness') return [];
  const location = indexLocation(index);
  const { decl } = index;
  const common = { location };
  const findings: Finding[] = [];
  const entity = domain.aggregates.get(aggregate)?.entity?.entity;
  if (index.spec.entity !== entity) {
    findings.push(
      t23({ ...common, message: `索引 ${decl.name} の表 ${index.spec.table} は ${invariant.id} の集約 ${aggregate} の表ではありません`, suggestion: 'keys の列を持つ集約の表に索引を置く', counterexample: { index: decl.name, table: index.spec.table, aggregate } }),
    );
  }
  if (!decl.unique) {
    findings.push(t23({ ...common, message: `索引 ${decl.name} は ${invariant.id} の執行点なのに unique: true がありません`, suggestion: 'unique: true を足す(ふつうの索引は重複を止めない)', counterexample: { index: decl.name, invariant: invariant.id } }));
  }
  if ([...decl.on].sort().join(',') !== [...formal.keys].sort().join(',')) {
    findings.push(
      t23({
        ...common,
        message: `索引 ${decl.name} の on(${decl.on.join(', ')})が ${invariant.id} の formal.keys(${formal.keys.join(', ')})と同じ列の集合ではありません`,
        suggestion: 'どちらかを直して同じ列にする(正は不変条件の側。索引はその執行点である。列が多い索引は不変条件より弱く、少ない索引は別の行を止める)',
        counterexample: { index: decl.name, on: decl.on.join(', '), keys: formal.keys.join(', ') },
      }),
    );
  }
  findings.push(...compareWhere(owned, index, entity ?? aggregate));
  if (decl.invariant !== invariant.id) {
    findings.push(
      t23({ ...common, message: `索引 ${decl.name} の invariant(${decl.invariant ?? 'なし'})が、この索引を執行点と宣言した ${invariant.id} を指していません`, suggestion: `indexes の行に "invariant: ${invariant.id}" を書く`, counterexample: { index: decl.name, invariant: invariant.id } }),
    );
  }
  return findings;
}

/** 鍵の列が空でないことだけを言う条件か(NULL は一意の索引で衝突しないので、条件が無いのと同じ意味である)。 */
function onlyNotNull(atoms: readonly ConditionAtom[], keys: readonly string[]): boolean {
  return atoms.every((atom) => atom.op === 'not_null' && keys.includes(atom.column));
}

/** `formal.where` と索引の `where` が同じ条件か。 */
function compareWhere(owned: OwnedInvariant, index: OwnedIndex, entity: string): Finding[] {
  const formal = owned.invariant.formal;
  if (formal?.kind !== 'uniqueness') return [];
  const { decl } = index;
  const parsed = formal.where === undefined ? undefined : parseFormalGuard(formal.where);
  const stated = parsed === undefined ? [] : parsed.ok ? atomsOfGuard(parsed.expr, entity) : null;
  const declared = decl.where === undefined ? [] : atomsOfSql(decl.where);
  if (stated !== null && declared !== null && (sameAtoms(stated, declared) || (stated.length === 0 && onlyNotNull(declared, formal.keys)))) return [];
  const unreadable = stated === null || declared === null;
  return [
    t23({
      location: indexLocation(index),
      message: unreadable
        ? `索引 ${decl.name} の where(${decl.where ?? 'なし'})と ${owned.invariant.id} の formal.where(${formal.where ?? 'なし'})は、比べられる形ではありません`
        : `索引 ${decl.name} の where(${decl.where ?? 'なし'})が ${owned.invariant.id} の formal.where(${formal.where ?? 'なし'})と同じ条件ではありません`,
      suggestion:
        '両方を同じ条件にする。比べられる形は、自分の列の等号・不等号・in・not in・is null・is not null の and だけである' +
        '(片方だけが部分索引だと「全部の行で一意」と「一部の行は対象外」が宣言と執行に分かれて住む)',
      counterexample: { index: decl.name, declared: decl.where ?? '(なし)', formal: formal.where ?? '(なし)' },
    }),
  ];
}

/** (c) 索引の側から。 */
function checkIndexSide(index: OwnedIndex, invariants: ReadonlyMap<string, OwnedInvariant>): Finding[] {
  const id = index.decl.invariant;
  if (id === undefined) return [];
  const location = indexLocation(index);
  const name = index.decl.name;
  const invariant = invariants.get(id)?.invariant;
  if (invariant === undefined) {
    return [t23({ location, message: `索引 ${name} の invariant ${id} は実在しません`, suggestion: '綴りを直すか、その不変条件を invariants.md に宣言する', counterexample: { index: name, invariant: id } })];
  }
  if (invariant.formal?.kind !== 'uniqueness') {
    return [
      t23({
        location,
        message: `索引 ${name} の由来 ${id} は formal.type: uniqueness ではありません`,
        suggestion: '不変条件に formal.type: uniqueness と keys を書くか、一意の約束でないなら索引の invariant を外す',
        counterexample: { index: name, invariant: id, formal: invariant.formal?.kind ?? '(なし)' },
      }),
    ];
  }
  if (invariant.enforcedBy.some((enforcement) => enforcement.kind === 'db_constraint' && enforcement.ref === name)) return [];
  return [
    t23({
      location,
      message: `索引 ${name} の由来 ${id} の enforced_by が、この索引を名指していません`,
      suggestion: `${id} の enforced_by に "- kind: db_constraint / ref: ${name}" を書く(名指しが無いと、DB の拒否を不変条件へ返せない)`,
      counterexample: { index: name, invariant: id },
    }),
  ];
}

/**
 * 一意の不変条件と索引の突合を実行する。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyUniqueIndexGrounding(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  const indexes = new Map<string, OwnedIndex>();
  for (const spec of dataTables.tables) for (const decl of spec.indexes) indexes.set(decl.name, { spec, decl });
  const invariants = new Map<string, OwnedInvariant>();
  for (const [aggregate, specs] of domain.aggregates) {
    for (const invariant of specs.invariants?.invariants ?? []) invariants.set(invariant.id, { aggregate, invariant });
  }
  return [...[...invariants.values()].flatMap((owned) => checkInvariantSide(owned, indexes, domain)), ...[...indexes.values()].flatMap((index) => checkIndexSide(index, invariants))];
}
