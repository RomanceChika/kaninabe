/**
 * ハンドブックだけを出す入口(`cli/generate-book.ts`)の**実行報告**: 何を実行し、何を実行せず、何を検査していないか。
 *
 * 部分利用の入口が「全部確認済み」に見えてはならない(設計メモ framework-modules §6 の「未検査の範囲を出す」)。
 * 検証の実行ログと同じ語・同じ形(`ID: 未実施 — 理由`)で、**範囲が縮んだものだけを名指しで**出す:
 *
 *   - **入力の状態**(`planEntryInputs`)… 製品が採った種類のうち、章の材料に使えなかったもの。
 *     **未実施** = 採っていない(章は出さない。置き場に仕様が残っていても読まない。事実として無い)/ **阻害** = 採ったのに渡せない(置き場に無い・読めない・
 *     仕様を落とした。持ち主の章は生成していない)。**読めたが 0 件の種類は実行**であり、行を出さない
 *     (「材料の種類が無い」と「採ったのに無い」を同じ見え方にしない)
 *   - **未実施**(この入口が回さないと決めているもの)… 変異の目録(変異の検出器が DDL・RLS・RPC 本文の生成器を呼ぶので読み込まない)
 *   - **未検査** … 実行していない検査(検証の警告・生成した SQL との突合)。章の側は「未集計」と言う
 *     (`ctx.findings` が無いとき章は「検証の結果が渡されていない」と書く。0 件とは別の状態)
 *   - **古い章が残っている** … 止めた章(阻害・未選択。この実行では回さない章)のファイルが出力先に前回の生成で残っているもの。黙って残さず名指しする
 *
 * **採っていない種類の行は出さない**: 「DB への接地: 未検査」は、DB に接地する種類(`data_tables` / `api`)を採る製品にだけ出す。
 * DB の宣言が無い製品には、接地する先が無い(採っていないものは事実として無い。空振りの行を読ませない)。「変異の目録: 未実施」も同じ基準で、
 * 目録を出す節を持つ種類(保証台帳・テーブル仕様)のどちらかを採る製品にだけ出す。
 * **阻害した種類を読んでいる章**(止めなかった章)は、章の冒頭にも名指す(`book-entry-notice.ts`)。この報告はそのうち何章かを数える。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない**。
 */

import { usesKind, type ProductUses, type SpecKind } from '../model/product/uses.js';
import { BLOCKED_REASON_TEXT } from '../verify/check-run-report.js';
import { DOMAIN_INPUT_DEPENDENTS } from '../verify/domain-input-notes.js';
import type { EntryInputPlan } from './book-entry-plan.js';
import type { ReaderNotice } from './book-entry-notice.js';
import { MUTATION_TITLE } from './render/book/mutation-section.js';
import { RESULT_SECTION, TABLE_SECTION, VISIBILITY_SECTIONS } from './render/book/sections.js';

/** 阻害した種類の行に章の名前を挙げる上限。 */
const NOTICED_LIMIT = 4;

/** 報告の語(検証の実行ログ `lib/verify/check-run-report.ts` と同じ綴り)。 */
const WORDS = { notRun: '未実施', unchecked: '未検査', blocked: '阻害' } as const;

/** 実行報告の材料(入口が実行して分かったこと)。 */
export interface BookEntryRun {
  /** 書いた(書くはずだった)ファイル(リポジトリルート相対)。 */
  readonly files: readonly string[];
  /** 何も出さなかった生成器の ID(宣言順)。 */
  readonly emptyGenerators: readonly string[];
  /** 製品が採ると宣言した種類(`product.md` の `uses`)。 */
  readonly uses: ProductUses;
  /** 入力の状態から決めた実行の計画。 */
  readonly plan: EntryInputPlan;
  /** 止めた章のうち、出力先に前回の生成で残っているファイル(リポジトリルート相対)。 */
  readonly stale: readonly string[];
  /** 標識が章に出ていない仕様ファイルのうち、阻害した種類のもの(その結果。リポジトリルート相対。採っていない種類の仕様は読まないので来ない)。 */
  readonly unplaced: readonly string[];
  /** 止めなかった章の冒頭に足した、阻害した種類を読んでいることの注記(`readerNotices`)。 */
  readonly notices: readonly ReaderNotice[];
}

