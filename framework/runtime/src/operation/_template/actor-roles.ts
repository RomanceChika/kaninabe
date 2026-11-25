/**
 * ロール解決の**表を引数に取る芯**（`./actor.ts` の中身。束 ⑳-5b-b）。
 *
 * 仕様: docs/specs/domain/roles.md（グローバルロール・binding・claim）
 *
 * `./actor.ts` との違いは**表の出どころだけ**である。あちらは生成物（`GLOBAL_ROLES` /
 * `ROLE_IMPLICATIONS`）を読み、ここは同じ形の表を引数で受け取る。分けた理由は 1 つで、
 * **この解決を仕様側（legacy/spec-tools）からも呼ぶ**ためである —— ハンドブックの結果表は
 * どの製品の仕様に対しても同じ判定を引くので、生成物に縛られた口では
 * 呼べない。ここを写して 2 つ目の解決器を置くと、その写し間違いが新しい穴になる。
 *
 * したがってこのファイルが import してよいのは**同じパッケージの純関数と型だけ**である
 * （`@kaninabe/runtime/...`）—— tsconfig の `paths`（`@/*`）にも生成物にも依存しないことが、
 * 外から呼べることの条件である。
 */

import type { RunRowCondition } from '@kaninabe/runtime/plan';
import { rowConditionHolds } from '@kaninabe/runtime/step-decision';

/**
 * 実行者に解決されたロールの集合。
 *
 * **空にならない**（グローバルロールは常に 1 つ成立する）ことと、**先頭がそのグローバルロール**
 * であることを型で表す。拒否に載せるロール（`rejectedRole`）はこの先頭を取るだけなので、
 * 「解決結果が空だったら何を載せるか」という分岐が実装に現れない。
 */
export type ActorRoles = readonly [string, ...string[]];

/**
 * ロール解決が読む表（`roles.md` の `kind` 宣言と `implies` の閉包）。
 *
 * 軸（未ログイン / 認証ユーザーの既定 / システムの 3 スロットと含意）は仕組みが決め、
 * 語（ロール ID）は仕様が決める —— 語をここに書かないための形である。
 */
export interface RoleTables {
  /** `kind: anonymous` のロール ID。 */
  readonly anonymous: string;
  /** `kind: authenticated_default` のロール ID。 */
  readonly authenticated: string;
  /** `kind: system` のロール ID。 */
  readonly system: string;
  /** ロール ID → そのロールが必ず含意するロール（`implies`）。 */
  readonly implications: Readonly<Record<string, readonly string[] | undefined>>;
  /**
   * 既定のログインロールが立つ**実行者の行の条件**（`kind: authenticated_default` に併記した `claim`。
   * ADR-0018）。無ければ「行がある」だけで立つ（従来どおり）。満たさない実行者は未ログインと同じ
   * ロールになる。
   */
  readonly authenticatedWhen?: RunRowCondition;
  /**
   * ロール ID → そのロールが立つために**併せて満たす行の条件**（`claim` を持つロールを `implies` で
   * 含意する側の、含意の先の条件。ADR-0018 の E2）。条件を持つロールだけがキーになる。
   * DB の述語（`自分の根拠 AND 含意の先の行の条件`）の先読みの写しである。
   */
  readonly gates?: Readonly<Record<string, readonly RunRowCondition[] | undefined>>;
}

/**
 * ロール解決が読む**セッションの写し**（`app_metadata.profile`。実行者自身の行のうち `session: true` の欄）。
 * 行が無い人・未ログインは `null`。
 *
 * **写しは遅れうる**（`refresh_session_profile` のジョブが更新する）。取り消し（退会・無効化）の直後は
 * 甘い側に外れうるが、DB の述語が実行者の行を直に読んで必ず落とす —— 先読みは親切のための早い拒否であって、
 * 権威は DB である（ADR-0012）。
 */
export type RoleProfile = Readonly<Record<string, unknown>> | null;

