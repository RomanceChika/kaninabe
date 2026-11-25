/**
 * 生成物に埋め込まれる**仕組みの文言**の唯一の表。
 *
 * ## なぜ 1 か所に集めるのか
 *
 * 生成物に出る日本語には 2 種類ある。
 *
 *   1. **仕様から来る語** —— `label` / `statement` / `summary` / `otherwise_forbidden` 等。
 *      これは写しであり、正は仕様側にある(別のアプリでは別の語になる)。
 *   2. **仕組みの文言** —— 「送信中…」「更新するフィールドを 1 つ以上指定してください」
 *      「〜は拒否される」のような、どのアプリでも同じ文。
 *
 * 2 が生成器のあちこちに散らばっていると、**別のアプリに移したときに何が日本語のまま残るか
 * が誰にも分からない**(検査の漏れ探し 2026-09-12 §6)。ここに集めておけば、文言表を訳せば
 * 他言語のアプリが作れる、という形が保てる。
 *
 * ## 機械の目
 *
 * 通し実行の**出力側の目**(`legacy/spec-tools/__tests__/samples/generated-wording.ts`)が、
 * サンプルの生成物に出た日本語を「サンプルの仕様に現れる語」と「この表の断片」に
 * 分解できることを確かめる。**分解できない日本語が 1 つでもあれば赤**である ——
 * つまりこの表を通さずに生成器へ日本語を書き足すと、fixture のテストが落ちる。
 *
 * ## ここに書かないもの
 *
 * - 生成物の **doc コメント**(人が読む説明)。コメントは出力の意味を変えないので対象外。
 * - **層・置き場の説明**(`framework-dirs.ts` の `role`)。あれは既に 1 か所の宣言であり、
 *   `generate/message-fragments.ts` の `frameworkRoleWords()` がその表を引くだけにする
 *   (同じ語を 2 度書かない)。
 *
 * ## 置き場
 *
 * 文言の層(`lib/messages/`)は、生成側(`generate/`)・SQL の導出(`sql/`)・テスト名の導出
 * (`usecase/`)・結果表(`results/`)・検証器のどれからも読まれる。**ここは値を何も import
 * しない**(型だけを下の層から借りる)ので、読み合いの輪ができない。断片の全数を集める
 * `messageFragments()` は `sql/` の宣言を読むので、層の外(`generate/message-fragments.ts`)にある。
 *
 * ## 画面の文言は別ファイル
 *
 * 画面の部品(フォーム・表・ボタン)の既定の語(`FORM_WORDING` / `TABLE_WORDING` / `BUTTON_WORDING`)は
 * `messages-screen.ts` に分けてある(このファイルが 300 行を超えたため)。断片の全数は表と同じファイルに
 * 置き(`SCREEN_FIXED_FRAGMENTS`)、ここの `FIXED_FRAGMENTS` が束ねる ——
 * 表と全数が別ファイルになる「足し忘れが検査まで見えない」穴は、対を同じファイルに置いて塞いだ。
 */

import { SCREEN_FIXED_FRAGMENTS } from './messages-screen.js';
import { CASCADE_FIXED_FRAGMENTS, unverifiedWhat } from './messages-cascade.js';
import type { UnverifiedCascade } from '../semantics/operation-cascade.js';

/** 生成テストの describe の見出しに付く印(「この describe は生成物である」)。 */
export const GENERATED_SUITE_SUFFIX = '(生成)';

/** 計算値の例の表から生成するテストの describe の見出し(行ごとのテスト名は仕様の `note` がそのまま入る)。 */
export const COMPUTE_EXAMPLE_TITLES = {
  suite: (ref: string): string => `${ref} の例の表${GENERATED_SUITE_SUFFIX}`,
} as const;

