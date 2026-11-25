/**
 * ハンドブックだけを出す入口(`cli/generate-book.ts`)の**実行の計画**: 入力の状態から「どの章を止めるか」、
 * 引数から「どこへ書くか」を決める(純関数。ファイルは読まない・書かない)。
 *
 * **入力の状態を 3 つに分けて扱う**(`kernel/input-state.ts` の基準。「未選択 = 事実として無い / 阻害 = 採ったのに無い・壊れている・
 * 仕様を落とした / 読込済み = 0 件の空も含めて実行」)。生成器へ渡すモデルの投影は全部入りの `generate` と同じ 1 本で、
 * この入口がそれと別に持つのは次の 2 つだけである。
 *
 *   - **阻害した種類・採っていない種類を材料にする章は書かない**(`CHAPTER_OWNERS`。本は HTML を 1 本の生成器が全章まとめて出すので、「章を止める」とは**その章のファイルを入口の出力から落とす**こと = `withoutStoppedChapters`)。章の持ち主は種類 1 本に決まるものだけを
 *     宣言する(jobs の章は jobs が持ち主)。**複数の種類を読む章(索引・集約の章・可視性の章・結果表など)は持ち主を宣言せず、止めない** —
 *     無関係な章を一律に止めない代わりに、止めなかった章がその種類を読む箇所は読めた分だけ(読めなければ無い前提)で出ていることを
 *     報告に書く(`book-entry-report.ts`)。持ち主の表が実際の出力と一致することは `book-entry-plan.test.ts` が見る。
 *     **採っていない種類の仕様が置き場に残っていても、章は生成せず、種類横断の章の材料にも混ぜない**(入口の投影が採った種類だけを
 *     読む = `readEntryInputs`・仕様の生テキストも採っていない種類の置き場は読まない = `unreadPlaces`。未選択は事実として無い)
 *   - **止めた章のファイルが出力先に前回の生成で残っていれば、残っていることを名指しする**(古い章は黙って残さない。
 *     「今回は生成しない」から決める = 生成器が何を返したかには依らない)
 *
 * **書き先は別の部品**(`book-entry-destination.ts`: `--out` の取り出し・書き先の決定・置き場の木の別名の検査)。ここは「どの章を止めるか」だけを持つ。
 *
 * **アプリの語彙は 1 語も持たない**(章の名前と種類は仕組みが決める形)。
 */

import type { BlockedReason } from '../kernel/input-state.js';
import type { ProductRoots } from '../model/product/types.js';
import { specPath } from '../model/product/paths.js';
import { SPEC_KIND_PLACEMENTS, type SpecKind } from '../model/product/uses.js';
import type { KindInput } from './generate-inputs.js';
import type { FileSection } from './apply-sections.js';
import { bookFile } from './render/book/chapters.js';
import { searchIndexWithout } from './render/book/html/search-index.js';
import { isUnderPlace } from './spec-sources.js';

/** 章の持ち主 1 件(その章の材料になる種類・章のファイル名)。 */
export interface ChapterOwner {
  /** その章が材料にする種類(章の中身を決める種類 1 本)。 */
  readonly kind: SpecKind;
  /** 章のファイル名(ハンドブックの根の中。HTML の章)。 */
  readonly chapter: string;
}

/** 種類 1 本が持ち主の章(複数の種類を読む章はここに載せない)。 */
export const CHAPTER_OWNERS: readonly ChapterOwner[] = [
  { kind: 'usecases', chapter: 'usecases.html' },
  { kind: 'screens', chapter: 'screens.html' },
  { kind: 'actions', chapter: 'actions.html' },
  { kind: 'notifications', chapter: 'notifications.html' },
  { kind: 'jobs', chapter: 'jobs.html' },
  { kind: 'config', chapter: 'config.html' },
  { kind: 'auth', chapter: 'auth.html' },
  { kind: 'guarantees', chapter: 'guarantees.html' },
  { kind: 'external', chapter: 'external.html' },
  { kind: 'design_tokens', chapter: 'design.html' },
  { kind: 'ux_principles', chapter: 'ux-principles.html' },
  { kind: 'data_tables', chapter: 'data.html' },
];

/** 採ったのに章の材料へ渡せなかった種類(阻害)。 */
export interface BlockedKind {
  readonly kind: SpecKind;
  readonly reason: BlockedReason;
  /** 材料にできなかったので生成しなかった章(リポジトリルート相対。持ち主の章が無い種類は空)。 */
  readonly stopped: readonly string[];
}

/** 採っていない種類(未選択)の持ち主の章。 */
export interface UnselectedKind {
  readonly kind: SpecKind;
  /** 章のファイル(リポジトリルート相対)。 */
  readonly chapter: string;
}

/** 入力の状態から決めた、入口の実行の計画。 */
export interface EntryInputPlan {
  /** 阻害した種類(`SPEC_KINDS` の順)。 */
  readonly blocked: readonly BlockedKind[];
  /** 採っていない種類のうち、持ち主の章があるもの。 */
  readonly unselected: readonly UnselectedKind[];
  /** 採っていない種類(持ち主の章が無いものも含む。`SPEC_KINDS` の順)。 */
  readonly notAdopted: readonly SpecKind[];
  /** 書かない章(ハンドブックの根の中のファイル名。阻害した種類・採っていない種類が持ち主の章)。 */
  readonly stoppedChapters: readonly string[];
}

/**
 * 入力の状態から、実行の計画を作る。読込済み(0 件の空のカタログを含む)の種類は計画に載せない(そのまま実行する)。
 *
 * @param inputs 全種類の入力の状態(`inputStatesOf`)
 * @param roots 製品が宣言した根(章のファイルのパスを組み立てる)
 */
