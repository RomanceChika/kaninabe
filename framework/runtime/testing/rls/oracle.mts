/**
 * RLS の挙動テストの**オラクル**(束 ⑳-4b)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * 仕様: docs/specs/backend/guarantees.md(`policy_body_from_spec`)
 *       docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md §RLS
 *
 * ## これは「もう 1 つの写像」である
 *
 * ポリシーの `USING` 句は仕様(access_spec の `reads` とロールの根拠)から SQL へ写したものだが、
 * **写し方そのものが間違っていれば、生成物と実 DB は仲良く同じ間違いをする**(⑳-4a の突合が
 * 言えるのは「生成物どおりか」まで)。そこで同じ宣言から**行集合を直接**計算する別の写像を置く。
 * ここは `legacy/spec-tools/lib/sql/rls-predicate.ts`(SQL の翻訳器)を 1 行も参照しない —— 参照した
 * 瞬間に、独立した読みではなくなる。
 *
 * ## 判定の順序(宣言の意味そのまま)
 *
 * 1. **権限**: その実行者の Postgres ロールが `grant select` を受けていなければ、0 行ではなく拒否。
 *    受けるかどうかも**ここが宣言から導く** —— 未ログインは `kind: anonymous` のロールに
 *    `none` でない `reads` が 1 つでもあれば、認証済みはそれ以外のロール(内部実行ロールを除く)に
 *    `none` でない `reads` が 1 つでもあれば許可である。翻訳器の計画(`policyPlans().to`)から
 *    もらっていたあいだ、刈り込みの間違いを生成 SQL と期待が共有していた(独立レビュー ⑳-4b ①)。
 * 2. **グローバルに立つロール**: 未ログインのロール / **実行者の集約に行があれば立つロール** /
 *    実行者自身の行の欄(`claim`)が真のロール。`implies` で閉じる。
 *    `kind: authenticated_default` の根拠は「ログインしていること」ではなく**実行者の集約に
 *    その人の行があること**である(生成される補助関数が見ているのもそれである)。行の条件(state / enum の
 *    欄が値の集合のどれか。ADR-0018)を併記していれば、行があることに加えてその条件も要る。
 *    さらに、行の条件を持つロールを `implies` で含意するロールは、**その条件も満たすときだけ**立つ
 *    (含意の先の行の条件。E2)。条件を満たさないロールは先に落とし、そのあとで `implies` で閉じる。
 * 3. **行ごとに立つロール**: `binding` が指す集約の行(その行の祖先から引く)の列が実行者と
 *    一致するか。ここも `implies` で閉じる。
 * 4. **可視性**: 立っているロールの読み取り規則のうち、`scope` が `none` でなく、境界
 *    (`filters`)の列(親の列なら参照の鎖を辿った先の行の列)が**実行者自身の行の欄**と一致し、
 *    **状態の条件(`when`)がその行で真**のものが 1 つでもあれば見える。比べる相手はセッションの写しでは
 *    なく実行者の行である —— DB の判定の正がそれであり、写しはトークンの寿命だけ古い。
 *
 * `scope` の `own` / `context(X)` をここで別扱いしないのは、**その行が見えてよい理由がロールの
 * 束縛そのもの**だからである(⑳-4a が `scope` と根拠の食い違いを検査で閉じている)。したがって
 * `all` を含意するロールによる刈り込みも、ここでは「ロールが立つか」からそのまま出る ——
 * 期待ポリシー名の表は 1 度も見ない。
 *
 * ## 状態の条件(`when`)は**エンジンの評価器**が読む(束 §14)
 *
 * 同じ式を SQL に写したのがポリシーの `using` の一部であり、こちらは
 * `@kaninabe/runtime/engine`（`guard.ts`） —— **意味の正そのもの**に掛ける。だから食い違いは「翻訳が違う」と
 * いう形で必ず出る。値は**実 DB から読み直した行**(既定値・トリガの結果を含む)と、その行の
 * 祖先の行から組む。3 値のうち `'unknown'`(値が無い・型が食い違う)は**見せない**側に倒す ——
 * `canFire` が「不明 → 不成立」に決めるのと同じで、ポリシー側も `coalesce(…, false)` である。
 *
 * **アプリの語彙は 1 語も持たない**(集約名・ロール名・列名はすべて設計図から来る)。
 */

import type { GuardEnv } from '@kaninabe/runtime/engine';
import { evaluateGuard } from '@kaninabe/runtime/engine';
import type { RlsWorld, RlsWorldRead, RlsWorldRole } from './types.mjs';
import type { BuiltRlsRow, BuiltRlsWorld } from './world.mjs';
import { closure, conditionHolds, gated } from './role-conditions.mjs';
import type { BoundarySubject } from './boundary.mjs';
import { actorRowOf, actorValue, boundaryValue } from './boundary.mjs';

export { actorFieldValue, boundaryValue } from './boundary.mjs';

