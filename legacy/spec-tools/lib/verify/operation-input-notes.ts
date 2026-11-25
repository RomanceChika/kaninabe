/**
 * 画面・UX・ユースケース・ジョブ・通知・認証フローの検査が**他の種類から引く材料**(action_spec・テーブル仕様・通知・ジョブ・画面・読み取りクエリ・ユースケース)が
 * 使えなかったことの報告(H2・H4・H6・J2・N1・N2・S2・S4・S8・S12・S14・S16・S17・S18・S19・U1・W1・W2・Y2・Y5・Y8・Y10・Y12)。
 *
 * これらの検査は、自分の種類の仕様のほかに、別の種類から事実を引く: 操作の属性の導出(確認が要るか)は action_spec の `ux` の上書きと入力の欄、
 * 集約の複合 RPC(テーブル仕様)、外へ出る通知、ジョブの種類を読み、フォーム・読み取りの部品の検査は action_spec の入力欄を読み、
 * 画面の検査は `reads` の指す読み取りクエリと保存点の指すユースケースを、通知の検査は走査の `emits`(ジョブ)を、認証フローの検査は着地の画面を、
 * 語彙漏れ検査は通知・ジョブ・設定カタログの語彙を読む。
 *
 * **他の種類を読む検査の全数は、範囲を限ってテストが固定する**(`foreign-readers.test.ts`: `lib/` 全域の入力の型で、入力の状態を通さずに他の種類のモデルを生で持つ欄を
 * AST で拾う。各群の主語の種類の欄は除く。拾った欄の読み手の検査は、この表か、画面の到達の表〔`reachability-notes.ts`〕・ユースケースの表〔`usecase-input-notes.ts`〕・
 * T 群の段の `reads`・A2 の置き場の表〔`placement-notes.ts`〕のどれかに載っていること)。表に無い欄・読み手が足されたら赤になる。範囲の外に残すのは生成・導出・台帳側の欄で、
 * 群ごとに欄の一覧で固定する(増減・入れ替えで赤)。読み手のファイルの走査は、検査器が入力の型を受けて読む欄にかける(群の入口が写すだけの欄・T 群の宣言で閉じる欄は走査せず、分類ごとの本数を固定する。導出の部品が受ける欄は、その部品を呼ぶ箇所のファイルを固定する)。**限界**: 入力の型を介さない書き方 —— `load*SpecModel` を import して直に読む検証器(例 `product/verifiers/p2-declared-uses.ts`)や、
 * 関数の引数・クロージャで渡す書き方 —— は見えない。
 * 以前はこの材料が任意の欄で、**採ったのに読めなかった**ときも、採っていないときと同じ「無い」として黙って回っていた。
 * 今は材料の入力の状態(未選択 / 阻害 / 読込済み)を呼び手が持ち、使えなかったことをここで行にして言う。
 *
 * - **未選択は黙る**: 製品がその種類を採っていないなら、材料は事実として無い(行を出さない)。
 * - **阻害は名指す**: 採ったのに渡せない。判定を保留する検査(action_spec の入力欄が要る Y2・Y8・Y10・Y12・U1、Y5 の入力と確認の数)は判定を出さず、
 *   読めた分で回す検査(カタログの材料を引く S19・U1・Y5 の確認の要否。読めない分は「無い」前提になる)は、見ていない分を言う。どちらも行は同じ形
 *   (`check-run-report.ts` の `describeInputGapNote`)で、範囲サマリの件数に入る。
 * - **読込済みは黙る**(0 件の空のカタログも)。
 * - **欠けた材料を否定できない側に倒している検査(S12)は、読めずに仕様を落としただけの阻害(`invalid`)では言わない**(材料は部分のモデルで渡り、倒す分岐に届いて実行済み)。
 *   置き場ごと無い・読めない阻害(`not-loaded` / `missing` / `load-failed`)ではモデルが無く、検査が実行されないので、他の検査と同じく行で名指す
 *   (`Need.exceptReasons`)。
 *
 * 落とした表(テーブル仕様の阻害のうち、読めずにモデルへ入れなかった表)があれば、その表の名前を対象に挙げる(`dropped-table-notes.ts`)。
 * 読み込みの error は各種類のローダーの 0 番が 1 回だけ出すので、ここは進捗の行であって Finding ではない。
 *
 * 検査を持つ群が実行されているときだけ言う(群が飛んでいれば、群自体の「スキップしました」の行が言う。同じ原因を 2 行で数えない)。
 */

import { unusableOf, type BlockedReason, type CatalogInput, type InputGapNote } from '../kernel/input-state.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import { droppedTableSubjects } from './dropped-table-notes.js';
import { describeInputGapNote } from './check-run-report.js';
import type { ProgressLog } from './group-contract.js';

