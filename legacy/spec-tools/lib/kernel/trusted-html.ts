/**
 * ハンドブックの生成部分に、**生成器だけが**つける例外の登録簿(kernel 層 — 全層が読む共通語)。
 *
 * ハンドブックの無害化(`lib/generate/book-sanitize.ts`)は**既定で拒否**する: 全行の `{{` `}}` `{` と `<` を割る(コードのフェンス・コメント・HTML ブロックの中も)。
 * 例外は、生成器のコードが「この文字列はそのまま出す」と**この登録簿に登録した完全一致の文字列**だけである(出力の中に印は置かない = 仕様の文字列は例外を偽造できない)。
 *
 *   - `snippets` … そのまま出す文字列(部品の見本の静的な HTML・実装が描いた画面のプレビュー・生成器が書いたコードの抜粋や図のフェンス・全体が生成物であるという宣言のコメント)。
 *     中の `<` と単独の `{` は変えない。`{{` と `}}` は登録された文字列の中でも割る。
 *   - `jsonAttrs` … 部品の式の属性(`:items` / `:cells`)の値。生成器の直列化(`jsonAttr`)が出した文字列そのもの。ここに無い値は式として通さない。
 *
 * 登録は生成の始めに空にする(`resetTrusted`)。登録簿はメモリの上だけにあり、ページと一緒に無害化へ渡る。
 *
 * ## 単位は生成器ごと(ページごとではない)で足りる理由
 *
 * 生成器は 1 回の呼び出しで複数のページを出し、登録はその間にページを区別せずに記録される。そこで登録簿は**生成器ごと**に切り出して、その生成器の全ページに渡す
 * (別の生成器が登録した文字列は、この生成器のページでは例外にならない = `sliceTrusted`)。同じ生成器の別のページに、登録された文字列と同じ文字列が仕様の文字列として
 * 現れても害が無いのは、登録される文字列が**どの文脈に置かれても安全な形**に限られるから: プレビューは登録の前に許可表を通る / 抜粋は本文より長い柵で囲み前に空行を足す /
 * 見本は静的な HTML ブロック / 式の属性は読み直して一致する値だけ / 中の `{{` は常に割る。これは `book-oracle-mixed.test.ts` が、登録した断片を敵対的な文字列のあらゆる文脈
 * (リスト・引用・HTML ブロックの直後・開いたフェンスの中)に置いて Vue のコンパイルと注入で確かめている。
 * 型と純関数だけで、何も import しない。**アプリの語彙は 1 語も持たない**。
 */

/** 登録簿。 */
export interface TrustedHtml {
  /** そのまま出す文字列(完全一致)。 */
  readonly snippets: Set<string>;
  /** 部品の式の属性の値(完全一致)。 */
  readonly jsonAttrs: Set<string>;
  /** 登録のときに見つかった食い違い(生成器の不具合・入力の検査で落ちたもの。書き込みの出口が名指して拒否する)。 */
  readonly problems: string[];
  /** 登録の順の記録(生成器ごとの登録を切り出すため)。 */
  readonly log: (readonly ['snippet' | 'json', string])[];
}

/** 新しい登録簿。 */
export function createTrusted(): TrustedHtml {
  return { snippets: new Set(), jsonAttrs: new Set(), problems: [], log: [] };
}

/** モジュールの読み込みのときに登録する定数(全体が生成物であるという宣言のコメントなど)。生成の始めに登録簿を空にしても残る。 */
const constants = new Set<string>();

let active: TrustedHtml = createTrusted();

/**
 * 登録簿を空にして、以降の登録の宛先にする(**生成・ブックの実行の始めと、テストの始めに呼ぶ**)。定数(`trustConstant`)だけは残る。
 *
 * @returns 新しい登録簿
 */
export function resetTrusted(): TrustedHtml {
  active = createTrusted();
  for (const text of constants) active.snippets.add(text);
  return active;
}

/**
 * 生成器が登録した順の記録のうち、`from` 番目以降だけを登録簿にして返す(その生成器が出すページの分。定数を含む)。問題は全体で共有する。
 *
 * @param registry 登録簿
 * @param from 切り出しの始まり(登録の記録の長さ)
 */
export function sliceTrusted(registry: TrustedHtml, from: number): TrustedHtml {
  const slice: TrustedHtml = { snippets: new Set(constants), jsonAttrs: new Set(), problems: registry.problems, log: [] };
  for (const [kind, value] of registry.log.slice(from)) (kind === 'snippet' ? slice.snippets : slice.jsonAttrs).add(value);
  return slice;
}

/**
 * 生成・検査の途中で見つけた問題を登録簿に載せる(書き込みの出口が、何も書かずに名指して拒否する)。
 *
 * @param message 問題(1 行)
 */
export function reportTrustedProblem(message: string): void {
  if (!active.problems.includes(message)) active.problems.push(message);
}

/** 今の登録簿。 */
export function currentTrusted(): TrustedHtml {
  return active;
}

/**
 * そのまま出す文字列を登録して、同じ文字列を返す。
 *
 * **仕様の文字列を含みうるものは、生成器が自分で逃がした(`<` を実体にした)あとの完全な形で登録する**。登録するのは「この並びを出す」と決めたコードの側で、
 * 仕様の側には登録の手段が無い。
 *
 * @param text 出力にそのまま現れる文字列(極端に短いものは登録しない)
 */
export function trustSnippet<T extends string>(text: T): T {
  if (text.length >= 8) {
    active.snippets.add(text);
    active.log.push(['snippet', text]);
  }
  return text;
}

/**
 * モジュールの読み込みのときに登録する定数(生成器のコードに書かれた、仕様の文字列を含まない文字列)。
 *
 * @param text 出力にそのまま現れる文字列
 */
export function trustConstant<T extends string>(text: T): T {
  constants.add(text);
  active.snippets.add(text);
  return text;
}

/**
 * 部品の式の属性の値を登録して、同じ文字列を返す。
 *
 * @param value 属性の値(`jsonAttr` の出力)
 */
export function trustJsonAttr<T extends string>(value: T): T {
  active.jsonAttrs.add(value);
  active.log.push(['json', value]);
  // 登録のときに、無害化が読み直すのと同じ手順で一致を確かめる(食い違いは生成器の不具合 = 書き込みの出口が名指して拒否する)。
  try {
    const parsed: unknown = JSON.parse(value.replace(/&(?:amp|#39);/g, (entity) => (entity === '&amp;' ? '&' : "'")));
    if (!Array.isArray(parsed) || serializeJsonAttr(parsed) !== value) active.problems.push(`部品の式の属性の値が、読み直した JSON の直列化と一致しない: ${value.slice(0, 80)}`);
  } catch {
    active.problems.push(`部品の式の属性の値が JSON として読めない: ${value.slice(0, 80)}`);
  }
  return value;
}

/**
 * 部品の式の属性の値を直列化する(生成器の唯一の直列化。無害化が読み直して一致を確かめる)。
 *
 * JSON の `"` はそのまま読める形に残し、`&` と `'` を実体参照に(`&amp;` `&#39;`)、`<` と `>` と文字列の中の `{{` を JSON の文字参照にする。
 * 属性の値はテンプレートの式として読まれる(`'` で囲む前提)。
 *
 * @param value JSON にできる値
 * @returns 属性の値
 */
export function serializeJsonAttr(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\{\{/g, '{\\u007b');
}
