/**
 * 入力の状態を報告する検査(`kernel/input-state.ts` の `CheckRun`)の、実行ログへの 1 行報告。
 *
 * **実行したものは言わない**(群の要約行がすでに「実行しました」と言う)。言うのは範囲が縮んだものだけである。
 *
 *   - **未実施** … 製品がその種類を採っていない(`uses` に無い)。検査しなかったのが正しい。
 *   - **阻害** … 採ったのに検査へ渡せない。**検査しなかったのが誤り**で、原因の診断(各種類のローダーの
 *     0 番の検査と P 群)は別に error として出ている。この行は「その検査は見ていない」を足すだけで、
 *     error を二重に数えない(行は進捗の報告であり Finding ではない)。
 *
 *   - **入力の一部だけが使えなかった** … 検査が 2 つ以上の種類を入力に取り、片方だけが未選択・阻害のとき
 *     (T2 = query_spec と関数の `lookup`)。使えた入力の分は実行し、使えなかった入力の分は**導かない**。
 *     語は未実施 / 阻害と同じで、同じ件数に数える。
 *
 *   - **検査の `gaps`**(`InputGapNote`)… 検査が 2 つ以上の種類を入力に取り、使えなかった入力が検査の全体または一部の判定に
 *     効くとき(A15 / A18 / A19 のテーブル仕様・A15 / A19 のジョブ(一部の操作の判定だけ出さない)・A10 の外部連携・T 群 / X 群の
 *     ほかの種類の裏づけ)。使えなかった入力ごとに 1 行(`describeInputGapNote`)。判定の対象を名指せるときは対象を並べる。
 *     **一部の判定だけが阻害に依る形も、検査の全体が依る形も、この 1 本で言う**(以前は一部の形だけ別の書き方があった)。
 *
 *   - **関係の層の `gaps`** … 画面の到達(`relations/screen-reachability`)のように、複数の検査が同じ入力を読む値が
 *     「使えなかった入力」を `gaps` で返すとき、読む検査ごとに 1 行ずつ(`describeGapNotes`)。
 *
 * **行の書き方は `describeInputGap` の 1 本**である(未実施 / 阻害の語・採っていない / 渡せない理由・「原因の error は
 * 別に出ている」の案内)。`describeCheckRun`(A13 の形)と `describeGapNotes`(T2・画面の到達の形)は、どちらもそれを呼ぶ。
 * 検査ごとに別の書き方を増やさない。
 *
 *   - **後段が受け持つ検査が、後段の無い構成で動かなかった** … ホストの後段が無ければ J2 の Cron の登録の突合と J4 が、プラットフォームの
 *     後段が無ければ J3 が動かない(`describeMissingTarget`)。語は未実施と同じ(`ID: 未実施 — …`)で、同じ件数に数える。**入力の状態の
 *     新しい種類ではない**(入力は読めている。見ていないのは、その検査を受け持つ後段を、組み立ての根が選ばなかったから、または選んだ後段が
 *     その口を登録していないから。理由は事実どおりに書き分ける)。
 *   - **後段が「この後段では対象外」と理由つきで宣言した口** … `ID: 対象外 — …`(`describeNotApplicableTarget`)。**未実施とは別の語**で、
 *     範囲サマリの件数に入らない(見る必要が無いという申告であり、見ていないことではない)。
 *
 * どれも `skip-notes.ts` が拾い、最後のサマリの「範囲を実行していません」の件数に入る。
 */

import type { BlockedReason, CheckRun, InputGapNote, UnusableInput } from '../kernel/input-state.js';
import { TARGET_ROLE_WORDS } from '../kernel/target-role.js';
import type { JobCheckSlot, NotApplicableJobSlot, UnfilledJobSlot } from '../job/target-checks.js';
import { H5_ID, H5_UNSEEN } from '../auth/platform-config.js';
import { mfaScopeWords } from '../model/auth/mfa.js';
import { concurrentWords } from '../model/auth/sessions.js';
import type { AuthConfigRun } from '../auth/platform-config.js';
import type { UnverifiedNote } from '../job/target-unverified.js';
import type { SpecKind } from '../model/product/uses.js';

