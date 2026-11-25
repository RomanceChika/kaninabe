/**
 * V2(参照整合)のうち、**ガード式のパス解決とリテラルの接地**を担う部分。
 *
 * 見るのは、ガード式(`guard` / `binding` / `creates`・`writes`・`deletes` の `when`)に現れる
 * path が解決できることである。解決規則は entity_spec の `context` を土台にパスを辿る形で、
 * 深さは `{エンティティ}.{フィールド}` の 2 段まで。
 * 加えて、**比較の右辺のリテラル**が左辺の値域(state / enum / boolean)に実在することも見る
 * (判定は lib/guard/literal-grounding.ts。パスだけ見てリテラルを見逃すと、
 * `state == publik` のような綴り違いが「型は合っているのに永久に成立しない条件」として残る)。
 *
 * `context` の宣言そのものの接地は v2-context.ts、参照名の実在(状態機械・エンティティ・
 * イベント ID)は v2-reference-integrity.ts にある。Finding の verifier はすべて V2 である
 * (利用者から見れば 1 つの検査)。
 */

import type { EntitySpec, SourceLocation, SpecModel } from '../../model/types.js';
import type { DomainEnv, GuardServices, PathRef } from '../../guard/ast.js';
import { ungroundedLiterals } from '../../guard/literal-grounding.js';
import { placementHint } from '../../guard/placement.js';
import { mistypedComparisons, type ValueKindEnv } from '../../guard/comparison-typing.js';
import {
  MAX_PATH_SEGMENTS,
  resolveActorPath,
  resolveEntityPath,
  resolveNowPath,
} from '../../model/path-resolve.js';
import type { Finding } from '../../kernel/finding.js';

/**
 * 式のどこからでも参照できる予約語のルート。
 * `actor` / `now` の後ろに書ける形の値域は lib/model/path-resolve.ts が正であり、
 * ここはそれを引くだけである(同じ規則を 2 つ書くと片方だけが直る事故になる)。
 */
const RESERVED_ROOTS: ReadonlySet<string> = new Set(['actor', 'now']);

/**
 * 上限を超えたパスを断る理由。上限の正は `lib/model/path-resolve.ts`(同じ規則を 2 つ書かない)。
 *
 * 解決できるのは `context` を 2 段まで辿った先であり、それを超えると**どの宣言にも接地しない**。
 * かつては 1 段(`{エンティティ}.{フィールド}`)だけで、木の各段に写しの列とトリガと不変条件が
 * 要っていた(束 ⑱ の実測 → 束 ⑲-2a で 2 段まで開いた)。
 */
const TOO_DEEP_REASON =
  `パスは context を 2 段まで辿れます(${MAX_PATH_SEGMENTS} セグメントを超えると解決できません)`;

/** モデル全体から集めた「参照可能な名前」の索引。 */
export interface RefIndex {
  /** 定義済み状態機械名 */
  readonly machines: ReadonlySet<string>;
  /** エンティティ名 → その entity_spec */
  readonly entities: ReadonlyMap<string, EntitySpec>;
}

/**
 * モデルから参照可能な名前の索引を作る。
 *
 * @param model ドメイン仕様全体
 * @returns 状態機械名の集合とエンティティ名 → entity_spec の対応
 */
export function buildIndex(model: SpecModel): RefIndex {
  const machines = new Set<string>();
  const entities = new Map<string, EntitySpec>();
  for (const aggregate of model.aggregates.values()) {
    for (const m of aggregate.stateMachines) machines.add(m.machine);
    if (aggregate.entity !== undefined) entities.set(aggregate.entity.entity, aggregate.entity);
  }
  return { machines, entities };
}

/**
 * V2 の Finding を組み立てる(3 点セットの取りこぼしを防ぐファクトリ)。
 *
 * @param message 何が起きているか
 * @param location 違反箇所
 * @param suggestion どう直すか
 * @param counterexample 反例(任意)
 */
