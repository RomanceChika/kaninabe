/**
 * 「誰に何が見えるか」の章(docs/book/visibility.html)の生成器。
 *
 * 可視性の宣言(access_spec の `reads` / `fields_hidden`)は集約ごとのファイルに散っており、
 * 「このロールには結局どこまで見えるのか」を横断で読む場所が無い。可視性は
 * 一度間違えると静かに漏れる種類の宣言なので、全エンティティ × 全ロールをこの 1 章に集める。
 * 後半は読み取り経路(query_spec)の一覧 — どの宣言の上にどの経路が立っているかまでを 1 章で読む。
 *
 * 集約の章と同じ形(`html/layer-chapter.ts`)だが、**この章に公理は無い**: 可視性の宣言(`access.*`)は集約の章の
 * 「誰に見えるか」が必読に数えている。同じ宣言を二度必読に数えないため、上段は「集約の章で読む」の案内(手引きと同じ集計から
 * 引いた表)だけを置き、横断の表・個人データ・読み取り経路・索引は下段に畳む。標識は受け入れの下に原文のまま置く。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { specPath } from '../../../model/product/paths.js';
import { blockReadings } from './block-reading.js';
import { bookChapters } from './chapters.js';
import { DOMAIN_SECTIONS } from './sections.js';

/** 標識を引用する仕様ファイル(読み取り経路・ロール・外から届く surface。重複を除く)。 */
export function signSources(ctx: GenerateContext): string[] {
  return [
    ...new Set([
      ...(ctx.queries?.queries ?? []).map((query) => query.location.file),
      specPath(ctx.roots, 'domain/roles.md'),
      specPath(ctx.roots, 'backend/surface.md'),
    ]),
  ];
}

/** 「集約の章で読む」の 1 行(HTML 版も同じ行を使う)。 */
export interface CrossReference {
  /** 章のファイル(リポジトリルート相対)。 */
  readonly chapter: string;
  /** 章の表題。 */
  readonly title: string;
  /** アクセスの宣言を持つ仕様ファイル(`specRelative` で見せる)。 */
  readonly file: string;
  /** その章が数えている公理の本数。 */
  readonly axioms: number;
}

/**
 * 「集約の章で読む」の表の材料。アクセスの宣言を数えている章を、手引きと同じ集計(`blockReadings`)から機械で引く。
 *
 * @returns 表の行(章・仕様ファイル・その章が数えている公理の本数)と、本数の合計
 */
export function crossReferenceRows(model: SpecModel, ctx: GenerateContext): { rows: CrossReference[]; total: number } {
  const titles = new Map(bookChapters(model, ctx).map((chapter) => [chapter.file, chapter.title] as const));
  const found = blockReadings(model, ctx).filter((reading) => reading.section === DOMAIN_SECTIONS.visibility && reading.axioms > 0);
  return {
    total: found.reduce((sum, reading) => sum + reading.axioms, 0),
    rows: found.map((reading) => ({ chapter: reading.chapter, title: titles.get(reading.chapter) ?? reading.chapter, file: reading.file, axioms: reading.axioms })),
  };
}