/** 報告する検査 1 本(検査器 ID・要る種類・結果)。 */
export interface CheckRunSubject {
  readonly id: string;
  readonly kind: SpecKind;
  readonly run: CheckRun;
}

/** 名前を行に並べる件数の上限(超えたぶんは件数だけ言う)。 */
const NAMED_SUBJECTS_LIMIT = 5;

/** 報告の語。 */
export const CHECK_RUN_WORDS = { skipped: '未実施', blocked: '阻害', notApplicable: '対象外', unsupported: '未対応' } as const;

/** 阻害の理由の言い方(ハンドブックだけを出す入口の実行報告も同じ言い方をする)。 */
export const BLOCKED_REASON_TEXT: Readonly<Record<BlockedReason, string>> = {
  'not-loaded': '読み込みが行われていない',
  missing: '置き場に仕様が無い',
  'load-failed': '読めない・壊れている',
  invalid: '読めなかった仕様があってモデルが欠けている、または欠けていないと言えない',
};

/**
 * 進捗行が「入力の状態を報告する検査の未実施 / 阻害 / 未対応」の行か(`ID: 未実施 — …` / `ID: 阻害 — …` / `ID: 未対応 — …`)。
 * ID は検査 1 本(`T2`)のほか、群の検査の範囲(`T1〜T18`。群まるごと見ていないときの行)も取る。
 */
export function isCheckRunNote(line: string): boolean {
  return /^[A-Z]+\d+(〜[A-Z]*\d+)?: (未実施|阻害|未対応) — /.test(line);
}

/**
 * 未実施・阻害の検査を理由つきの 1 行にする。実行した検査は null。
 *
 * @param subject 検査器 ID・要る種類・結果
 * @returns 報告の 1 行(実行していれば null)
 */
export function describeCheckRun(subject: CheckRunSubject): string | null {
  const { id, kind, run } = subject;
  if (run.status === 'skipped') return describeInputGap(id, { input: kind, state: 'unselected' });
  if (run.status === 'blocked') return describeInputGap(id, { input: kind, state: 'blocked', reason: run.reason });
  return null;
}

/**
 * 検査が使えなかった入力のために見ていないこと(`InputGapNote`)を、理由つきの 1 行にする。
 * 書き方は `describeInputGap` の 1 本で、対象を名指せるときだけ文末に対象を足す(名前を並べる上限は `NAMED_SUBJECTS_LIMIT`)。
 *
 * @param id 検査器 ID
 * @param note 使えなかった入力と、見ていないこと
 */
export function describeInputGapNote(id: string, note: InputGapNote): string {
  const line = describeInputGap(id, note.gap, note.consequence);
  const subjects = note.subjects ?? [];
  if (subjects.length === 0) return line;
  const named = subjects.slice(0, NAMED_SUBJECTS_LIMIT).join('・');
  const rest = subjects.length - NAMED_SUBJECTS_LIMIT;
  const listed = rest > 0 ? `${named} ほか ${rest} 件` : named;
  return `${line.slice(0, -1)}(対象 ${subjects.length} 件: ${listed})。`;
}

/**
 * 検査が走査で**読めなかった場所**のために見ていないことを、理由つきの 1 行にする(阻害。入力の種類の阻害ではなく、ファイルシステムの読み取りの失敗)。
 * 読めなかった部分を、完全な走査の「指摘 0」と同じに見せないための行で、語は阻害と同じ(`ID: 阻害 — …`)なので範囲サマリの件数に入る。
 * 名前を並べる上限は `NAMED_SUBJECTS_LIMIT`。
 *
 * @param id 検査器 ID
 * @param paths 読めなかった場所(リポジトリルート相対。1 件以上)
 * @param consequence 見ていないこと(文末。句点は付けない)
 */