/**
 * 実行者のグローバルロール（`roles.md` の `kind`）。
 *
 * **既定のログインロールが立つ根拠は「認証済みであること」ではなく「実行者の集約に行がある
 * こと」である**（domain-spec-writing.md §role_spec）。読み取り（RLS の補助関数）も書き込み
 * （定型 RPC の述語）も実行者の行を見に行くので、先読みだけが `actorId !== null` で立てていると、
 * **ログインはできるが行が無い人**の権限判定が素通りする（束 ⑳-5a の所見 ①）。
 *
 * ログインロールが行の条件（`authenticatedWhen`。例: メンバーの状態が有効）を宣言していれば、行があるだけでは
 * 足りず、**セッションの写しがその条件を満たすとき**だけ立つ。満たさない実行者（ゲスト・退会者など）は
 * 未ログインと同じロールになる。
 *
 * @param tables - ロール解決が読む表
 * @param actorId - 実行者の識別子。未ログインは `null`
 * @param profile - セッションの写し。行が無ければ `null`
 * @returns グローバルロール ID
 */
export function globalRoleWith(tables: RoleTables, actorId: string | null, profile: RoleProfile): string {
  if (actorId === null || profile === null) return tables.anonymous;
  const when = tables.authenticatedWhen;
  return when === undefined || rowConditionHolds(when, profile) ? tables.authenticated : tables.anonymous;
}

/**
 * 実行者が対象に対して持つロールを解決する（`roles.md` の binding）。
 *
 * グローバルロールは常に成立し、文脈依存ロールは binding の相手が実行者自身であるときだけ
 * 足される。**システム起点**（`system: true`）だけは別扱いで、文脈依存ロールは 1 つも立たない
 * （システムには「対象との関係」が無い）。
 *
 * **行の条件を持つロールを含意するロールは、その条件も満たすときだけ立つ**（`tables.gates`。
 * ADR-0018 の E2。DB の述語が `自分の根拠 AND 含意の先の行の条件` であることの先読みの写し）。
 * 満たさないロールは束縛が成立していても足さない —— 閉包を取る前に落とすので、落としたロールの
 * 含意の先も付かない。
 *
 * **`implies`（ロール階層）はここで閉じる**。「この集合は含意で閉じている」ことは仕組みの契約で
 * あり（`legacy/spec-tools/lib/sql/roles-to-sql.ts`）、DB 側の述語は `p_actor_roles` の中身をそのまま
 * 見るだけだからである。
 *
 * @param tables - ロール解決が読む表
 * @param actorId - 実行者の識別子。未ログインは `null`
 * @param profile - セッションの写し。行が無ければ `null`
 * @param bindings - ロール ID → そのロールが成立する実行者 ID（読めなければ `null` / `undefined`）
 * @param system - システム起点の呼び出しか
 * @returns 成立したロール ID（先頭は常にグローバルロール。`implies` で閉じている）
 */
export function resolveActorRolesWith(
  tables: RoleTables,
  actorId: string | null,
  profile: RoleProfile,
  bindings: Readonly<Record<string, string | null | undefined>>,
  system: boolean,
): ActorRoles {
  if (system) return closeOverImplications(tables, [tables.system]);
  const roles: [string, ...string[]] = [globalRoleWith(tables, actorId, profile)];
  if (actorId === null) return closeOverImplications(tables, roles);
  for (const [role, boundTo] of Object.entries(bindings)) {
    if (boundTo === actorId && gatesHold(tables, role, profile ?? {})) roles.push(role);
  }
  return closeOverImplications(tables, roles);
}

/** そのロールが併せて満たす行の条件を、セッションの写しが全部満たすか（条件が無ければ満たす）。 */
function gatesHold(tables: RoleTables, role: string, profile: Readonly<Record<string, unknown>>): boolean {
  return (tables.gates?.[role] ?? []).every((gate) => rowConditionHolds(gate, profile));
}

/**
 * 成立したロールの集合を `implies` で閉じる（重複は落とし、先頭のグローバルロールは動かさない）。
 *
 * @param tables - ロール解決が読む表
 * @param roles - 直接成立したロール（先頭はグローバルロール）
 * @returns 含意されるロールを足した集合
 */
function closeOverImplications(tables: RoleTables, roles: ActorRoles): ActorRoles {
  const closed = new Set<string>(roles);
  for (const role of roles) {
    for (const implied of tables.implications[role] ?? []) closed.add(implied);
  }
  return [roles[0], ...[...closed].filter((role) => role !== roles[0])];
}
