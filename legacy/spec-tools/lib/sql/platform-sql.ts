/**
 * `PlatformProfile`(プラットフォームの設定)から、SQL の生成器が使う**派生の字面**を導く純関数。
 *
 * 設定そのものは値の置き場(`lib/targets/<後段>/`)が持ち、SQL に現れる形(初期計画に畳ませる包み・
 * ロールの並び)は **Postgres の語**なのでここに置く —— どの後段の値でも同じ形に
 * なる。生成器は設定を直に読まず、ここを通す(同じ字面を 2 か所で組まない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PlatformProfile } from '../model/product/platform-profile.js';

/**
 * 設定の**契約**を検査する(`roles` の 3 つの値は互いに異なること・能力を持たない宣言は理由を持つこと)。
 *
 * 3 つの値が重なる設定は、SQL の生成器が前提にしている区別 —— 「一般利用者のロールにだけ隠し列のマスクと
 * 権限の剥奪をかける・内部実行のロールにはかけない」—— を壊す(内部実行のロールが一般利用者と同じ名前なら、
 * 内部実行の権限が一般利用者にも出る)。値を選ぶ組み立ての根が、選んだ設定をここへ通してから配る。
 *
 * @param profile プラットフォームの設定
 * @returns 契約の違反の理由(重なりのある組ごとに 1 行)。空なら契約を満たす
 */
export function platformProfileProblems(profile: PlatformProfile): readonly string[] {
  // 役割の語は `RoleKind` の値域そのもの(`Object.keys` の並び)から引く。語の綴りをここに書かない。
  const kinds = Object.keys(profile.roles) as (keyof PlatformProfile['roles'])[];
  const overlaps = kinds.flatMap((kindA, index) =>
    kinds
      .slice(index + 1)
      .filter((kindB) => profile.roles[kindA] === profile.roles[kindB])
      .map((kindB) => `roles.${kindA} と roles.${kindB} が同じロール名(${profile.roles[kindA]})です。3 つの役割は互いに別のロール名にしてください`),
  );
  // 能力を持たない宣言は、報告に出す理由を必ず持つ(理由の無い未対応は、何が足りないのか読めない)。
  const blankReason =
    profile.surfaceExposure.kind === 'unsupported' && profile.surfaceExposure.reason.trim() === ''
      ? ['surfaceExposure が unsupported なのに reason がありません。未対応の報告に出す理由を書いてください']
      : [];
  // セッションの生死を答える式が空なら、土台の関数が `select ;` になる(欠けたら閉じる前提が成り立たない)。
  const blankSessionAlive =
    profile.sessionAliveExpr.trim() === ''
      ? ['sessionAliveExpr が空です。ログインセッションがいまも生きているかを答える SQL の真偽式を書いてください']
      : [];
  return [...overlaps, ...blankReason, ...blankSessionAlive, ...functionCreatorProblems(profile)];
}

/**
 * 関数を作る役の契約の違反の理由。
 *
 * 作成主体は 1 つ以上要り(無ければ新しい関数の既定が誰の分も閉じない)、同じ役を 2 度挙げず、一般利用者のロールは
 * 含められない(一般利用者が関数を作る構成では、その既定を閉じても実行権限の閉世界は成り立たない)。扱いは
 * 2 つのどちらかで、migration から触れない役(`external`)は理由を必ず持つ(理由の無い免除は、何を諦めたのか読めない)。
 * 型で縛れない実行時の値(設定を JS から組む後段)のために、扱いの綴りも確かめる。
 *
 * @param profile プラットフォームの設定
 * @returns 契約の違反の理由(違反ごとに 1 行)
 */
function functionCreatorProblems(profile: PlatformProfile): readonly string[] {
  if (profile.functionCreators.length === 0) return ['functionCreators が空です。関数を作る DB ロールを 1 つ以上書いてください'];
  const endUsers = new Set(endUserRoles(profile));
  const seen = new Set<string>();
  return profile.functionCreators.flatMap((creator) => {
    const problems: string[] = [];
    if (seen.has(creator.role)) problems.push(`functionCreators に同じ役(${creator.role})が 2 度あります。扱いは 1 つに決めてください`);
    seen.add(creator.role);
    if (endUsers.has(creator.role)) {
      problems.push(`functionCreators に一般利用者のロール(${creator.role})があります。関数を作る役は一般利用者と別にしてください`);
    }
    const handling: string = creator.handling;
    if (handling !== 'migration' && handling !== 'external') {
      problems.push(`functionCreators の ${creator.role} の扱い(${handling})が不明です。migration か external にしてください`);
    } else if (creator.handling === 'external' && creator.reason.trim() === '') {
      problems.push(`functionCreators の ${creator.role} が external なのに reason がありません。migration から閉じられない理由を書いてください`);
    }
    return problems;
  });
}

/**
 * 後段が SQL の公開面(surface)を API として外へ出す能力を持たないときの理由(持つなら null)。
 * 持たない構成では、surface に依る検査・生成を**未対応**と報告し、実行しない(黙って緑にしない)。
 *
 * @param profile プラットフォームの設定
 * @returns 能力が無いときは後段が宣言した理由。能力があれば null
 */
export function surfaceUnsupportedReason(profile: PlatformProfile): string | null {
  return profile.surfaceExposure.kind === 'unsupported' ? profile.surfaceExposure.reason : null;
}

/**
 * 外から届く一般利用者にあたる DB ロール(未ログイン → ログイン済みの順)。
 *
 * @param profile プラットフォームの設定
 * @returns ロール名の並び(宣言順。この 2 つだけが隠し列のマスクを受ける)
 */
export function endUserRoles(profile: PlatformProfile): readonly string[] {
  return [profile.roles.anonymous, profile.roles.authenticated_default];
}

/**
 * RLS をバイパスする内部実行にあたる DB ロール(サーバー側と非同期のワーカーが使う唯一のロール)。
 *
 * @param profile プラットフォームの設定
 * @returns ロール名
 */
export function privilegedRole(profile: PlatformProfile): string {
  return profile.roles.system;
}

/**
 * 外から呼べる DB ロールの全部(一般利用者 + 内部実行。土台の関数の `grant execute` の宛先)。
 *
 * @param profile プラットフォームの設定
 * @returns ロール名の並び(宣言順)
 */
export function callerRoles(profile: PlatformProfile): readonly string[] {
  return [...endUserRoles(profile), privilegedRole(profile)];
}

/**
 * ポリシーの中で実行者 id を与える式(初期計画に畳まれる形。既存の手書き RLS と同じ字面)。
 *
 * @param profile プラットフォームの設定
 * @returns SQL の式
 */
export function actorIdSql(profile: PlatformProfile): string {
  return `(select ${profile.currentActorExpr})`;
}


/**
 * 外に出すスキーマの中の関数・ビューを指す字面(`{スキーマ}.{名前}`)。
 *
 * @param profile プラットフォームの設定
 * @param name スキーマ修飾なしの名前
 * @returns スキーマ修飾つきの名前
 */
export function exposed(profile: PlatformProfile, name: string): string {
  return `${profile.exposedSchema}.${name}`;
}