export function describeUnreadable(id: string, paths: readonly string[], consequence: string): string {
  const named = paths.slice(0, NAMED_SUBJECTS_LIMIT).join('・');
  const rest = paths.length - NAMED_SUBJECTS_LIMIT;
  return `${id}: ${CHECK_RUN_WORDS.blocked} — ${rest > 0 ? `${named} ほか ${rest} 件` : named} を読めなかったため、${consequence}。`;
}

/**
 * 後段が SQL の公開面(surface)を API として外へ出す能力を持たないために、依る検査・生成を行わないことを、理由つきの 1 行にする(**未対応**)。
 * 未実施(製品が採っていない)でも阻害(採ったのに読めない)でもない —— 仕様は読めているが、この構成の後段にその能力が無い。
 * 範囲サマリの件数には未実施・阻害と同じに数える(見ていないことに変わりはない)。
 *
 * @param id 検査器 ID または生成の名前(`T12` / `generate`)
 * @param reason 後段が宣言した理由(`PlatformProfile.surfaceExposure.reason`)
 * @param unseen 行っていないこと(文末。句点は付けない)
 */
export function describeSurfaceUnsupported(id: string, reason: string, unseen: string): string {
  return `${id}: ${CHECK_RUN_WORDS.unsupported} — この構成の後段は SQL の公開面(surface)を API として外へ出す能力を宣言していない(理由: ${reason})ため、${unseen}は行っていません。`;
}

/** 使えなかった入力に依る検査 1 本(検査器 ID と、その入力が使えないために見ていないこと。文末の句点は付けない)。 */
export interface GapDependent {
  readonly id: string;
  readonly consequence: string;
}

/**
 * 検査の入力が使えなかった(未選択・阻害)ことを 1 行にする(**未実施 / 阻害の行の書き方はこの 1 本**)。
 *
 * @param id 検査器 ID
 * @param gap 使えなかった入力
 * @param consequence 見ていないこと(文末。句点は付けない。省略は検査全体が止まった形 = A13)
 */
export function describeInputGap(id: string, gap: UnusableInput, consequence?: string): string {
  const because = consequence === undefined ? '' : `ため、${consequence}`;
  const word = gap.state === 'unselected' ? CHECK_RUN_WORDS.skipped : CHECK_RUN_WORDS.blocked;
  return `${id}: ${word} — ${describeUnusableInput(gap)}${because}。`;
}

/**
 * 使えなかった入力の事情(行の「— 」の後ろの前半。群ごとの要約行も同じ言い方をする)。
 *
 * @param gap 使えなかった入力(未選択 = 製品が採っていない / 阻害 = 採ったのに検査へ渡せない)
 */
export function describeUnusableInput(gap: UnusableInput): string {
  if (gap.state === 'unselected') return `製品が ${gap.input} を採っていない(product.md の uses に無い)`;
  return (
    `${gap.input} を採っているが検査へ渡せない(${BLOCKED_REASON_TEXT[gap.reason]}。` +
    '原因の error は各種類の読み込みの診断と P 群が出している)'
  );
}

/**
 * 関係の層の `gaps` を、それを読む検査ごとの行にする(欠けが無ければ空)。
 *
 * @param gaps 使えなかった入力(0 件 = 全部使えた)
 * @param dependents その値を読む検査(ID と、入力が使えないと見ていないこと)
 */
export function describeGapNotes(gaps: readonly UnusableInput[], dependents: readonly GapDependent[]): string[] {
  return dependents.flatMap((dependent) => gaps.map((gap) => describeInputGap(dependent.id, gap, dependent.consequence)));
}

/** 後段が無くても実行している部分の言い方(実装の木があるかで変わる)。無ければ空。 */
function stillRunsText(slot: JobCheckSlot, appGrounded: boolean): string {
  if (slot.stillRuns === undefined) return '';
  return `(${appGrounded ? slot.stillRuns.withApp : slot.stillRuns.specOnly})`;
}