export function refError(
  message: string,
  location: SourceLocation,
  suggestion: string,
  counterexample?: Readonly<Record<string, string>>,
): Finding {
  const base = { verifier: 'V2', severity: 'error', message, location, suggestion } as const;
  return counterexample === undefined ? base : { ...base, counterexample };
}

function hasField(entity: EntitySpec, name: string): boolean {
  return entity.fields.some((f) => f.name === name);
}

/**
 * そのフィールドがエンティティに無ければ「無い」理由文を返す。
 *
 * @param entity 対象のエンティティ
 * @param name フィールド名(パスが短くて取れない場合は undefined)
 * @returns 実在しない理由。実在すれば undefined
 */
export function fieldReason(entity: EntitySpec, name: string | undefined): string | undefined {
  if (name === undefined || hasField(entity, name)) return undefined;
  return `エンティティ ${entity.entity} にフィールド ${name} がありません`;
}

/**
 * 1 つの path が解決できるか判定する。
 *
 * 対象エンティティが定まっている通常の場合は `lib/model/path-resolve.ts` の
 * `resolveEntityPath` へ寄せる(V10・S5・semantics/query-filter-path.ts と同じ実装)。
 * ここに前は自前の解決ロジックがあったが、「集約ディレクトリ名の自分扱い」が
 * 解決器ごとに食い違っていた(`resolveEntityPath` は `root === origin` も自エンティティ
 * 扱いにするのに対し、ここの旧実装は `root === entity.entity` しか見ておらず、
 * 集約ディレクトリ名とエンティティ名が食い違う書き方の可否が場所によって反転していた)。
 * 特例として残すのは **binding**(role の binding。対象エンティティが一意に定まらない)
 * だけであり、これは `resolveEntityPath` の「起点 1 つ」という前提に乗らないため
 * 委譲できない。
 *
 * @param path 検査するパス
 * @param scope 式を解釈する文脈(所属エンティティ・起点名・名前の索引・モデル全体)
 * @returns 解決できない理由。解決できれば undefined
 */
function resolvePath(path: PathRef, scope: ExprScope): string | undefined {
  const { entity, origin, index, model } = scope;
  const root = path.segments[0];
  if (root === undefined) return '空のパスです';
  if (path.segments.length > MAX_PATH_SEGMENTS) return TOO_DEEP_REASON;
  if (root === 'actor') {
    const actor = resolveActorPath(path, model);
    return actor.kind === 'error' ? actor.reason : undefined;
  }
  if (root === 'now') {
    const now = resolveNowPath(path);
    return now.kind === 'error' ? now.reason : undefined;
  }
  if (RESERVED_ROOTS.has(root)) return undefined;

  if (entity === undefined || origin === undefined) {
    // binding の特例(対象エンティティが一意に定まらない)。パスの**先頭が対象のエンティティ**
    // なので、それを起点として同じ解決器に渡す —— こうすると `context` の連鎖(2 段)も
    // binding で書ける(`{起点}.{中継}.{相手}.{欄}`)。単一セグメントのパスは
    // V11(ロール接地)に委ねて素通しする。
    if (path.segments.length === 1) return undefined;
    if (index.entities.get(root) === undefined) return `エンティティ ${root} が未定義です`;
    const resolvedBinding = resolveEntityPath(model, root, path, 'binding の対象');
    return resolvedBinding.kind === 'error' ? resolvedBinding.reason : undefined;
  }

  const resolved = resolveEntityPath(model, origin, path, '起点');
  return resolved.kind === 'error' ? resolved.reason : undefined;
}

/**
 * ガード式を解釈する文脈。パス解決に要るもの(所属エンティティ・起点名・名前の索引・
 * モデル全体)と、リテラルの接地に要るもの(変数ドメイン)をひとまとめにする。
 */