/** 他の種類から引く材料の入力の状態(呼び手が `uses` と読み込みの結果から決めて渡す)。 */
export interface OperationInputStates {
  // 状態(未選択 / 阻害 / 読込済み)だけを見るので、中身の型は問わない(落とした表の名前を引くテーブル仕様だけ型を持つ)。
  readonly actions: CatalogInput<unknown>;
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  readonly notifications: CatalogInput<unknown>;
  readonly jobs: CatalogInput<unknown>;
  readonly screens: CatalogInput<unknown>;
  readonly queries: CatalogInput<unknown>;
  readonly usecases: CatalogInput<unknown>;
  readonly config: CatalogInput<unknown>;
}

/** 検査を持つ群が実行されているか(行を出す相手の群)。 */
export interface OperationGroupsRan {
  /** 画面仕様が読み込めている(S 群・U 群が動く)。 */
  readonly screens: boolean;
  /** ユースケース仕様が読み込めている(Y 群が動く)。 */
  readonly usecases: boolean;
  /** ジョブカタログが読み込めている(J 群が動く)。 */
  readonly jobs: boolean;
  /**
   * HTTP の入口の衝突(J2 の続き)が回る。**ジョブのカタログの有無に依らず**、実装の木を宣言していれば回る(`runJobVerification` の `entryCollisionRan` と同じ条件)。
   * 画面の route を役割をまたぐ主張に入れるので、ジョブのカタログが無くても画面の阻害は見ていないことになる。
   */
  readonly jobEntries: boolean;
  /** 通知カタログが読み込めている(N 群が動く)。 */
  readonly notifications: boolean;
  /** 認証フロー仕様が読み込めている(H 群が動く)。 */
  readonly auth: boolean;
  /** 語彙漏れ検査(W 群)が動く(カタログの有無に依らず常に動く)。 */
  readonly generality: boolean;
}

type InputName = keyof OperationInputStates;
type GroupName = keyof OperationGroupsRan;

/** 検査 1 本が引く材料 1 つ(材料の名前と、それが使えないと見ていないこと。文末の句点は付けない)。 */
interface Need {
  readonly input: InputName;
  readonly consequence: string;
  /** この材料の行を言う群(省略は検査の群)。検査の群が動いていなくても、この材料を読む部分だけが回るときに使う。 */
  readonly group?: GroupName;
  /**
   * この理由の阻害では言わない(欠けた材料を否定できない側に倒して実行しているので、見ていないことが無い)。省略は、どの阻害でも言う。
   * 置き場ごと無い・読めない阻害ではモデルが渡らず検査が実行されないので、ここに挙げてはならない。
   * 例: S12 は `['invalid']` —— 読めずに仕様を落としただけの阻害のときは、欠けた読みを否定できない側に倒して実行済みなので、この行は出ない
   * (行の文面〔`consequence`〕は「見ていません」だけを言い、出さない条件はここに持つ)。
   */
  readonly exceptReasons?: readonly BlockedReason[];
}

/** 材料を引く検査 1 本(検査器 ID・動かす群・引く材料)。 */
interface Dependent {
  readonly id: string;
  readonly group: GroupName;
  readonly needs: readonly Need[];
}

/** 確認の要否の導出が読むカタログの材料(材料 → 導出に渡す事実)。 */
const CATALOG_SUPPLIERS = {
  dataTables: '複合 RPC(同じトランザクションで他の表も書くか)',
  notifications: '通知の宛先の種別(外へ出る効果)',
  jobs: 'ジョブの種類(書き込みと同じトランザクションか)',
} as const;

/** 確認の要否の導出が読むカタログ。 */
type CatalogName = keyof typeof CATALOG_SUPPLIERS;

/** 確認の要否の導出を読む検査 1 本が、カタログの材料を引いたときの「見ていないこと」(検査ごとの括弧の中身)。 */
function catalogNeeds(what: string): readonly Need[] {
  return (Object.keys(CATALOG_SUPPLIERS) as CatalogName[]).map((input) => ({
    input,
    consequence: `${CATALOG_SUPPLIERS[input]}を読む確認の要否の導出は見ていません(${what})`,
  }));
}

/** 語彙漏れ検査(W 群)が禁じる語に入れるカタログの語彙。読めた分だけ入れ(読めなかった分は禁じる語に入らない)、見ていない漏れを検査ごとに言う。 */
const VOCABULARY_SUPPLIERS = {
  notifications: '通知カタログの語彙(medium・audience・mention)',
  jobs: 'ジョブカタログの語彙(kind・on_failure)',
  config: '設定カタログの語彙(kind・requirement・used_by)',
} as const;