/**
 * 置き場の配置に役割が無いので、その役割を読む検査が見ていないこと(未実施)を、理由つきの 1 行にする。**そのスタックにしか無い概念の役割**(下限 0 の役割。
 * `layout.ts` の `LAYOUT_ROLE_MIN`)を配置が宣言していないとき、検査は黙って緑にならず、この行で範囲が縮んだことを言う。語は未実施と同じ(`ID: 未実施 — …`)で、
 * 同じ件数に数える。入力の状態の新しい種類ではない(入力は読めている。配置が見る相手を決めていない)。
 *
 * @param id 検査器 ID
 * @param role 配置に無い役割(人が読む名前。例: `request-gate(リクエスト前段)`)
 * @param unseen 見ていないこと(文末。句点は付けない)
 */
export function describeMissingRole(id: string, role: string, unseen: string): string {
  return `${id}: ${CHECK_RUN_WORDS.skipped} — 置き場の配置に ${role} が無いため、${unseen}は見ていません。`;
}

/**
 * 後段が受け持つ検査の口が埋まっていない(未実施)ことを、事実どおりの理由つきの 1 行にする。**理由は 2 つに分ける**:
 *   - その役割の後段が選ばれていない → 「(役割)の後段がこの構成に無い」
 *   - 選ばれているが、この口の検査を登録していない → 「(役割)の後段 <名前> がこの検査を登録していない」
 * 後段の名前は選ばれているときだけ書く(コアは名前を知らず、選んだ後段の値が運んでくる)。後段が無くても実行している部分があれば、それも言う。
 *
 * @param slot 埋まっていない口(ルール ID・役割・見ていないこと・選ばれている同じ役割の後段の名前)
 * @param appGrounded 実装の木があるか(無ければ、実装に依る部分は実行していないので「実行済み」と言わない)
 */
export function describeMissingTarget(slot: UnfilledJobSlot, appGrounded: boolean): string {
  const role = TARGET_ROLE_WORDS[slot.role];
  const because = slot.selectedTarget === undefined ? `${role}の後段がこの構成に無い` : `${role}の後段 ${slot.selectedTarget} がこの検査を登録していない`;
  return `${slot.id}: ${CHECK_RUN_WORDS.skipped} — ${because}ため、${slot.unseen}は見ていません${stillRunsText(slot, appGrounded)}。`;
}

/**
 * 後段が理由つきで「この後段では対象外」と宣言した口を、未実施とは別の語(対象外)の 1 行にする。**未実施ではない**(見る必要が無いという
 * 後段の申告であり、見ていないことではない)ので、範囲サマリの「実行していません」の件数に入らない(行の頭の語が `isCheckRunNote` に当たらない)。
 *
 * @param slot 対象外の口(ルール ID・役割・見ないこと・宣言した後段の名前と理由)
 * @param appGrounded 実装の木があるか(`describeMissingTarget` と同じ)
 */
export function describeNotApplicableTarget(slot: NotApplicableJobSlot, appGrounded: boolean): string {
  const role = TARGET_ROLE_WORDS[slot.role];
  return `${slot.id}: ${CHECK_RUN_WORDS.notApplicable} — ${role}の後段 ${slot.target} は、${slot.unseen}を対象外と宣言しています(理由: ${slot.reason})${stillRunsText(slot, appGrounded)}。`;
}

/**
 * J 群の見出しに足す、範囲の但し書き(口が埋まっていない分を除いた事実にするため)。後段が無くても一部は実行する口は「<ID> は<言い方>のみ」、
 * 実行しない口は「<ID> は下の未実施」、後段が対象外と宣言した口は「<ID> は下の対象外」と言う。何も縮んでいなければ空。
 *
 * @param missing 未実施の口
 * @param notApplicable 対象外の口
 */
export function describeJobScopeNotes(missing: readonly UnfilledJobSlot[], notApplicable: readonly NotApplicableJobSlot[]): string {
  const slots = [...missing, ...notApplicable];
  const partial = slots.flatMap((slot) => (slot.stillRuns === undefined ? [] : [`${slot.id} は${slot.stillRuns.label}のみ`]));
  const parts = [
    ...partial,
    ...idList(missing.filter((slot) => slot.stillRuns === undefined), '下の未実施'),
    ...idList(notApplicable.filter((slot) => slot.stillRuns === undefined), '下の対象外'),
  ];
  return parts.length === 0 ? '' : `(${parts.join('。')})`;
}

