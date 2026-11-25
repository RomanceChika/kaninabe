/**
 * ハンドブックの注記の表(`CHAPTER_READERS`)の実測で、**どの件を測るか**を選ぶ道具(`probeIndexes`)。
 * 純粋な選び方なので、偽の入力で確かめる本体のテスト(`unit/generate/book-entry-notice.test.ts`)と、
 * 製品の実物で実測する側(`dev-repo/unit/generate/book-entry-notice.test.ts`)が同じものを使う。
 */

/**
 * 件の測り方。全生成器で 1 回作り直すのに約 1.7 秒かかり、全 397 件を測ると約 15 分になる(2026-10-08 の実測 14 分 43 秒。他の検査と並行した環境)。そこで**既定は代表だけ**にする:
 *   - 件数が少ない種類(`PROBE_ALL_UP_TO` 件以下)は各件
 *   - 多い種類は、**件の形**(`Droppable.shapes` の軸)ごとに、その形の値の先頭の 1 件(位置の先頭・2 件目・真ん中・最後ではなく、形で選ぶ。
 *     実例: 状態遷移の網羅の章 `sweep.md` は、操作のうち遷移のものを落としたときだけ変わる。位置では拾えず、形「計画の遷移」の代表で拾う)
 * **全件の実測**は環境変数 `BOOK_NOTICE_FULL=1`(`npm run book:notice:full`)で有効になる(全件を全生成器で測る。約 15 分。CI には入れない。表を作り直す・形の軸を足したとき・月に 1 回回して、代表の結果と一致することを確かめる)。
 */
export const PROBE_ALL_UP_TO = 5;
export const FULL = process.env['BOOK_NOTICE_FULL'] === '1';

/** 件の形で代表を選ぶのに要るもの(`Droppable` の一部。テストが偽の入力で確かめられるよう、入力と文脈の型は問わない)。 */
export interface ShapeProbe<Inputs, Env> {
  readonly count: (inputs: Inputs) => number;
  readonly shapes: readonly ((inputs: Inputs, index: number, env: Env) => readonly string[])[];
}

/**
 * 測る件の index(昇順)。
 *
 * @param droppable その種類の落とし方と形の軸
 * @param inputs 全種類を採る木の文脈
 * @param env 軸が導出に使う文脈(ドメイン仕様)
 * @param full 全件を測るか(省略は環境変数 `BOOK_NOTICE_FULL`)
 */
export function probeIndexes<Inputs, Env>(droppable: ShapeProbe<Inputs, Env>, inputs: Inputs, env: Env, full = FULL): readonly number[] {
  const count = droppable.count(inputs);
  const all = Array.from({ length: count }, (_item, index) => index);
  if (full || count <= PROBE_ALL_UP_TO) return all;
  const picked = new Set<number>();
  for (const shape of droppable.shapes) {
    const seen = new Set<string>();
    for (const index of all) {
      const label = JSON.stringify(shape(inputs, index, env));
      if (seen.has(label)) continue;
      seen.add(label);
      picked.add(index);
    }
  }
  return [...picked].sort((left, right) => left - right);
}


/** 本文の始まり(ページの器 `html/page.ts` の `.vp-doc` の要素)。これより前は帯・目次(ページの枠)で、節の比べに入れない。 */
const BODY_START = '<div class="vp-doc bf-doc">';
/** 本文の終わり(前後の章の案内。無ければ `</main>`)。 */
const BODY_ENDS = ['<nav class="bf-pager"', '</main>'];

/** 名前つきの実体参照(出力の口 `html/markup.ts` が作るもの)。 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** 本の HTML のページから、本文(`.vp-doc` の中)だけを取る。ページの枠(上の帯・左の目次・前後の章)と、本の外の資材は含めない。本文が見つからなければ空。 */
export function pageBody(html: string): string {
  const start = html.indexOf(BODY_START);
  if (start < 0) return '';
  const from = start + BODY_START.length;
  const ends = BODY_ENDS.map((end) => html.indexOf(end, from)).filter((at) => at >= 0);
  return html.slice(from, ends.length === 0 ? html.length : Math.min(...ends));
}

/**
 * 見出し(`<h2>` の中身の HTML)を、注記の表の節の名前にする(印・件数・名前の入る見出しは一般形にする)。
 * 印の要素(`bf-mark`)は中身ごと取り、タグを取り、実体参照を戻し、`(N)` を取る。ユースケースの章の `<h2>` は 1 つの一般形。
 */
export function htmlSectionLabel(chapter: string, headingHtml: string): string {
  if (chapter === 'usecases.html') return 'ユースケースごとの節';
  return headingHtml
    .replace(/<span class="bf-mark[^"]*">.*?<\/span>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|([a-z]+));/g, (whole, code: string | undefined, name: string | undefined) =>
      code !== undefined ? String.fromCodePoint(Number.parseInt(code, 10)) : (NAMED_ENTITIES[name ?? ''] ?? whole),
    )
    .replace(/\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 章(HTML のページ)を節に割り、節の名前 → その節の本文の断片(見出しの要素を除く。同じ名前の節は出現の順に連ねる)にする。
 * 節の境は本文の `<h1>` / `<h2>` の要素。`<h1>` の要素の直後から最初の `<h2>` までが `冒頭`(タイトルの下の導入と数の表示)。`<h3>` 以下は属する節の中。
 * 断片の**並び**で持つ(別の節に同じ断片があっても、並び替わっても、取りこぼさない)。
 */
export function htmlSectionBodies(chapter: string, html: string): ReadonlyMap<string, readonly string[]> {
  const body = pageBody(html);
  const bodies = new Map<string, string[]>();
  const headings = [...body.matchAll(/<h([12])\b[^>]*>(.*?)<\/h\1>/gs)];
  const add = (label: string, chunk: string): void => {
    const list = bodies.get(label);
    if (list === undefined) bodies.set(label, [chunk]);
    else list.push(chunk);
  };
  const first = headings[0];
  if (first?.index !== undefined && first.index > 0) add('冒頭', body.slice(0, first.index));
  headings.forEach((heading, at) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[at + 1]?.index ?? body.length;
    add(heading[1] === '1' ? '冒頭' : htmlSectionLabel(chapter, heading[2] ?? ''), body.slice(start, end));
  });
  return bodies;
}

/** 章の中身が違う節(同じ名前の節の断片の並びが違う・片側にしか無い節で中身がある)。 */
export function changedHtmlSections(chapter: string, a: string, b: string): ReadonlySet<string> {
  const left = htmlSectionBodies(chapter, a);
  const right = htmlSectionBodies(chapter, b);
  const sections = new Set<string>();
  for (const label of new Set([...left.keys(), ...right.keys()])) {
    const leftChunks = left.get(label) ?? [];
    const rightChunks = right.get(label) ?? [];
    if (leftChunks.length !== rightChunks.length || leftChunks.some((chunk, index) => chunk !== rightChunks[index])) sections.add(label);
  }
  return sections;
}