/** その実行者に見えるべきもの。 */
export interface Visibility {
  /** 権限そのものが無い(0 行ではなく拒否される)。 */
  readonly denied: boolean;
  /** 見えるべき行の id。 */
  readonly ids: readonly string[];
  /** 行の id → その行を通した読み取り規則(境界の見張りテストが「なぜ見えてよいか」を見るのに使う)。 */
  readonly admittedBy: ReadonlyMap<string, readonly RlsWorldRead[]>;
}

/**
 * その実行者に見えるべき行を、宣言から計算する。
 *
 * 実行者が設計図にも実 DB にも居ないのは**設計図の誤り**であり、期待が空になる形で黙って
 * 通してはならない(そのときは「0 行が期待される」と読めてしまう)ので例外で落とす。
 *
 * @param world 設計図(生成物)
 * @param built 実 DB に作った world
 * @param actorKey 実行者の名前
 * @param roles ロールの根拠(製品の生成物の全数。単体テストは固定した表を渡す)
 * @returns 拒否か、見えるべき id の集合
 * @throws その実行者が設計図または実 DB に無いとき
 */
export function oracleVisibility(
  world: RlsWorld,
  built: BuiltRlsWorld,
  actorKey: string,
  roles: readonly RlsWorldRole[],
): Visibility {
  const actor = world.actors.find((candidate) => candidate.key === actorKey);
  const built_ = built.actors.get(actorKey);
  if (actor === undefined || built_ === undefined) {
    throw new Error(`${world.table}: 実行者 ${actorKey} が設計図または実 DB にありません`);
  }
  if (!granted(world, roles, actor.anonymous)) return { denied: true, ids: [], admittedBy: new Map() };

  const global = closure(
    gated(
      globalRoles(roles, {
        anonymous: actor.anonymous,
        hasRow: hasActorRow(world, built, built_.id),
        claims: built_.claims,
      }),
      roles,
      built_.claims,
    ),
    roles,
  );
  const ids: string[] = [];
  const admittedBy = new Map<string, readonly RlsWorldRead[]>();
  // 的の行だけでなく、**その表の行は全部**判定する —— 束縛の列のために分けた「別人」の行が同じ表にあるとき
  // (実行者の集約が的の表のとき)、実 DB はそれも返しうるので、期待にも載せなければ食い違って見える。
  const judged = world.rows.filter((candidate) => candidate.table === world.table);
  for (const { key } of judged) {
    const row = built.rows.get(key);
    if (row === undefined) continue;
    const rowHeld = gated(rowRoles(world, built, key, built_.id, roles), roles, built_.claims);
    const roleSet = new Set([...global, ...closure(rowHeld, roles)]);
    const env = guardEnvOf(world, built, key, row);
    const subject: BoundarySubject = { built, row, actor: actorRowOf(world, built, built_.id), actorId: built_.id };
    const rules = world.reads.filter((rule) => admits(rule, roleSet, subject, env));
    if (rules.length === 0) continue;
    ids.push(row.id);
    admittedBy.set(row.id, rules);
  }
  return { denied: false, ids, admittedBy };
}

/**
 * その実行者の Postgres ロールが `grant select` を受けるか(宣言から導く)。
 *
 * 未ログインの許可は `kind: anonymous` のロールの読み取りだけが根拠であり、認証済みの許可は
 * 全てのロール(未ログインのロールを含む。RLS をバイパスする内部実行ロールは除く)の読み取りが根拠である ——
 * ログインした人は、未ログインの人が見られるものを見られなくなってはならない。
 * 読み取りが全部 `none` なら、そのロールにポリシーは 1 本も出ないので権限も付かない。
 */
function granted(world: RlsWorld, roles: readonly RlsWorldRole[], anonymous: boolean): boolean {
  return world.reads.some((rule) => {
    if (rule.scope === 'none') return false;
    const role = roles.find((candidate) => candidate.id === rule.by);
    // 認証済みの許可は未ログインのロールの読み取りも根拠になる(ログインした人は未ログインの人が見られるものを見られる)。
    return role !== undefined && !role.system && (role.anonymous || !anonymous);
  });
}

/**
 * 実行者の集約に**その人の行があるか**(実際にそこにある行で見る)。
 *
 * `kind: authenticated_default` の根拠はこれである —— ログインしただけの認証ユーザ(実行者の集約の行が
 * まだ無い人)はこのロールを持たない。
 */
function hasActorRow(world: RlsWorld, built: BuiltRlsWorld, actorId: string | null): boolean {
  if (actorId === null) return false;
  return [...built.rows.values()].some((row) => row.table === world.actorTable && row.id === actorId);
}

/** 実行者 1 人ぶんの、対象に依らない根拠。 */
interface ActorBasis {
  readonly anonymous: boolean;
  /** 実行者の集約にその人の行があるか。 */
  readonly hasRow: boolean;
  readonly claims: Readonly<Record<string, unknown>>;
}