/** 生成テストのテスト名(場面ごとに 1 文)。`label` は仕様の `label` がそのまま入る。 */
export const SCENARIO_TITLES = {
  /** 許可されたロールが実行できる。 */
  success: (role: string, label: string): string => `${role} として ${label} を実行できる`,
  /** ガードが成立しない。 */
  guardUnsatisfied: (label: string): string => `前提が成立しないとき ${label} は拒否される`,
  /** 遷移元でない状態。 */
  invalidFrom: (label: string): string => `遷移元でない状態では ${label} は拒否される`,
  /** 許可されていない実行者。 */
  forbidden: (label: string): string => `許されていない実行者の ${label} は拒否される`,
  /** 根拠は成立しているが、実行者の行の条件(ADR-0018)を満たさない。 */
  unmetCondition: (label: string): string => `行の条件を満たさない実行者の ${label} は、根拠があっても拒否される`,
  /** 対象が見つからない(存在を漏らさない)。 */
  notFound: (label: string): string => `対象が見つからないとき ${label} は存在を漏らさず拒否される`,
  /** 判断のあとに前提が崩れた(競合)。 */
  conflict: (label: string): string => `判断のあとに前提が崩れた ${label} は競合として拒否される`,
  /** 不変条件違反がそのまま返る。 */
  invariant: (label: string): string => `${label} の不変条件違反はそのまま不変条件違反として返る`,
  /** 変更を 1 つも運ばない編集。 */
  emptyChange: (label: string): string => `変更を 1 つも運ばない ${label} は入力の不正になる`,
  /** 競合の場面が「対象が実在しない」を兼ねるときの但し書き。 */
  alsoAbsentTarget: (title: string): string => `${title}(対象が実在しない場合を含む)`,
  /** 計画の判定がエンジンの判定と一致することの性質テスト。 */
  planMatchesEngine: (): string => '計画の判定はエンジンの判定と一致する(性質)',
} as const;

/**
 * 5 形のうち遷移以外の**動作の名前**(テスト名・フォームの見出しの主語を組むのに使う)。
 * 遷移はイベントの `label` が既に動作を示しているのでここには無い。
 */
export const OPERATION_VERBS = {
  create: '作成',
  delete: '削除',
  update: '編集',
} as const;

/** 「{集約の label}の{動作}」の組み立て。 */
export function operationSubject(label: string, verb: string): string {
  return `${label}の${verb}`;
}

/**
 * 確認ダイアログの方針(`confirm_required` / `variant`)の**根拠**の文言。
 *
 * 生成物 `action-attributes.ts` の `basis` に写り、ハンドブックの「なぜ確認が要るのか」を
 * 人が読むための行になる。仕様の id(集約・状態・イベント)は差し込みであり、地の文だけが
 * ここの持ち物である。
 */
