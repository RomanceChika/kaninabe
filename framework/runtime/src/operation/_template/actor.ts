/**
 * 実行者（actor）のロール解決。4 形の定型が共通で使う部品。
 *
 * 仕様: docs/specs/domain/roles.md（グローバルロールと binding）
 *
 * ロールの**解決**は operation 層の責務であり、エンジンは解決結果を照合するだけである
 * （`@kaninabe/runtime/engine`（`machine.ts`） のJSDoc）。どのフィールドがどのロールに対応するかは
 * 集約ごとに違う（例: `entry.patron_id` / `item.librarian_id`）ので、対応そのものは
 * 各操作が渡す。ここにあるのは「渡された対応を照合して並べる」段取りだけである。
 *
 * 「未ログイン」「認証ユーザーの既定ロール」に対応する具体的なロール ID は**その製品の事情**
 * （roles.md の `kind` 宣言）であり、ここには 1 つも現れない —— 表は `RoleTables` として
 * **製品が渡す**（`RuntimeBindings`。ADR-0013）。束ねた口（`globalRole` / `resolveActorRoles`）は
 * 製品の生成物の側にある（dsl-extension-triage.md §軸と語）。
 */

import type { ActorRoles } from './actor-roles';
import type { SessionClaims } from '../../domain/bindings';

export type { ActorRoles } from './actor-roles';

/**
 * 実行者のセッションが運ぶプロフィール（`app_metadata.profile`）。
 *
 * サインインは**実行者の集約にその人の行があったときだけ**これを書く
 * （`infrastructure/supabase/session.ts` の `writeSessionProfile`）。したがって
 * 「プロフィールがある」は「実行者の集約に行がある」の**行の写し**である —— 先読みは DB を
 * 読まないので、根拠はこの写しから取る。
 */
export type ActorProfile = SessionClaims | null;



/**
 * 拒否（`ActionError` の `forbidden`）に載せるロールID。
 *
 * **判断に実際に使った解決結果から作る**。エンジンが照合したのは `actorRoles` に渡した集合であり、
 * そこを見ずに `globalRole(actorId)` から作ると、**実行者IDを持たない経路（system）の拒否が
 * すべて `anonymous` として記録される**（監査から見て「誰として拒否されたか」が嘘になる）。
 *
 * 載せるのは**先頭の 1 つ**である。`resolveActorRoles` は先頭に必ずグローバルロールを置く
 * （文脈依存ロールはそのあとに足される）ので、これは「実行者がそもそも何であったか」にあたる。
 * 文脈依存ロールまで含めた集合が要るなら、それは `ActionError` の形を変える判断であり
 * （`role: string` → 複数）、ここではなく ARCH-BE-0013 の側で決める。
 *
 * 「解決結果が空だったら」という分岐はここに無い。空にならないことは `ActorRoles` の型が
 * 保証しており、実行時に確かめ直す必要が無いためである。
 *
 * @param actorRoles - 判断に使った解決済みロール（`actorRoles` の戻り値そのもの）
 * @returns 拒否として記録するロールID
 */
export function rejectedRole(actorRoles: ActorRoles): string {
  return actorRoles[0];
}

/** 実行者を伴う入力。actor はサーバー側のセッションから導いた値であり、入力ではない。 */
export interface ActorCommand {
  /** 実行者の識別子。未ログインは `null`（`anonymous` ロールとして扱う）。 */
  readonly actorId: string | null;
  /**
   * セッションが運ぶ実行者のプロフィール（`app_metadata.profile`）。
   *
   * **既定のログインロールの根拠**である（実行者の集約に行があることの写し）。`claim` のロールも
   * ここから立つ。入口（Server Action）が `resolveSessionProfile()` で読んで渡す。
   */
  readonly actorClaims: ActorProfile;
}