/**
 * 対象に依らず立つロール(未ログイン / 実行者の集約に行がある / 実行者自身の行の欄)。未ログインのロールは全員が持つ。
 *
 * 既定のログインロールが行の条件(`claimValues` / boolean の `claimField`)を宣言していれば、**行がある
 * ことに加えて**その条件を満たすときだけ立つ(AND)。条件を満たさない実行者(ゲスト・退会者など)は
 * 既定のロールを持たない。
 */
function globalRoles(roles: readonly RlsWorldRole[], basis: ActorBasis): ReadonlySet<string> {
  const held = new Set<string>();
  for (const role of roles) {
    // 未ログインのロールは、ログインした人も持つ(行が無くても・条件を満たさなくても。見られるものが減らない)。
    if (role.anonymous) {
      held.add(role.id);
      continue;
    }
    if (basis.anonymous) continue;
    // 行が無いログイン実行者は、ほかのロールを持たない(claim の根拠もその行の欄である)。
    if (!basis.hasRow) continue;
    if (role.authenticatedDefault) {
      if (role.claimField === null || conditionHolds(role, basis.claims)) held.add(role.id);
    } else if (role.claimField !== null && conditionHolds(role, basis.claims)) {
      held.add(role.id);
    }
  }
  return held;
}

/** その行との関係で立つロール(`binding` が指す集約の行の列と実行者を比べる)。 */
function rowRoles(
  world: RlsWorld,
  built: BuiltRlsWorld,
  rowKey: string,
  actorId: string | null,
  roles: readonly RlsWorldRole[],
): ReadonlySet<string> {
  const held = new Set<string>();
  const target = world.rows.find((candidate) => candidate.key === rowKey);
  if (target === undefined || actorId === null) return held;
  for (const role of roles) {
    const binding = role.binding;
    if (binding === null) continue;
    const boundKey = target.ancestry[binding.entity];
    const bound = boundKey === undefined ? undefined : built.rows.get(boundKey);
    if (bound === undefined) continue;
    if (matches(bound.values[binding.column], actorId, binding.many)) held.add(role.id);
  }
  return held;
}

/** 束縛の列が実行者を指しているか(集合の列なら要素として含むか)。 */
function matches(value: unknown, actorId: string, many: boolean): boolean {
  if (!many) return value === actorId;
  return Array.isArray(value) && value.some((item) => item === actorId);
}

/**
 * その読み取り規則がその行を通すか(ロールが立ち、`none` でなく、境界が一致し、状態の条件が真)。
 *
 * 状態の条件は 3 値で返るので、**真だけを通す** —— `'unknown'` は「評価できなかった」であり、
 * 見せてよい根拠にはならない(ポリシー側も `coalesce(…, false)` で同じことをしている)。
 */
function admits(rule: RlsWorldRead, roles: ReadonlySet<string>, subject: BoundarySubject, env: GuardEnv): boolean {
  if (!roles.has(rule.by) || rule.scope === 'none') return false;
  if (!rule.filters.every((filter) => sameValue(boundaryValue(subject.built, subject.row, filter), actorValue(subject, filter.actorField)))) {
    return false;
  }
  return rule.when === null || evaluateGuard(rule.when, env) === true;
}

/**
 * 状態の条件を評価する環境(その行と、参照を遡って届く行の欄)。
 *
 * 鍵は仕様の書き方に合わせて 2 通り置く —— `{集約}.{欄}` と、自集約だけは裸の `{欄}` である
 * (ガード式はどちらでも書ける)。値は**実 DB から読み直したもの**なので、既定値やトリガが
 * 決めた状態もそのまま入る。
 */
function guardEnvOf(
  world: RlsWorld,
  built: BuiltRlsWorld,
  rowKey: string,
  row: BuiltRlsRow,
): GuardEnv {
  const env: Record<string, unknown> = {};
  const design = world.rows.find((candidate) => candidate.key === rowKey);
  for (const [entity, key] of Object.entries(design?.ancestry ?? {})) {
    const source = key === rowKey ? row : built.rows.get(key);
    for (const [field, value] of Object.entries(source?.values ?? {})) {
      env[`${entity}.${field}`] = scalar(value);
      if (entity === world.entity) env[field] = scalar(value);
    }
  }
  return env as GuardEnv;
}

/**
 * 境界の比較(実行者の欄の値と列の値)。
 *
 * どちらも実 DB から読み直した値だが、ドライバの表現(数値が文字列で来るなど)が揃うとは限らないので、
 * **スカラーとしての同一性**で比べる —— どちらも「同じ値か」を問うているのであって、表現の違いを
 * 問題にしたいのではない。
 *
 * @param value 行の列の値
 * @param claim 実行者の欄の値
 * @returns 同じ値なら true(どちらかがスカラーでなければ false)
 */
export function sameValue(value: unknown, claim: unknown): boolean {
  const left = scalar(value);
  const right = scalar(claim);
  return left !== null && right !== null && left === right;
}

/** 比べられるスカラーだけを文字列にする(オブジェクト・null は比較の対象にしない)。 */
function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}