/** 語彙漏れ検査が禁じる語に語彙を入れるときの、検査ごとの「見ていないこと」。 */
function vocabularyNeeds(what: string): readonly Need[] {
  return (Object.keys(VOCABULARY_SUPPLIERS) as (keyof typeof VOCABULARY_SUPPLIERS)[]).map((input) => ({
    input,
    consequence: `${VOCABULARY_SUPPLIERS[input]}のうち読めなかった分は禁じる語に入れられていないので、その語の${what}は見ていません(読めた分の語彙は入れて実行済み)`,
  }));
}

/** 材料を引く検査(ID 順)。 */
export const OPERATION_INPUT_DEPENDENTS: readonly Dependent[] = [
  { id: 'H2', group: 'auth', needs: [{ input: 'screens', consequence: '着地・関門の送り先の画面仕様との突合、案内画面の排他表示との一致は見ていません(画面に依らない関門の実装の実在は、実装の木があれば実行済み)' }] },
  { id: 'H4', group: 'auth', needs: [{ input: 'screens', consequence: '掛かる画面が 1 つも無い関門(未使用の関門)の判定は見ていません(読めた画面が掛かる関門の宣言漏れは、読めた画面があれば実行済み)' }] },
  { id: 'H6', group: 'auth', needs: [{ input: 'actions', consequence: '多要素認証を要求するとき、runner: manual の操作の手書きの Server Action が判断と書き込みの前に判定を呼んでいるかは見ていません(送り先・ロール・確かめる関数・書き込みの入口の解決の接地は実行済み)' }] },
  { id: 'J2', group: 'jobs', needs: [
    { input: 'actions', consequence: 'scans の宣言元(action_spec)に依る fires と scans の突合、scans の発火元は見ていません' },
    { input: 'screens', group: 'jobEntries', consequence: '読めなかった画面の route を主張に入れた HTTP の入口の衝突は見ていません' },
  ] },
  { id: 'N1', group: 'notifications', needs: [{ input: 'jobs', consequence: 'schedule の行を積む走査があるか(積む走査が無い死んだ宣言)は見ていません(effects に依る判定・auto の死んだ宣言・読めた走査の emits が名指す通知の突合は実行済み)' }] },
  { id: 'N2', group: 'notifications', needs: [{ input: 'jobs', consequence: 'person_from の集約が走査の due_from の集約と一致するかは見ていません(effects の集約との突合は実行済み)' }] },
  { id: 'S2', group: 'screens', needs: [{ input: 'queries', consequence: 'reads が名指す読み取りクエリ(query_spec)の実在は見ていません(actions・navigations・chrome・overlays の参照先は実行済み)' }] },
  { id: 'S4', group: 'screens', needs: [{ input: 'queries', consequence: 'reads の読み取りクエリと画面のロールの整合は見ていません(for の実在・actions とのロールの整合は実行済み)' }] },
  { id: 'S8', group: 'screens', needs: [{ input: 'queries', consequence: 'test_cases の spec_ids が実在する仕様を指すかは見ていません(spec_ids の値域に読み取りクエリの id が入る。@tc の突合は実行済み)' }] },
  { id: 'S12', group: 'screens', needs: [{ input: 'queries', exceptReasons: ['invalid'], consequence: '読み取りクエリの失敗を画面が受けられるか(エラーの到達)は見ていません' }] },
  { id: 'S14', group: 'screens', needs: [{ input: 'queries', consequence: '各状態の実体を返す読み取りクエリ(query_spec)があるか(状態の可視性)は見ていません(unseen_states の宣言が実在する状態かは実行済み。見える経路ができたのに残った宣言の判定は、関門が使えるときに、読めた読み取りクエリ(query_spec)がある分だけ実行済み。読み取りクエリが 1 本も読めなければ見つかる経路が無いので、実行済みは名目になる)' }] },
  { id: 'S16', group: 'screens', needs: [{ input: 'usecases', consequence: 'usecases が名指す保存点の実在(「保存点は usecase_spec にありません」)は見ていません(読めた保存点の手順の露出と起点からの到達は、画面の到達が使えるときに、読めた保存点(usecase_spec)がある分だけ実行済み。保存点が 1 つも読めなければ見る対象が無いので、実行済みは名目になる)' }] },
  { id: 'S17', group: 'screens', needs: [{ input: 'actions', consequence: 'フォームの部品が載せる操作が手書き(runner: manual)の宣言か、は判定していません' }] },
  { id: 'S18', group: 'screens', needs: [
    { input: 'actions', consequence: '読み取りの部品の選択肢の欄と、操作の入力の ref の欄の突合は判定していません' },
    { input: 'queries', consequence: '読み取りの部品(table・detail・form の選択肢)が指す読み取りクエリの形と shows の欄の突合は見ていません(chrome に置かれていないかは実行済み)' },
  ] },
  { id: 'S19', group: 'screens', needs: [
    { input: 'actions', consequence: 'action_spec に依る操作の部品の割り付け(手書きの操作・確認が要る操作・追加の入力を持つ操作)は判定していません' },
    { input: 'queries', consequence: '操作の部品が読む読み取りクエリ(query_spec)に依る判定(kind: actions の読みが 1 行を返すか・edit / actions の操作が読みの source のものか)は見ていません' },
    ...catalogNeeds('確認が要る操作の部品の割り付け'),
  ] },
  { id: 'U1', group: 'screens', needs: [
    { input: 'actions', consequence: '確認が要る操作が確認を経て発火されるかは判定を出していません(action_spec の ux の上書きと入力の事実を引けない)' },
    ...catalogNeeds('確認が要る操作が確認を経るか'),
  ] },
  { id: 'W1', group: 'generality', needs: vocabularyNeeds('仕組み側のコードの文字列リテラルへの漏れ') },
  { id: 'W2', group: 'generality', needs: vocabularyNeeds('アプリ側の仕組みの層の散文への漏れ') },
  { id: 'Y2', group: 'usecases', needs: [{ input: 'actions', consequence: '手順の入力が参照する集約の作成順は見ていません' }] },
  { id: 'Y5', group: 'usecases', needs: [
    { input: 'actions', consequence: '入力と確認の数(予算)は数えていません' },
    ...catalogNeeds('確認の数の予算'),
  ] },
  { id: 'Y8', group: 'usecases', needs: [{ input: 'actions', consequence: '保存点の全引数が規約で解決できるか(action_spec の入力欄を引く)は見ていません' }] },
  { id: 'Y10', group: 'usecases', needs: [{ input: 'actions', consequence: '保存点の実行計画(permit が要る事実の供給元)が決まるか(action_spec の入力欄を引く)と、不変条件の実行漏れは見ていません' }] },
  { id: 'Y12', group: 'usecases', needs: [{ input: 'actions', consequence: '保存点が複合 RPC に写せるか(action_spec の入力欄を引く)は見ていません' }] },
];

