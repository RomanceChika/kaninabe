/**
 * 外から届く surface(`api` スキーマのビュー)の **ACL の全数**(ロール → そのビューで持てる権限)。
 *
 * ## なぜ基表とは別の写像が要るのか
 *
 * 基表の ACL(`table-acl.ts`)は `reads` から宛先が決まり、権限は `select` か特権の 4 つ
 * だった。ビューはそうではない —— surface に出るビューは**どれも同じ 1 組**であり、宛先を
 * 決めるのは access_spec ではなく「そのビューが surface に出るものか、内部テーブルのものか」の
 * 1 ビットだけである(`api-migration.ts` が出す `grant` がその 2 行で閉じている)。
 *
 * | ビュー | surface のロール | 特権ロール |
 * |---|---|---|
 * | surface に出るビュー(生成物) | `select` | `grant all`(関係に付く権限の全部) |
 * | 内部テーブルのビュー(手書き) | **何も持たない** | `grant all` |
 *
 * ## なぜ「全部」を名前で並べるのか
 *
 * `grant all` は Postgres が関係に定義した権限を**その版の全部**開く。突合を閉世界で
 * 行う以上、期待の側はその全数を名前で持つしかない(実 DB の側は `aclexplode` で名前を
 * 絞らずに読む —— 読む側を一覧で回すと、版が足した新しい権限が閉世界の外に落ちる)。
 * `maintain` は Postgres 17 で足された語であり、**期待の側に並べ忘れると余分として落ちる**
 * のが正しい挙動である(黙って通るより、版が上がったことに気づけるほうがよい)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PlatformProfile } from '../model/product/platform-profile.js';
import { callerRoles, privilegedRole } from './platform-sql.js';
import type { RoleAcl } from './table-acl.js';

/** surface のロールに与えうる唯一の権限(書き込みの直接経路は作らない)。 */
const READ_PRIVILEGE = 'select';

/**
 * `grant all on {関係}` が開く権限の全数(Postgres 17)。
 *
 * 版が上がって語が増えたら、ここに足すまで `api-parity` が「宣言に無い権限」で落ちる。
 */
export const ALL_RELATION_PRIVILEGES: readonly string[] = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
  'maintain',
];

/**
 * ビュー 1 枚ぶんの ACL の全数(**閉世界**。権限を 1 つも持たないロールも空の配列で載る)。
 *
 * 載るロールは宣言順(surface のロール → 特権ロール)で、ビューの所有者は載らない —— 基表と同じ線引き。
 *
 * @param internal 内部テーブルのビューか(surface のロールに何も与えない側)
 * @param profile プラットフォームの設定(ロール名の写像)
 * @returns ロールごとの権限(ロールの宣言順)
 */
export function apiViewAcl(internal: boolean, profile: PlatformProfile): readonly RoleAcl[] {
  const privileged = privilegedRole(profile);
  return callerRoles(profile).map((role) => ({
    role,
    privileges: role === privileged ? ALL_RELATION_PRIVILEGES : internal ? [] : [READ_PRIVILEGE],
  }));
}