/** 実行報告(章・部品の一覧と、範囲が縮んだものの行)。 */
export interface BookEntryReport {
  /** 書いた(書くはずだった)ファイル(リポジトリルート相対。昇順)。 */
  readonly files: readonly string[];
  /** 何も出さなかった生成器の ID(宣言順)。採っていない種類の章は出力から落とす(生成器は章ごとに分かれていない)ので、ここには入らない(入力の状態の行が言う)。 */
  readonly emptyGenerators: readonly string[];
  /** 入力の状態の行(採っていない = 未実施 / 採ったのに使えない = 阻害)。 */
  readonly inputNotes: readonly string[];
  /** 範囲が縮んだものの行(`名前: 未実施 — 理由` / `名前: 未検査 — 理由`)。DB への接地の行だけが製品の `uses` に依る。 */
  readonly notes: readonly string[];
  /** 出力先に残っている、この実行では生成していない章(昇順)。 */
  readonly stale: readonly string[];
  /** 標識が章に出ていない仕様ファイル(阻害した種類のもの。昇順)。 */
  readonly unplaced: readonly string[];
}

/** DB に接地する種類(どれかを採る製品にだけ、DB への接地の行を出す)。 */
const DB_KINDS: readonly SpecKind[] = ['data_tables', 'surface'];

/**
 * 変異の目録を出す節を持つ種類。変異の目録の節は保証台帳の章(`guarantees.md`)にだけあるので、保証台帳を採る製品にだけ、変異の目録の行を出す
 * (テーブル仕様だけを採る製品には、目録を出す節が無い = 「未実施」と言う相手が無い)。
 */
const MUTATION_KINDS: readonly SpecKind[] = ['guarantees'];

/** 実行した V 群のうち、action_spec / data_table を渡さずに回すので完走していない検査の ID(`DOMAIN_INPUT_DEPENDENTS` が正)。 */
const UNFINISHED_V_IDS = [...new Set(DOMAIN_INPUT_DEPENDENTS.map((dependent) => dependent.id))].join('・');

/** 変異の目録の行(目録を出す節を持つ種類を採る製品にだけ出す)。 */
const MUTATION_NOTE = `変異の目録: ${WORDS.notRun} — この入口では変異を回さない(保証台帳を採る製品では、フルの generate が保証の章の「${MUTATION_TITLE}」に出す節。変異の検出器は DDL・RLS・RPC 本文の生成器を呼ぶので読み込んでいない)`;

/** 範囲が縮んだものの行のうち、製品の宣言に依らないもの(検証の警告)。 */
const ALWAYS_NOTES: readonly string[] = [
  `検証の警告: ${WORDS.unchecked} — 実行したのは、生成を止める error の判定(V 群から到達性 V21 を除いたもの。generate が生成の前に回すのと同じ判定器)だけで、` +
    `それも action_spec と data_table を渡さずに回すため(読み込みが行われていない = 阻害として渡す)、それらに依る ${UNFINISHED_V_IDS} の判定は完走していない。` +
    '実行していないのは、warning を出す検査の全体(各種類の読み込みの診断 = 0 番の検査・他の種類の検査・種類どうしの関係・実装の木との接地)と V21(到達性)(各章の「受け入れ」のうち、まだ通していない分は「未集計」。手引きの「仕組みの拡張候補」の節は出さない)',
];

/** DB への接地の行(DB に接地する種類を採る製品にだけ出す)。 */
const DB_NOTE =
  `DB への接地: ${WORDS.unchecked} — DB の層(DDL・RLS・RPC 本文・GRANT の生成)を読み込んでいない(テーブル仕様と生成した migration の突合 = T 群と data-table-parity は見ていない。DB に関わる節 = データの章の「${TABLE_SECTION}」・可視性の章の「${VISIBILITY_SECTIONS.surface}」と索引の表・「${RESULT_SECTION}」の元データは、仕様の宣言から導いた分だけを出す)`;

/** 章の冒頭に名指した章の言い方(多いときは先頭だけ挙げて数を添える)。 */
function noticedWords(notices: readonly ReaderNotice[]): string {
  if (notices.length === 0) return '止めていない章でこの種類を読むものは無い';
  const files = notices.map((notice) => notice.file);
  const named = files.slice(0, NOTICED_LIMIT).join(' / ');
  const rest = files.length - NOTICED_LIMIT;
  return `この種類を読む章の冒頭に、どの節が読めた分だけかを名指した(${files.length} 章: ${rest > 0 ? `${named} ほか ${rest} 章` : named})`;
}

