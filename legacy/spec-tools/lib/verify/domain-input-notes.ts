/**
 * ドメイン仕様の検査(V 群)が読む他の種類の入力が使えなかったことの報告(V16・V17・V18・V19)。
 *
 * V 群は `VerifyContext` で他の種類を 2 つ受け取る —— action_spec(`actions`)と data_table(`dataTables`)。
 * 以前はどちらも任意の欄で、欄が無い・読めないのどちらでも**何も言わずに通った**。今は入力の状態(未選択 / 阻害 /
 * 読込済み)で持ち、使えない入力に依る判定は出さず(使えない入力から「現れる / 無い」を導くと、見ていないものを見たと
 * 報告する)、見ていないことを A13 / T2 / S13 と同じ形の行で言う(`check-run-report.ts` の `describeInputGap`)。
 * **読み込みの error は各種類のローダーの 0 番(A0 / T0)が 1 回だけ出す**ので、ここは進捗の行であって Finding ではない。
 *
 * **未選択の扱いは依存ごとに違う。**
 *   - `actions` が未選択なら、入力に現れる欄も計算値も**事実として無い**(action_spec の `input` / `computes` が母集合で、
 *     採っていなければ母集合は空)。V16 / V17 の (a) / V18 は空の母集合で判定を済ませており、**未実施の行は出さない**。
 *   - `data_tables` が未選択なら、`supplied_by: db` の宣言に機構があるか・遷移 RPC に値の口があるかの**裏づけを見る先が無い**。
 *     母集合が空なのではなく見られないので、どちらも行を出す。
 *   - どちらも**阻害**なら「分からない」なので、依る判定を出さず行を出す。
 *
 * 画面の到達の報告(`reachability-notes.ts`)と同じ形(入力の状態を決める口と、読む検査の一覧を 1 か所に置く)。
 */

import { unusableOf, type UnusableInput } from '../kernel/input-state.js';
import type { VerifyContext } from '../check-api/contract.js';
import { describeInputGap } from './check-run-report.js';
import type { ProgressLog } from './group-contract.js';

/** V 群の検査が読む、他の種類の入力の名前(`product.md` の `uses` の語)。 */
type DomainInputName = 'actions' | 'data_tables';

/** 使えなかった入力に依る V 群の検査 1 本。 */
export interface DomainInputDependent {
  /** 検査器 ID。 */
  readonly id: string;
  /** 依る入力。 */
  readonly input: DomainInputName;
  /** その入力が使えないために見ていないこと(文末。句点は付けない)。 */
  readonly consequence: string;
  /**
   * 入力が**未選択**のときの扱い。`fact` = 採っていなければ母集合が空で、それが事実(行を出さない)。
   * `report` = 採っていないと裏づけを見る先が無い(行を出す)。
   */
  readonly onUnselected: 'fact' | 'report';
}

/** V 群のうち、他の種類の入力に依る検査(ID 順。同じ検査が 2 つの入力に依るときは入力ごとに 1 本)。 */
export const DOMAIN_INPUT_DEPENDENTS: readonly DomainInputDependent[] = [
  { id: 'V16', input: 'actions', onUnselected: 'fact', consequence: '入力に現れる enum に labels があるかは見ていません' },
  {
    id: 'V17',
    input: 'actions',
    onUnselected: 'fact',
    consequence: 'supplied_by: db の欄が action_spec の input に現れないことは見ていません',
  },
  {
    id: 'V17',
    input: 'data_tables',
    onUnselected: 'report',
    consequence: 'supplied_by: db の欄に機構(defaults / triggers)があること・作成 RPC に渡す口が無いことは見ていません',
  },
  {
    id: 'V18',
    input: 'actions',
    onUnselected: 'fact',
    consequence: 'computes の接地(欄の実在・入力に無いこと・書いてよい欄・例の表)と作成の owner の接地は見ていません',
  },
  {
    id: 'V19',
    input: 'data_tables',
    onUnselected: 'report',
    consequence: 'records_actor の値の口(遷移 RPC の引数)があるかは見ていません',
  },
];

/**
 * V 群の入力のうち、使えなかったもの(読込済みなら含めない)。
 *
 * @param ctx V 群の共有サービスと入力の状態
 */
export function domainInputGapsOf(ctx: Pick<VerifyContext, 'actions' | 'dataTables'>): readonly UnusableInput[] {
  return [unusableOf(ctx.actions, 'actions'), unusableOf(ctx.dataTables, 'data_tables')].filter(
    (gap): gap is UnusableInput => gap !== null,
  );
}

/**
 * 使えなかった入力を、読む検査ごとの行にする(使えるなら・未選択が事実なら出さない)。
 *
 * @param ctx V 群の共有サービスと入力の状態
 */
export function describeDomainInputNotes(ctx: Pick<VerifyContext, 'actions' | 'dataTables'>): string[] {
  const gaps = domainInputGapsOf(ctx);
  return DOMAIN_INPUT_DEPENDENTS.flatMap((dependent) =>
    gaps
      .filter((gap) => gap.input === dependent.input)
      .filter((gap) => gap.state === 'blocked' || dependent.onUnselected === 'report')
      .map((gap) => describeInputGap(dependent.id, gap, dependent.consequence)),
  );
}

/**
 * 使えなかった入力を実行ログへ残す(使えるなら何も言わない)。
 *
 * @param ctx V 群の共有サービスと入力の状態
 * @param log 実行ログ
 */
export function logDomainInputGaps(ctx: Pick<VerifyContext, 'actions' | 'dataTables'>, log: ProgressLog): void {
  for (const note of describeDomainInputNotes(ctx)) log(note);
}
