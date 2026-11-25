/**
 * 仕様ファイルの手書き本文(標識)の抽出と集計(純粋関数)。
 *
 * 仕様ファイルの最終形は「YAML(正)+生成ブロック(可読形)+標識(手書き散文)」であり
 * (domain-spec-writing.md)、標識だけが機械に導出できない人間の判断の記録である。
 * レビューの手引き(render/book/review-guide.ts)は本数を「その章に手書きの判断が
 * 残っているか」の指標に使い、ハンドブックの各章は本文そのものを文脈の中に引用する。
 * どちらも機械的な写しであり、文章の解釈はしない(生成は情報を足さない原則)。
 *
 * 対象は本文 = フロントマターと AUTO-GENERATED ブロックの**外**にある行のうち、
 * 見出し・表・コメント(複数行にまたがる HTML コメントの中身も含む)を除いたもの。箇条書きは 1 項目 = 1 本、散文は 1 段落 = 1 本
 * (折り返しの継続行・字下げした入れ子は直前の 1 本に含める)。
 */

/** フロントマターの区切り行。 */
const FRONTMATTER_FENCE = /^---\s*$/;

/** 生成ブロックの開始・終了マーカー(markers.ts と同じ形式)。 */
const GENERATED_OPEN = /^<!-- AUTO-GENERATED:[a-z0-9-]+ -->/;
const GENERATED_CLOSE = /^<!-- \/AUTO-GENERATED:[a-z0-9-]+ -->/;

/**
 * フロントマター(先頭の `---` 〜 次の `---`)を取り除き、本文の行だけを返す。
 * フロントマターが無ければ全行を返す(閉じ `---` が無い壊れた入力も同様)。
 */
function bodyLines(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const first = lines[0];
  if (first === undefined || !FRONTMATTER_FENCE.test(first)) return lines;
  const close = lines.findIndex((line, index) => index > 0 && FRONTMATTER_FENCE.test(line));
  return close === -1 ? lines : lines.slice(close + 1);
}

/** 集計から外す行(見出し・表・HTML コメント)か。 */
function isNoise(line: string): boolean {
  return /^#{1,6} /.test(line) || line.startsWith('|') || line.startsWith('<!--');
}

/**
 * 仕様ファイル 1 枚から標識(手書き本文)を全文抽出する。
 *
 * 1 要素 = 標識 1 本(箇条書き 1 項目・散文 1 段落)で、折り返しの継続行は
 * 元の改行を保ったまま同じ 1 本に含める。行の中身は原文のまま(整形しない)。
 *
 * @param source ファイルの生テキスト(フロントマター・生成ブロックを含んだまま渡す)
 * @returns 標識の本文の一覧(ファイル内の出現順)
 */
export function collectSigns(source: string): string[] {
  const signs: string[][] = [];
  let inGenerated = false;
  let inItem = false; // 直前の行が数えた 1 本(またはその継続)か
  let inComment = false; // 複数行にまたがる HTML コメントの中か(中身は標識ではない)
  for (const line of bodyLines(source)) {
    if (inComment) {
      inComment = !line.includes('-->');
      continue;
    }
    if (line.startsWith('<!--') && !line.includes('-->')) {
      inComment = true;
      inItem = false;
      continue;
    }
    if (GENERATED_OPEN.test(line)) {
      inGenerated = true;
      inItem = false;
      continue;
    }
    if (GENERATED_CLOSE.test(line)) {
      inGenerated = false;
      continue;
    }
    if (inGenerated) continue;
    if (line.trim().length === 0 || isNoise(line)) {
      inItem = false;
      continue;
    }
    if (/^- /.test(line)) {
      // 箇条書きの項目は(段落の途中でも)常に新しい 1 本
      signs.push([line]);
      inItem = true;
      continue;
    }
    if (inItem) {
      // 段落の続き・箇条書きの折り返し(字下げの有無を問わない)
      signs[signs.length - 1]?.push(line);
      continue;
    }
    signs.push([line]);
    inItem = true;
  }
  return signs.map((lines) => lines.join('\n'));
}

/**
 * 仕様ファイル 1 枚の標識(手書き本文)の本数を数える。
 *
 * @param source ファイルの生テキスト(フロントマター・生成ブロックを含んだまま渡す)
 * @returns 標識の本数(箇条書き 1 項目・散文 1 段落を各 1 本と数える)
 */
export function countSigns(source: string): number {
  return collectSigns(source).length;
}