/**
 * 材料が使えなかったことを、読む検査ごとの記録にする(使えるなら・未選択なら・その検査の群が動いていなければ空。**阻害だけ**を言う)。
 * 並びは検査 ID 順、同じ検査の中は action_spec → カタログ(テーブル仕様・通知・ジョブ)の順。
 *
 * @param states 材料の入力の状態
 * @param ran 検査を持つ群が実行されているか
 */
export function operationInputGapNotes(
  states: OperationInputStates,
  ran: OperationGroupsRan,
): readonly { readonly id: string; readonly note: InputGapNote }[] {
  const notes: { readonly id: string; readonly note: InputGapNote }[] = [];
  for (const dependent of OPERATION_INPUT_DEPENDENTS) {
    for (const need of dependent.needs) {
      if (!ran[need.group ?? dependent.group]) continue;
      const input = states[need.input];
      const gap = unusableOf(input, NAMES[need.input]);
      if (gap === null || gap.state !== 'blocked') continue;
      if (need.exceptReasons?.includes(gap.reason) === true) continue;
      const subjects = need.input === 'dataTables' ? droppedTableSubjects(states.dataTables) : [];
      notes.push({
        id: dependent.id,
        note: { gap, consequence: consequenceOf(need, subjects), ...(subjects.length === 0 ? {} : { subjects }) },
      });
    }
  }
  return notes;
}

/** 材料の入力の名前(種類の名前。行に出る)。 */
const NAMES: Readonly<Record<InputName, string>> = {
  actions: 'actions',
  dataTables: 'data_tables',
  notifications: 'notifications',
  jobs: 'jobs',
  screens: 'screens',
  queries: 'queries',
  usecases: 'usecases',
  config: 'config',
};

/** 見ていないこと。落とした表があるときは、複合 RPC を「落とした表の」と限る。 */
function consequenceOf(need: Need, droppedTables: readonly string[]): string {
  return need.input === 'dataTables' && droppedTables.length > 0 ? need.consequence.replace('複合 RPC(', '落とした表の複合 RPC(') : need.consequence;
}

/**
 * 材料が使えなかったことを実行ログへ残す(使えるなら・未選択なら何も言わない)。
 *
 * @param states 材料の入力の状態
 * @param ran 検査を持つ群が実行されているか
 * @param log 実行ログ
 */
export function logOperationInputGaps(states: OperationInputStates, ran: OperationGroupsRan, log: ProgressLog): void {
  for (const entry of operationInputGapNotes(states, ran)) log(describeInputGapNote(entry.id, entry.note));
}