/** 阻害した種類の行(持ち主の章を止めたこと・止めていない章が読む分は読めた分だけであることを言う)。 */
function blockedNote(blocked: EntryInputPlan['blocked'][number], notices: readonly ReaderNotice[]): string {
  const chapters =
    blocked.stopped.length === 0
      ? 'この種類だけを材料にする章は無い'
      : `この種類を材料にする章は生成していない: ${blocked.stopped.join(' / ')}`;
  return (
    `${blocked.kind}: ${WORDS.blocked} — ${blocked.kind} を採っているが章の材料へ渡せない(${BLOCKED_REASON_TEXT[blocked.reason]}。原因の診断は各種類の読み込みの 0 番の検査 = npm run verify が出す)。` +
    `${chapters}。止めていない章がこの種類を読む箇所は、読めた分だけ(読めなければ無い前提)で出ている: ${noticedWords(notices.filter((notice) => notice.kind === blocked.kind))}`
  );
}

/**
 * 実行報告を作る。
 *
 * @param run 入口が実行して分かったこと(書いたファイル・何も出さなかった生成器・`uses`・入力の状態の計画・残っていた古い章)
 * @returns 実行報告
 */
export function bookEntryReport(run: BookEntryRun): BookEntryReport {
  const grounded = DB_KINDS.some((kind) => usesKind(run.uses, kind));
  const mutated = MUTATION_KINDS.some((kind) => usesKind(run.uses, kind));
  const inputNotes = [
    ...run.plan.blocked.map((blocked) => blockedNote(blocked, run.notices)),
    ...run.plan.unselected.map(
      (entry) =>
        `${entry.kind}: ${WORDS.notRun} — 製品が ${entry.kind} を採っていない(product.md の uses に無い)ので、章 ${entry.chapter} は出さない` +
        `(置き場に仕様が残っていても読まない。他の章の材料にも混ぜない)`,
    ),
  ];
  return {
    files: [...run.files].sort(),
    emptyGenerators: run.emptyGenerators,
    inputNotes,
    notes: [...(mutated ? [MUTATION_NOTE] : []), ...ALWAYS_NOTES, ...(grounded ? [DB_NOTE] : [])],
    stale: [...run.stale].sort(),
    unplaced: [...run.unplaced].sort(),
  };
}

/**
 * 実行報告を、標準出力に出す行にする。
 *
 * @param report 実行報告
 * @returns 出力の行(実行した章 → 出さなかった生成器 → 入力の状態 → 範囲が縮んだもの)
 */
export function formatBookEntryReport(report: BookEntryReport): readonly string[] {
  return [
    `実行した章と部品: ${report.files.length} ファイル`,
    ...report.files.map((file) => `  ${file}`),
    report.emptyGenerators.length === 0
      ? '何も出さなかった生成器: なし'
      : `何も出さなかった生成器(実行したが、出す材料が無かった): ${report.emptyGenerators.join(' / ')}`,
    report.inputNotes.length === 0
      ? '入力の状態: 阻害なし(採った種類はすべて読めた。読めて 0 件の種類は実行している。採っていない種類の章は元から出さない)'
      : `入力の状態: 章を出さなかった種類 ${report.inputNotes.length} 件(採っていない = ${WORDS.notRun} / 採ったのに使えない = ${WORDS.blocked})`,
    ...report.inputNotes.map((note) => `  ${note}`),
    ...(report.unplaced.length === 0
      ? []
      : [`  標識が章に出ていない仕様ファイル(阻害した種類のもの。章を止めたか、モデルに入っていないので引用できない): ${report.unplaced.join(' / ')}`]),
    `この入口で範囲が縮んだもの: ${report.notes.length} 件(以外は全部入りの generate と同じ生成器が同じ文脈で出す)`,
    ...report.notes.map((note) => `  ${note}`),
  ];
}

/**
 * 古い章が残っていることを言う行(残っていなければ空)。標準エラーに出し、終了コードを 0 にしない(自動では消さない)。
 *
 * @param report 実行報告
 */
export function formatStaleChapters(report: BookEntryReport): readonly string[] {
  if (report.stale.length === 0) return [];
  return [
    `古い章が残っている(この実行では生成していない): ${report.stale.join(' / ')}`,
    '  対処: 前回の生成の章です(今回の材料とは食い違っている)。不要なら削除するか、材料の種類を直してからやり直す(この入口は自動では消さない)',
  ];
}
