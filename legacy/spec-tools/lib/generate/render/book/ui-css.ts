/**
 * 実装 CSS(globals.css / ui.module.css)を、ハンドブックのパーツ見本用に写す純粋モジュール。
 *
 * パーツ見本は「本物の CSS」で描く — 値を書き写すと実装とズレるため、generate が
 * 実ファイルをスコープ付き(`.parts-demo` 配下)に変換して docs/book/assets/ へ吐く。
 * 変換は次の 3 つだけで、宣言の中身(値)には触れない:
 *   - セレクタの前に見本コンテナを前置きする(ページ全体への漏れを防ぐ)
 *   - CSS Modules の `composes:` 行を落とす(素の CSS では無効な構文)
 *   - 落とした `composes:` の意味を**セレクタ側で復元する**。`.tdNumeric { composes: td }` は
 *     ビルド時に「両方のクラスが付く」ことで効くので、素の CSS では合成元(`.td`)のルールに
 *     合成先(`.tdNumeric`)を並べて同じ効きにする。これが無いと、素のクラス名 1 つで描かれた
 *     マークアップ(SSR プレビュー)で枠や余白だけが消える。
 *
 * あわせて「どのクラスがどのトークンを使うか」をここで読み取る(見本のラベルの材料)。
 */

/** CSS のルール 1 つ(粗い分解。入れ子は想定しない — 対象の 2 ファイルは平坦である)。 */
interface CssRule {
  /** セレクタ部(カンマ区切りのまま)。@ルールのプレリュードも入る。 */
  readonly selector: string;
  /** 宣言部(波括弧の中身)。 */
  readonly body: string;
}

/** セレクタ 1 つぶんの読み取り結果。 */
export interface CssClassInfo {
  /** 参照しているトークン名(`var(--…)` の並び。宣言順・重複なし)。 */
  readonly tokens: readonly string[];
  /** `composes:` で継いでいるクラス名。 */
  readonly composes: readonly string[];
}

/**
 * CSS 全体を見本コンテナ配下へスコープする。
 *
 * @param css 元の CSS(コメントを含んでよい)
 * @param scope 見本コンテナのセレクタ(例: `.parts-demo`)
 * @returns スコープ済みの CSS(コメントは落ちる。生成物にはヘッダを別途付けること)
 */
export function scopeCss(css: string, scope: string): string {
  const heirs = composeHeirs(css);
  return parseRules(css)
    .map(
      (rule) =>
        `${scopeSelectors(inheritSelectors(rule.selector, heirs), scope)} {\n${scopeBody(rule.body)}\n}`,
    )
    .join('\n\n');
}

/**
 * 合成元のクラス名 → それを `composes` で継いでいるクラス名の並び。
 *
 * @param css 元の CSS
 * @returns 継承関係(継ぐ側が 1 つも無いクラスは現れない)
 */
function composeHeirs(css: string): Map<string, readonly string[]> {
  const heirs = new Map<string, string[]>();
  for (const [name, info] of cssClassInfo(css)) {
    for (const base of info.composes) {
      const list = heirs.get(base) ?? [];
      if (!list.includes(name)) list.push(name);
      heirs.set(base, list);
    }
  }
  return heirs;
}

/**
 * セレクタ列に、`composes` で継いでいるクラスのぶんを並べる。
 *
 * 置き換えるのは**先頭の複合セレクタのクラス名だけ**である(`.td:hover`・`.td > a` は
 * 先頭が `.td` なので継げる)。先頭がクラスでないセレクタ(`table`・`.a .td`)は
 * そのままにする — 合成は「その要素にクラスが 2 つ付く」ことなので、
 * 先頭以外に現れる `.td` は別の要素を指していて、置き換えると意味が変わる。
 *
 * @param selectorList カンマ区切りのセレクタ列
 * @param heirs 合成元 → 継ぐ側
 * @returns 継承ぶんを足したセレクタ列
 */
