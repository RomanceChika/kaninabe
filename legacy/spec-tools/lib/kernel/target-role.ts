/**
 * 後段(差し替えうる具体のスタック)の**役割**の語彙(kernel 層 — 全層が読む共通語。設計メモ framework-modules §19 の表の語)。
 *
 * コアは後段の**名前**(どのホスト・どのプラットフォームか)を知らない。知っているのは「どの役割の後段が、どの検査・生成を
 * 受け持つか」だけで、その対応(例: Cron の登録の突合はホストの後段が受け持つ)は検査の側が役割の語で宣言する
 * (`lib/job/target-checks.ts`)。後段が無い構成では、その役割が受け持つ検査は**未実施**と報告される(黙って緑にしない)。
 *
 * 型と小さい定数だけで、何も import しない。**アプリの語彙も、具体のスタックの名前も 1 語も持たない。**
 */

/** 後段の役割の閉じた一覧(増やすのは新しい種類の後段を足す日)。 */
export const TARGET_ROLES = ['platform', 'host', 'app_frame'] as const;

/**
 * 後段の役割。
 *
 *   - `platform` … 認証・API 層・DB 内のスケジューラなど、Postgres の上に載る基盤(設定 `PlatformProfile` を持つ)
 *   - `host` … Cron の登録・デプロイ設定など、アプリを動かす場所
 *   - `app_frame` … Web フレームワーク(Server Action・画面の描画・Route Handler の置き方)
 */
export type TargetRole = (typeof TARGET_ROLES)[number];

/** 役割を人に言うときの言い方(「ホストの後段がこの構成に無い」など。後段の名前は書かない)。 */
export const TARGET_ROLE_WORDS: Readonly<Record<TargetRole, string>> = {
  platform: 'プラットフォーム',
  host: 'ホスト',
  app_frame: 'アプリの枠',
};

/** 役割ごとの、選べる後段の数の範囲(`min` 以上 `max` 以下)。 */
export interface TargetRoleMultiplicity {
  /** 少なくとも何つ要るか(0 は「無くてもよい」)。 */
  readonly min: number;
  /** 多くて何つまでか。 */
  readonly max: number;
}

/**
 * 役割ごとの多重度(選んだ後段の数の範囲)。**契約の一部**であり、違反は後段を選ぶ根の 1 回で失敗する(`selectTargetSet`)。
 *
 * - `platform` … ちょうど 1 つ(設定 `PlatformProfile` の持ち主は 1 人で、SQL を書く側が引数で受け取る)
 * - `host` … 高々 1 つ(無ければ、ホストが受け持つ検査は未実施と報告される)
 * - `app_frame` … 高々 1 つ(アプリの枠は 1 つ)
 *
 * 役割を足す日は、ここに行を足す(型が `Record<TargetRole, …>` なので、足し忘れは型が止める)。
 */
export const TARGET_ROLE_MULTIPLICITY: Readonly<Record<TargetRole, TargetRoleMultiplicity>> = {
  platform: { min: 1, max: 1 },
  host: { min: 0, max: 1 },
  app_frame: { min: 0, max: 1 },
};