/** 口の ID を「J3 / J4 は<言い方>」にする(空なら何も返さない)。 */
function idList(slots: readonly JobCheckSlot[], words: string): string[] {
  return slots.length === 0 ? [] : [`${slots.map((slot) => slot.id).join(' / ')} は${words}`];
}

/**
 * H5(サインインの方式と公開スキーマの突合)が**見ていないこと**を、未実施の行にする(`H5: 未実施 — …`。範囲が縮んだ報告として数える)。
 * 事実どおりに書き分ける: 後段が登録していない / 設定ファイルが無い / 認証フロー仕様が無い・読めない / 読めたが設定が認証やデータ API を動かさないので飛ばした部分。
 * 加えて、ローカル専用の方式(`local_only`)を宣言していれば、**検査の結果によらず毎回**「本番の設定は未検証」を名指す(本番の管理画面の設定は、この検査では見えない)。
 * セッションの寿命(`sessions`)も同じく、読めた宣言があれば毎回「本番のセッションの寿命は未検証」を名指す。多要素認証を要求するなら
 * 「本番の多要素認証の要素は未検証」も名指す。
 *
 * @param run H5 の実行の状態
 * @returns 行(何も言うことが無ければ空)
 */
export function describeAuthConfigRun(run: AuthConfigRun): string[] {
  const note = (because: string): string => `${H5_ID}: ${CHECK_RUN_WORDS.skipped} — ${because}`;
  if (run.state === 'no_declaration') {
    return [note(`認証フロー仕様${run.cause === 'absent' ? 'が無い' : 'を読めない'}ため、${H5_UNSEEN}は見ていません。`)];
  }
  const lines =
    run.state === 'unregistered'
      ? [note(`${TARGET_ROLE_WORDS.platform}の後段がこの検査を登録していないため、${H5_UNSEEN}は見ていません。`)]
      : run.state === 'absent'
        ? [note(`${run.file} が無い(または読めない)ため、${H5_UNSEEN}は見ていません。`)]
        : run.skipped.map((reason) => note(`${reason}。`));
  const entries = run.localOnly.map((entry) => `${entry.method} — ${entry.reason}`).join('、');
  const localOnly = run.localOnly.length === 0 ? [] : [note(`本番の設定は未検証です(local_only: ${entries})。本番の管理画面で閉じていることを確かめてください。`)];
  const sessions =
    run.sessions === undefined
      ? []
      : [note(`本番のセッションの寿命は未検証です(sessions: 無操作の時間切れ ${run.sessions.inactivity}・絶対の寿命 ${run.sessions.absolute}・同時セッション ${concurrentWords(run.sessions.concurrent)})。本番のプランでこの設定が使えるか(プラットフォームによっては上位のプランだけの機能)も確かめていません。本番の管理画面で同じ値になっていて、設定が効くプランであることを確かめてください。`)];
  const mfa =
    run.mfa?.kind === 'require'
      ? [note(`本番の多要素認証の要素は未検証です(mfa: 要求する範囲は${mfaScopeWords(run.mfa.scope)})。本番の管理画面で要素(登録と確認)が有効になっていることを確かめてください。`)]
      : [];
  return [...lines, ...localOnly, ...sessions, ...mfa];
}

/**
 * 後段が名指す未検証(本番の設定など、仕様から見えないもの)を、未実施の行にする(`R5: 未実施 — …`。H5 が本番の設定を名指すのと同じ語で、範囲サマリの件数に入る。
 * error でも warning でもない)。
 *
 * @param id 名指す検査器の ID(`R5`)
 * @param note 後段が名指した 1 件
 */
export function describeTargetUnverified(id: string, note: UnverifiedNote): string {
  return `${id}: ${CHECK_RUN_WORDS.skipped} — ${TARGET_ROLE_WORDS[note.role]}の後段 ${note.target} の範囲: ${note.text}。`;
}
