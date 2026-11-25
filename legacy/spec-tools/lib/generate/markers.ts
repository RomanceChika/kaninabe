/**
 * AUTO-GENERATED マーカーブロックの検出と置換(純粋関数)。
 *
 * ブロックの形式:
 *   <!-- AUTO-GENERATED:{name} -->
 *   (生成内容 — 手書きの内容はここに置いてはならず、置換で消える)
 *   <!-- /AUTO-GENERATED:{name} -->
 *
 * **フロントマター(YAML)の中では同じ印を YAML のコメントで書く**(束 ⑰-3)。
 * HTML コメントは YAML として読めないので、`test_cases` のように「仕様の宣言そのものが
 * 生成物になる」場所では次の形を使う —— 意味は上とまったく同じである。
 *   # AUTO-GENERATED:{name}
 *   # /AUTO-GENERATED:{name}
 */

/** 印の書き方(マークダウン本文の HTML コメント / フロントマターの YAML コメント)。 */
const FORMS: readonly ((name: string) => { readonly open: string; readonly close: string })[] = [
  (name) => ({ open: `<!-- AUTO-GENERATED:${name} -->`, close: `<!-- /AUTO-GENERATED:${name} -->` }),
  (name) => ({ open: `# AUTO-GENERATED:${name}`, close: `# /AUTO-GENERATED:${name}` }),
];

/** ソース中のマーカー名を列挙する(開始マーカーのみ。対応する終了が無いものは含めない)。 */
export function listMarkers(source: string): string[] {
  const names: string[] = [];
  const re = /(?:<!-- |# )AUTO-GENERATED:([a-z0-9-]+)(?: -->)?/g;
  for (const m of source.matchAll(re)) {
    const name = m[1];
    if (name === undefined || names.includes(name)) continue;
    if (FORMS.some((form) => source.includes(form(name).close))) names.push(name);
  }
  return names;
}

/** 置換結果。found=false はマーカーブロックが存在しなかった(ソースは無変更)。 */
export interface ReplaceResult {
  readonly found: boolean;
  readonly source: string;
}

/**
 * マーカーブロックの中身を content に置換する。
 * 開始・終了マーカー行は保持し、間の内容だけを差し替える。
 */
export function replaceSection(source: string, marker: string, content: string): ReplaceResult {
  for (const form of FORMS) {
    const { open, close } = form(marker);
    const start = source.indexOf(open);
    if (start === -1) continue;
    const found = source.indexOf(close, start);
    if (found === -1) continue;
    // 終了マーカーの**行頭**まで戻す。フロントマターの印は字下げされているので、
    // マーカーそのものの位置で切ると字下げが消えてしまう(本文の印は行頭なので影響が無い)。
    const end = source.lastIndexOf('\n', found) + 1;
    const before = source.slice(0, start + open.length);
    const after = source.slice(end);
    // 前後の**空行**だけを落とす(`trim()` は 1 行目の字下げまで削ってしまう ——
    // フロントマターの生成ブロックは字下げが構文の一部である)。
    const trimmed = content.replace(/^[\r\n]+/, '').replace(/\s+$/, '');
    const body = trimmed.length === 0 ? '\n' : `\n${trimmed}\n`;
    return { found: true, source: `${before}${body}${after}` };
  }
  return { found: false, source };
}