export const BASIS_NOTES = {
  /** 逆向きの経路の有無(取り返しがつくか)。 */
  reversePath: (machine: string, event: string, to: string, from: readonly string[], exists: boolean): string =>
    `state_spec(${machine}.${event}): to=${to} から from(${from.join(', ')})への経路 ${exists ? '有り' : '無し'}`,
  /** 許可されたロールに所有者以外が混ざるか。 */
  nonOwner: (nonOwner: boolean): string => (nonOwner ? '所有者以外を含む' : '所有者のみ'),
  /** 生成対象に無い操作 ID を引いたときの既定値の根拠。 */
  unknownOperation: (): string => 'event ID が action-attributes.ts の生成対象に無い',
  /** 接地できなかったときの根拠(検査を通っていれば現れない)。 */
  ungrounded: (): string => '接地先が見つからない(verify 通過後には現れないはず)',
  /** 着地の状態の調子(`tone`)。 */
  tone: (to: string, tone: string): string => `state_spec: to=${to} の tone=${tone}`,
  /** 着地で確定するもの(`settles`)。 */
  settles: (to: string, ids: readonly string[]): string => `state_spec: to=${to} の settles=${ids.join(',')}`,
  /** 外へ出る効果(公開チャンネル通知・スナップショット)。 */
  outbound: (jobIds: readonly string[]): string =>
    `effects: ${jobIds.join(',') || '(snapshot)'} が公開チャンネル通知またはスナップショットを含む`,
  /** 削除が個人の列を持つ行を消す。 */
  deletesPersonalRow: (entity: string): string => `entity_spec(${entity}): personal 列を持つ行を削除する`,
  /** 同一トランザクションで実現される効果が名指しした RPC が、他の表も書く。 */
  compositeAlsoWrites: (rpcs: readonly string[], tables: readonly string[]): string =>
    `data_table: 同一トランザクションで実現される効果が実現する RPC ${rpcs.join(', ')} の also_writes(${tables.join(', ') || '(空)'})を伴う`,
  /** 破壊的な書き込み（行を消す / 個人列を置き換えて消す）。 */
  destructiveWrite: (table: string, kind: 'delete' | 'scrub'): string =>
    kind === 'delete' ? `data_table: ${table} の行を削除する` : `data_table: ${table} の個人列を置き換えて消す`,
  /** 遷移が個人列を空にする(`clears` ∩ personal)。 */
  clearedPersonal: (machine: string, event: string, columns: readonly string[]): string =>
    `state_spec(${machine}.${event}): clears が personal 列 ${columns.join(', ')} を空にする`,
  /** 連鎖を確かめられなかった(未検査。安全側に倒して破壊的とみなす)。 */
  unverifiedCascade: (reason: UnverifiedCascade): string => `未検査: ${unverifiedWhat(reason)}(破壊的とみなす)`,
  /** 同時に書く表が個人の列を持つ。 */
  alsoWritesPersonal: (table: string, columns: readonly string[]): string =>
    `data_table: ${table} が personal 列 ${columns.join(', ')} を持つ`,
} as const;

/** 確認ダイアログに添える「何が起きるか」の注意書き(action_spec の事実から導く)。 */
export const CONFIRM_NOTES = {
  /** 取り返しがつかない。 */
  irreversible: (): string => '元に戻せません。',
  /** 自分以外の情報が変わる(実行者の集約の `label` が入る)。 */
  affectsOthers: (actorLabel: string | undefined): string =>
    actorLabel === undefined ? '自分以外の情報が変わります。' : `他の${actorLabel}の情報が変わります。`,
  /** 外へ出る。 */
  outbound: (): string => '外部に公開・送信されます。',
  /** 行が消える。 */
  destructive: (): string => 'データが削除されます。',
  /** 金額が決まる(`settles` の語の `label` が入る)。 */
  settles: (label: string): string => `${label}がこの時点で確定します。`,
} as const;

/** 入力スキーマが返す拒否の文言(zod の `error`)。 */
export const INPUT_ERRORS = {
  /** 編集で 1 つも欄を指定していない。 */
  noFieldSelected: (): string => '更新するフィールドを 1 つ以上指定してください',
} as const;

/**
 * この表が持つ**固定の日本語の断片**(差し込みを除いた全数)。
 *
 * 出力側の目はこの一覧と仕様の語だけで生成物の日本語を分解する。**ここに無い日本語を
 * 生成器が書けば fixture のテストが落ちる**ので、文言を足すときは必ずこの表に足す。
 */