export interface ExprScope {
  /** 式が属するエンティティ。undefined = 対象が一意に定まらない文脈(role の binding)。 */
  readonly entity: EntitySpec | undefined;
  /**
   * 起点の名前(集約ディレクトリ名)。`resolveEntityPath` に渡す `origin`。
   * `entity` と対で undefined になる(binding は起点が 1 つに定まらない)。
   */
  readonly origin: string | undefined;
  /** 参照可能な名前の索引。 */
  readonly index: RefIndex;
  /** パス → 変数ドメイン。比較リテラルの値域の照合に使う。 */
  readonly env: DomainEnv;
  /** パス → 値の種別。比較の**型一致**(boolean への `in` / 順序比較・型違いの比較)の照合に使う。 */
  readonly kinds: ValueKindEnv;
  /** ドメイン仕様全体(`resolveEntityPath` が context の解決に使う)。 */
  readonly model: SpecModel;
}

/**
 * ガード式 1 本を検査する(パース + 全 path の解決 + 比較リテラルの接地)。
 *
 * @param source 生の式文字列
 * @param kind 式の種類("guard" / "binding" / "when")。メッセージに出す
 * @param owner 式の持ち主を人間が特定できる名前(例: "entry.submit")
 * @param scope 式を解釈する文脈(所属エンティティ・名前の索引・変数ドメイン)
 * @param guards ガード式のパースとパス収集を担うサービス
 * @param location 違反箇所
 * @returns 解決できなかったパス・接地しないリテラルの Finding(健全なら空)
 */
export function checkExpr(
  source: string,
  kind: string,
  owner: string,
  scope: ExprScope,
  guards: GuardServices,
  location: SourceLocation,
): Finding[] {
  const { entity } = scope;
  const parsed = guards.parse(source);
  if (!parsed.ok) {
    return [
      refError(
        `${owner} の ${kind} をパースできません: ${parsed.error.message}`,
        location,
        `式 "${source}" をガード式の文法(path op literal / in / contains を and・or・not で結合)に沿って書き直してください。` +
          placementHint(parsed.error),
        { owner, kind, expression: source },
      ),
    ];
  }
  const findings: Finding[] = [];
  for (const path of guards.collectPaths(parsed.expr)) {
    const reason = resolvePath(path, scope);
    if (reason === undefined) continue;
    const text = path.segments.join('.');
    findings.push(
      refError(
        `${owner} の ${kind} が参照する ${text}: ${reason}`,
        location,
        entity === undefined
          ? `${text} が指す宣言を追加するか、式を既存の宣言だけで書き直してください。`
          : `entity_spec ${entity.entity} の context に参照元を宣言するか、フィールドを追加してください。参照できるのは context で解決できるエンティティ・自エンティティのフィールド・actor / now だけです。`,
        { owner, kind, path: text },
      ),
    );
  }
  const grounded = new Set<string>();
  for (const literal of ungroundedLiterals(parsed.expr, scope.env)) {
    grounded.add(`${literal.path} ${literal.value}`);
    findings.push(
      refError(
        `${owner} の ${kind} が ${literal.path} を ${literal.value} と比べています: ${literal.path} にその値はありません`,
        location,
        `${literal.path} が取り得るのは ${literal.allowed.join(' / ')} だけです。綴りを直すか、値そのものを宣言(states / enum)に足してください。`,
        { owner, kind, path: literal.path, value: literal.value, allowed: literal.allowed.join(', ') },
      ),
    );
  }
  // 値域の照合(上)で名指し済みの組は繰り返さない —— 同じ 1 つの綴り違いに 2 件出さない。
  for (const mistyped of mistypedComparisons(parsed.expr, scope.kinds)) {
    if (grounded.has(`${mistyped.path} ${mistyped.rhs}`)) continue;
    findings.push(
      refError(`${owner} の ${kind}: ${mistyped.reason}`, location, mistyped.suggestion, {
        owner,
        kind,
        path: mistyped.path,
        value_kind: mistyped.kind,
        op: mistyped.op,
        rhs: mistyped.rhs,
      }),
    );
  }
  return findings;
}