function inheritSelectors(selectorList: string, heirs: Map<string, readonly string[]>): string {
  const emitted: string[] = [];
  for (const selector of selectorList.split(',').map((part) => part.trim())) {
    if (selector === '') continue;
    emitted.push(selector);
    const head = /^\.([a-zA-Z0-9_-]+)/.exec(selector);
    const base = head?.[1];
    if (base === undefined) continue;
    for (const heir of heirs.get(base) ?? []) {
      const derived = `.${heir}${selector.slice(base.length + 1)}`;
      if (!emitted.includes(derived)) emitted.push(derived);
    }
  }
  return emitted.join(',');
}

/** 宣言部から `composes:` 行を落とす(それ以外は書かれたまま)。 */
function scopeBody(body: string): string {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^composes\s*:/.test(line))
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * カンマ区切りのセレクタ列にスコープを前置きする。
 *
 * `html` / `body` / `:root` は文書全体を指すため前置きでは届かない —
 * その複合セレクタ自体をスコープに置き換える(見本コンテナが「ページの地」を演じる)。
 */
export function scopeSelectors(selectorList: string, scope: string): string {
  return selectorList
    .split(',')
    .map((selector) => selector.trim())
    .filter((selector) => selector !== '')
    .map((selector) => {
      const rootLike = /^(html|body|:root)(\b|$)/.exec(selector);
      if (rootLike !== null) return `${scope}${selector.slice(rootLike[1]?.length ?? 0)}`;
      return `${scope} ${selector}`;
    })
    .join(',\n');
}

/**
 * セレクタ名(クラス名 or 要素名)ごとのトークン参照と composes を読み取る。
 *
 * キーはクラスなら `.` を除いた名前(`card`)、要素セレクタなら要素名(`button`)。
 * 同じ名前が複数のルールに現れたら(hover 等)参照をマージする。
 *
 * @param css 読み取る CSS
 * @returns セレクタ名 → 読み取り結果
 */
export function cssClassInfo(css: string): Map<string, CssClassInfo> {
  const found = new Map<string, { tokens: string[]; composes: string[] }>();
  for (const rule of parseRules(css)) {
    const tokens = [...rule.body.matchAll(/var\(\s*(--[a-z0-9-]+)/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined);
    const composes = [...rule.body.matchAll(/composes\s*:\s*([a-zA-Z0-9_ -]+);/g)].flatMap((match) =>
      (match[1] ?? '').trim().split(/\s+/),
    );
    for (const name of selectorNames(rule.selector)) {
      const entry = found.get(name) ?? { tokens: [], composes: [] };
      for (const token of tokens) if (!entry.tokens.includes(token)) entry.tokens.push(token);
      for (const composed of composes) if (!entry.composes.includes(composed)) entry.composes.push(composed);
      found.set(name, entry);
    }
  }
  return new Map([...found].map(([name, entry]) => [name, { tokens: entry.tokens, composes: entry.composes }]));
}

/** セレクタ列から「先頭の複合セレクタの名前」を取り出す(`.card:hover` → `card`)。 */
function selectorNames(selectorList: string): string[] {
  const names: string[] = [];
  for (const selector of selectorList.split(',')) {
    const head = selector.trim();
    const cls = /^\.([a-zA-Z0-9_-]+)/.exec(head);
    if (cls?.[1] !== undefined) {
      if (!names.includes(cls[1])) names.push(cls[1]);
      continue;
    }
    const element = /^([a-z][a-z0-9]*)/.exec(head);
    if (element?.[1] !== undefined && !names.includes(element[1])) names.push(element[1]);
  }
  return names;
}

/**
 * CSS をルールの並びに分解する(コメントを除去し、`{ … }` の組を拾う)。
 *
 * 対象の 2 ファイルは平坦(@media 等の入れ子なし)なので、波括弧の対応だけで足りる。
 * 入れ子の @ルールが現れたら中身ごと 1 ルールとして拾われる — その場合は見本の
 * 見た目が壊れて目視で気づく(このパーサーを賢くするより、CSS 側の平坦さを保つ)。
 */
function parseRules(css: string): CssRule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripped.matchAll(pattern)) {
    const selector = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    if (selector !== '') rules.push({ selector, body });
  }
  return rules;
}