export const FIXED_FRAGMENTS: readonly string[] = [
  GENERATED_SUITE_SUFFIX,
  ' の例の表',
  ' として ',
  ' を実行できる',
  '前提が成立しないとき ',
  '遷移元でない状態では ',
  '許されていない実行者の ',
  '対象が見つからないとき ',
  '判断のあとに前提が崩れた ',
  '変更を 1 つも運ばない ',
  ' は拒否される',
  ' は存在を漏らさず拒否される',
  ' は競合として拒否される',
  ' の不変条件違反はそのまま不変条件違反として返る',
  ' は入力の不正になる',
  '(対象が実在しない場合を含む)',
  '計画の判定はエンジンの判定と一致する(性質)',
  '元に戻せません。',
  '自分以外の情報が変わります。',
  '他の',
  'の情報が変わります。',
  '外部に公開・送信されます。',
  'データが削除されます。',
  'がこの時点で確定します。',
  '更新するフィールドを 1 つ以上指定してください',
  ...SCREEN_FIXED_FRAGMENTS,
  OPERATION_VERBS.create,
  OPERATION_VERBS.delete,
  OPERATION_VERBS.update,
  'の',
  'から',
  'への経路 ',
  '有り',
  '無し',
  '所有者以外を含む',
  '所有者のみ',
  'event ID が action-attributes.ts の生成対象に無い',
  '接地先が見つからない(verify 通過後には現れないはず)',
  ' の tone=',
  ' の settles=',
  ' が公開チャンネル通知またはスナップショットを含む',
  ' personal 列を持つ行を削除する',
  ' の行を削除する',
  ' の個人列を置き換えて消す',
  ': clears が personal 列 ',
  ' を空にする',
  ...CASCADE_FIXED_FRAGMENTS,
  ' 効果が実現する RPC ',
  ' の also_writes(',
  ')を伴う',
  '(空)',
  ' が personal 列 ',
  ' を持つ',
];

/**
 * 定型 RPC の本文(生成 plpgsql)に出る**仕組みの文言**。
 *
 * 生成物が SQL でも事情は同じである —— 別のアプリに移したときに何が日本語のまま残るかは、
 * ここを見れば分かる。出力側の目(`generated-wording.ts`)が見るのは `.ts` / `.tsx` だけ
 * なので SQL は走査の対象外だが、**文言の住所はこの表 1 つ**という規約は変えない。
 */
