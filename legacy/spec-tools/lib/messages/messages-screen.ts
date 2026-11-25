/**
 * 画面の部品(`kind: form` / `table` / `detail` / `actions`)の生成物に埋め込まれる**仕組みの文言**。
 *
 * `messages.ts`(生成物の仕組みの文言の唯一の表)から**画面の分だけを切り出した**もの。表の考え方
 * (仕様の語は写し・仕組みの文言はここ・別のアプリへ移すときはこの表を訳す)は `messages.ts` の冒頭が正で、
 * 出力側の目(`generated-wording.ts`)が見る断片の全数は `messages.ts` の `FIXED_FRAGMENTS` がこの表の
 * `SCREEN_FIXED_FRAGMENTS` を束ねて持つ。**値を何も import しない**(層の規則も `messages.ts` と同じ)。
 */

/** 実行中の画面の文言(1 画面フォームの送信ボタン)。 */
export const FORM_WORDING = {
  /** 送信中のボタンの表示。 */
  pending: (): string => '送信中…',
  /** 画面の部品のフォームの送信ボタン(部品に `label` が無いときの既定の表示)。 */
  submit: (): string => '送信',
  /** 参照の欄の選択肢の先頭(値を選ばない選択肢)の既定の語。製品固有の言い換えは器が `emptyOptionLabel` で欄ごとに渡す(層 (c))。 */
  none_selected: (): string => '未選択',
  /** 編集中の欄を、他の人が先に変更していたとき(refresh で最新が届いた欄)の知らせ。 */
  conflict: (): string => '他の人が変更しました',
  /** 競合の解き方 1: 手元の編集を捨てて最新の値を取る。 */
  take_theirs: (): string => '最新を取る',
  /** 競合の解き方 2: 手元の値を残して、最新の値の上に上書きする。 */
  keep_mine: (): string => '自分の値で上書き',
} as const;

/**
 * 画面の部品の表・詳細(`kind: table` / `detail`)の文言。**既定の 1 形**で、上書きの口は作らない
 * (好みの領域は層 (c) の器が `skin` でなく文言を差し込む口を要るなら束 5 の UX 原則で)。
 */
export const TABLE_WORDING = {
  /** 真偽値の「はい」。表と詳細で同じ語(画面ごとの揺れ `✓` / `可` を 1 つにする)。 */
  yes: (): string => 'はい',
  /** 真偽値の「いいえ」。 */
  no: (): string => 'いいえ',
  /** 値が無い(null)。 */
  none: (): string => '—',
  /** 行が 0 件のとき: 部品の `label` の後ろに付く(`{label}はまだありません`)。 */
  emptySuffix: (): string => 'はまだありません',
  /** 行が 0 件のとき: 部品に `label` が無い場合の既定。 */
  emptyBare: (): string => 'まだありません',
  /** ボタン列(`kind: actions`)で、行の状態と実行者のロールの交差に出せる操作が 1 つも無いとき。 */
  emptyActions: (): string => 'いまできる操作はありません',
} as const;

/**
 * 画面の部品の操作のボタン(`kind: table` の `edit` / `actions`・`kind: actions`)の文言。**既定の 1 形**。
 *
 * 遷移のボタンはイベントの `label`(`{machine}EventLabels`)が文言なのでここには無い。ここにあるのは
 * **予約 ID**(作成 / 編集 / 削除)の既定の語で、画面ごとの上書きは確認の重ね表示(`overlays[].label`)の口が持つ。
 */
export const BUTTON_WORDING = {
  /** 予約 ID `create` の既定の文言。 */
  create: (): string => '登録',
  /** 予約 ID `update`(行の編集の保存ボタン)の既定の文言。 */
  update: (): string => '保存',
  /** 予約 ID `delete` の既定の文言。 */
  delete: (): string => '削除',
  /** 操作のボタンを並べる列の見出し。 */
  header: (): string => '操作',
} as const;

/**
 * この表が持つ**固定の日本語の断片**(差し込みを除いた全数)。`messages.ts` の `FIXED_FRAGMENTS` が束ねる。
 * 上の表に語を足すときは、ここにも足す(足さなければ出力側の目が赤になる)。
 */
export const SCREEN_FIXED_FRAGMENTS: readonly string[] = [
  '送信中…',
  '送信',
  '未選択',
  '他の人が変更しました',
  '最新を取る',
  '自分の値で上書き',
  'はい',
  'いいえ',
  '—',
  'はまだありません',
  'まだありません',
  'いまできる操作はありません',
  '登録',
  '保存',
  '操作',
];
