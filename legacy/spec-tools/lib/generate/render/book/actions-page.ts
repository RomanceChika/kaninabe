/**
 * 「誰が何を実行できるか(操作)」の章(docs/book/actions.html)の生成器。
 *
 * Server Action は個別の action_spec を 1 本ずつ開かないと「操作が何本あり、誰が何を実行できるか」の全体像が見えない
 * (query と screen には一覧があるのに、書き込みの入口だけが横断で読めない状態だった)。集約ごとに節を切り、
 * 「何をするか・誰が実行できるか・入力・起きること・テスト」を 1 行 1 操作の表にする。
 * 生成は情報を足さない — 全ての列は action_spec とドメイン仕様(state_spec / access_spec)
 * から機械的に引く(行の組み立ては actions-view.ts が一括して持ち、specs 側の索引
 * (actions-index.ts)とここでデータを共有する)。
 *
 * 集約の章と同じ形(`html/layer-chapter.ts`)だが、**この章に公理も受け入れも数えない**: 操作の宣言は集約の章の遷移が、
 * 確認の上書き・生成に乗らない理由・手書きの理由は集約の章と表の章の受け入れが、既に必読に数えている。同じ ID を二度
 * 必読に数えないため、上段は「他の章で数えているもの」の案内(手引きと同じ割り付けから機械で引いた表)だけを置き、
 * 操作の表・結果表・例外の一覧は下段に畳む。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { acceptCounts, acceptItems, type AcceptItem } from '../../../semantics/reading-load.js';
import type { ReadingElement } from '../../../semantics/reading-class.js';
import { bookChapters } from './chapters.js';
import { blockOf } from './chapter-files.js';
import { bookLayout } from './face-scope.js';

/** 属性列・方針列の読み方(定型)。 */
export const ATTRIBUTES_NOTE =
  '「属性」は `state_spec` / `access_spec` / データ仕様から機械的に導いた事実(9 種のうち成立するものだけを略号で表示。' +
  '`irreversible` / `terminal` / `destructive` / `affects_others` / `outbound` / `bulk` / `scheduled` / `privileged` / `touches_personal`)。' +
  '「方針」は確認ダイアログの要否(`confirm` / `—`)と、`ux:` で上書きしている場合はその理由。' +
  '正: [action-spec-writing.md「方針の導出」](../rules/process/backend/specification/standards/action-spec-writing.md)。';

/** 他の章が受け入れとして数えている、操作に関わる理由の種類(要素の種類 → 呼び名)。 */
const COUNTED_ELSEWHERE: ReadonlyArray<readonly [ReadingElement, string]> = [
  ['ux.override.reason', '確認の上書き(ux)の理由'],
  ['runner.reason', '生成に乗らない操作(runner)の理由'],
  ['lint.exception.reason', 'リント違反の受け入れ(exceptions)の理由'],
  ['handwritten.reason', '手書きの CHECK と関数(handwritten)の理由'],
];

/** 「他の章で数えているもの」の 1 行(種類 → その理由が配られた章ごとの件数。HTML 版も同じ行を使う)。 */
export interface CountedElsewhereRow {
  readonly name: string;
  readonly count: number;
  /** 配られた章(章のファイルが空なら、章に配れなかったもの)。 */
  readonly chapters: readonly { readonly chapter: string; readonly title: string; readonly count: number }[];
}

/**
 * 「他の章で数えているもの」の表の材料(種類・件数・数えている章)。受け入れの一覧を、手引きと同じ割り付け(`blockOf`)で
 * 章に配って機械で引く。この章に配られるものは無い(操作の仕様は集約の章に、表の仕様は集約の章かデータの章に載る)。
 *
 * @param file この章のファイル(配られた先がこの章かを見る。章の数の鍵)
 * @returns 表の行と、全部の件数と、この章に配られた件数
 */
export function countedElsewhere(model: SpecModel, ctx: GenerateContext, file: string): { rows: CountedElsewhereRow[]; total: number; here: number } {
  const titles = new Map(bookChapters(model, ctx).map((chapter) => [chapter.file, chapter.title] as const));
  const layout = bookLayout(model, ctx);
  const all: readonly AcceptItem[] = acceptItems(acceptCounts(ctx.actions?.actions ?? [], ctx.dataTables?.tables ?? [], [], []));
  let here = 0;
  const rows = COUNTED_ELSEWHERE.flatMap(([element, name]): CountedElsewhereRow[] => {
    const group = all.filter((item) => item.element === element);
    if (group.length === 0) return [];
    const chapters = new Map<string, number>();
    for (const item of group) {
      const chapter = blockOf(item.file, model, ctx.roots, layout)?.chapter ?? '';
      if (chapter === file) here += 1;
      chapters.set(chapter, (chapters.get(chapter) ?? 0) + 1);
    }
    return [{ name, count: group.length, chapters: [...chapters].map(([chapter, count]) => ({ chapter, title: titles.get(chapter) ?? chapter, count })) }];
  });
  return { rows, total: all.filter((item) => COUNTED_ELSEWHERE.some(([element]) => element === item.element)).length, here };
}