export function planEntryInputs(inputs: readonly KindInput[], roots: ProductRoots): EntryInputPlan {
  const blocked: BlockedKind[] = [];
  const unselected: UnselectedKind[] = [];
  const notAdopted: SpecKind[] = [];
  for (const { kind, input } of inputs) {
    const owners = CHAPTER_OWNERS.filter((owner) => owner.kind === kind);
    if (input.state === 'blocked') {
      blocked.push({ kind, reason: input.reason, stopped: owners.map((owner) => bookFile(roots, owner.chapter)) });
    } else if (input.state === 'unselected') {
      notAdopted.push(kind);
      for (const owner of owners) unselected.push({ kind, chapter: bookFile(roots, owner.chapter) });
    }
  }
  const stopped = new Set(
    CHAPTER_OWNERS.filter((owner) => blocked.some(({ kind }) => kind === owner.kind) || unselected.some(({ kind }) => kind === owner.kind)).map((owner) => owner.chapter),
  );
  return { blocked, unselected, notAdopted, stoppedChapters: [...stopped] };
}

/**
 * 生成した出力から、止めた章(阻害した種類・採っていない種類が持ち主の章)のファイルを落とす(出力の順は保つ)。
 * 検索の索引(`assets/search.json`)は止めた章の節も含んで出ているので、止めた章の件も落とす(書かない章へ繋がる検索の件を残さない)。
 *
 * @param byFile ファイル(リポジトリルート相対)→ 生成セクション
 * @param plan 実行の計画
 * @param roots 製品が宣言した根
 */
export function withoutStoppedChapters(
  byFile: ReadonlyMap<string, readonly FileSection[]>,
  plan: EntryInputPlan,
  roots: ProductRoots,
): ReadonlyMap<string, readonly FileSection[]> {
  const stopped = new Set(plan.stoppedChapters.map((chapter) => bookFile(roots, chapter)));
  const searchFile = bookFile(roots, 'assets/search.json');
  const pages = new Set(plan.stoppedChapters);
  const result = new Map<string, readonly FileSection[]>();
  for (const [file, sections] of byFile) {
    if (stopped.has(file)) continue;
    result.set(file, file === searchFile ? sections.map((section) => (section.wholeFile === true ? { ...section, content: searchIndexWithout(section.content, pages) } : section)) : sections);
  }
  return result;
}

/**
 * 出力先に前回の生成の章が残っているもの(この実行では生成していない章)。
 *
 * 阻害した種類の章と、採っていない種類の章の両方が対象である(どちらも「この実行では回さない」から決める。
 * 回した生成器が何を返したかには依らない)。
 *
 * @param plan 実行の計画
 * @param exists 出力先にそのファイルがあるか(リポジトリルート相対のパス)
 * @returns 残っているファイル(昇順・重複なし)
 */
export function staleChapters(plan: EntryInputPlan, exists: (file: string) => boolean): readonly string[] {
  const notGenerated = [...plan.blocked.flatMap((blocked) => blocked.stopped), ...plan.unselected.map((entry) => entry.chapter)];
  return [...new Set(notGenerated.filter(exists))].sort();
}

/**
 * 仕様の置き場(リポジトリルート相対)を、種類のものにして返す(種類の置き場の候補が複数あれば全部)。
 *
 * @param kinds 種類
 * @param roots 製品が宣言した根
 */
function placesOf(kinds: readonly SpecKind[], roots: ProductRoots): readonly string[] {
  return kinds.flatMap((kind) => SPEC_KIND_PLACEMENTS[kind].paths.map((place) => specPath(roots, place)));
}

/**
 * 仕様の生テキストを読まない置き場 = 採っていない種類の置き場(リポジトリルート相対)。
 *
 * 採っていない種類の仕様は、置き場に有効なものが残っていても材料にしない(章を出さず、種類横断の章の標識の集計にも混ぜない)。
 * `completeGenerateContext` の `excludedPlaces` へ渡す(入力を読む側 `readEntryInputs` が採った種類だけを読むのと同じ線引き)。
 *
 * @param plan 実行の計画
 * @param roots 製品が宣言した根
 */
export function unreadPlaces(plan: EntryInputPlan, roots: ProductRoots): readonly string[] {
  return placesOf(plan.notAdopted, roots);
}

/**
 * 標識の置き場の問題を、「阻害した種類の仕様ファイルのもの」と「それ以外」に分ける。
 *
 * 阻害した種類の仕様は、モデルへ入っていない(章が引用できない)か、持ち主の章を止めている。その標識が章に出ていないのは**阻害の結果**
 * であって別の誤りではないので、生成を止めるエラーにせず、報告に名指す(ファイルがその種類の置き場の下にあるかで決める)。
 * それ以外(読めた種類・どの種類の置き場でもないファイル)の問題は、従来どおり生成を止める。**採っていない種類の仕様は、そもそも
 * 生テキストを読まない**(`unreadPlaces`)ので、ここへは来ない。
 *
 * @param problems 標識の置き場の問題(`file` = 仕様ファイル。リポジトリルート相対)
 * @param plan 実行の計画
 * @param roots 製品が宣言した根
 */
export function partitionPlacementProblems<T extends { readonly file: string }>(
  problems: readonly T[],
  plan: EntryInputPlan,
  roots: ProductRoots,
): { readonly hard: readonly T[]; readonly ofBlocked: readonly T[] } {
  const places = placesOf(
    plan.blocked.map(({ kind }) => kind),
    roots,
  );
  return {
    hard: problems.filter((problem) => !isUnderPlace(problem.file, places)),
    ofBlocked: problems.filter((problem) => isUnderPlace(problem.file, places)),
  };
}