export const RPC_BODY_WORDS = {
  /** 生成物であることの宣言(ファイル先頭)。 */
  generatedHeader: 'AUTO-GENERATED by `npm run generate` — 手編集禁止。',
  /** 正がどこにあるか(ファイル先頭)。 */
  generatedNote: [
    'このファイルの正は次の仕様であり、ここはその機械的な写像にすぎない。',
    '変更するときは仕様を編集してから再生成すること(ADR-0006)。',
  ],
  /** 追記専用の歴史との両立のしかた(ファイル先頭)。 */
  migrationNote: [
    'SQL が変わる仕様変更をしたら functions[].migration の名前を新しくする(適用済みの',
    'migration は書き換えない。migrations.md §生成 migration)。関数は create or replace',
    'なので、新しいファイルが同じ名前の関数を置き換える。',
  ],
  /** 変更を 1 つも運ばない編集(入力の不正)。 */
  noChanges: '変更するフィールドがありません',
  /** 宣言に無い列を書き換えようとした(列の閉じた集合)。 */
  unknownColumn: 'writes に宣言されていない列は書き換えられません',
  /** 0 行の理由を分類する順(束 ⑳-3)。 */
  refusalOrder: '0 行の理由を分類する(状態 → ロール → ガード。TS の engine と同じ順)。',
  /** 0 行の理由を分類する順(作成。自分の状態の段が無い形)。 */
  createRefusalOrder: '0 行の理由を分類する(ロール → 再送 → 状態 → ガード。作成に自分の状態の段は無い)。',
  /** 照会では理由が立たなかった 0 行(残る唯一の実在ケース)。 */
  refusalRace: '照会は 3 つとも通った = 照会と書き込みの間に行が動いた(競合)。',
  /** `comment on function` に足す契約 —— by とガードを本文が守る。 */
  commentEnforces: 'by(ロール)とガードは本文が守る(RPC 単体で仕様どおり)。',
  /** 0 行だったときの意味(作成)。 */
  createResend: '0 行 = 同じ id で作成済み(冪等な再送)か、前提が崩れた(競合)。id の実在で見分ける。',
  /** 挿入の前に再送を決める理由(点検 26 回目 B26-1)。 */
  createResendBeforeInsert:
    '同じ id の行が既にあれば、挿入の前に再送の枝へ進む(行の before insert トリガは一意の衝突の判定より先に走るので、挿入まで進むと押し直しでも番号のずらし・上端の断り・確かめのトリガが動く)。上の掴みの後に見るので、同じ鍵の 1 回目がまだコミットしていなければここで待ってから見る。既にある行は上の掴みが掴んでいる(消す txn がまだコミットしていなければそこで待ち、消えていれば挿入へ進んで作り直しの断りに合流する)。',
  /** 再送の入力の比べ(点検 20 回目 B20-1)。 */
  resendInputMismatch: '同じ鍵で入力が違う再送は返さない(1 回目は書けている。2 回目の入力を書けたと偽らず、行も増やさない)。',
  /** 効果の門に使う列を、書き込み直前に読む理由。 */
  effectGateRead: '宣言列の「変わったか」は書き込みと同一トランザクションで見る(この瞬間の値を読む)。',
  /** 効果の門そのもの。 */
  effectGate: '宣言列のどれかが実際に変わった行に対してだけ、渡された効果を outbox に積む。',
  /** セッションを終える効果(ジョブカタログの ends_sessions)の呼び出し。 */
  endSessions: 'セッションを終える効果(ends_sessions)を載せたイベントでは、遷移と同じトランザクションで認証基盤の呼び出しを行う(呼び先の本文に閉じる)。',
  /** その txn が触る行を、書き込みの前に表名のバイト順で掴む理由。 */
  lockGuardRows:
    'この txn が触る行(ガードが読む親・実行者の行・これから書く行)を、表名のバイト順で' +
    '全部掴んでから書く(交錯しても判定の前提が動かず、掴む順が 1 つなので詰まらない)。',
  /** 行ロックの後に時刻を 1 度だけ取る理由。 */
  clockCapture:
    '時刻のガード(now)と records_time は、行ロックを取った後のこの 1 つの時刻で判定・記録する' +
    '(now() はトランザクションが始まった時点の値で、ロック待ちが締切をまたぐと期限切れの後に通る)。',
  /** records_actor の列の引数を、書き込みの前にイベントで縛る理由(点検 7 回目 A7-1)。 */
  actorBind:
    'records_actor の列は、記録する遷移では実行者そのもの・input で受ける遷移では引数・それ以外の遷移では' +
    '引数を使わない(呼び手が何を渡しても、遷移を起こした人を他人の行の持ち主に据え替えられない)。',
  /** 署名を変えたときに旧オーバーロードを落とす理由(生成 SQL の頭のコメント)。 */
  dropStale: [
    '同じ名前で引数の違う関数(旧い署名)が残っていたら先に落とす。create or replace は',
    '署名が変わると「置き換え」ではなく**もう 1 本**を作るので、権限の付いた旧署名が呼べる',
    'まま残る(migrations.md §生成 migration)。',
  ],
  /** `comment on function` に足す契約 —— 冪等キー(再送で返すのは作成者が実行者の行だけ)。後ろに作成者の欄が続く。 */
  commentIdempotentOwn: '冪等キーは引数の id。同じ id の再送で既存の行を返すのは、作成者の欄が実行者と一致するときだけ(他人の行は UC409)。作成者の欄',
  /** `comment on function` に足す契約 —— 冪等キー(再送で返すのは監査ログの実行者が今回の実行者の行だけ。点検 20 回目 B20-1)。 */
  commentIdempotentRecorded:
    '冪等キーは引数の id。同じ id の再送で既存の行を返すのは、その作成の監査ログの実行者が今回の実行者と一致するときだけ(他人の行は UC409)。入力が違う再送は UC412(resend_input_mismatch)。',
  /** `comment on function` に足す契約 —— 冪等キー(再送で既存の行を返さない)。 */
  commentIdempotentConflict: '冪等キーは引数の id。同じ id の行が既にあれば、再送でも既存の行を返さず UC409。',
  /** `comment on function` に足す契約 —— 書けなかったときの合図。 */
  commentZeroRows: '書けないときは errcode で理由を返す(UC403 = ロール / UC412 = ガード / UC409 = 状態)。',
  /** `comment on function` に足す契約 —— 監査ログで値を伏せる列。 */
  commentRedacted: '監査ログに値を残さない個人の欄',
} as const;
