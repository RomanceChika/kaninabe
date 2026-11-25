/**
 * 「300 行を超えるファイルの宣言」の判定（純関数。ESLint にも検証器にも依らない）。
 *
 * 300 行は**信号**であって上限ではない。超える責務があるなら長いファイルは問題ない —— ただし
 * 何も意識しないと巨大な無駄なファイルもできるので、超えるファイルは**自分の冒頭の JSDoc** に
 * 2 つのタグで理由を書く。
 *
 * - `@oversize` … 1 つの責務のまま超える**妥当な理由**
 * - `@split-review` … 責務で割れるかを**検討した結果**（割る案と、採らなかった理由）
 *
 * 判定は 1 か所に置き、**自作の ESLint 規則 `layer/declared-oversize`**（3 つの木の lint）と
 * **verify の W 群の件数の報告**の両方がこれを呼ぶ（数え方を 2 本書かない）。
 *
 * 本文の検査は 2 つ。① どちらも 10 文字以上の中身があること（ラベルだけの空の宣言を通さない）。
 * ② **行数そのものを理由に書かないこと** —— 「行数の制限だから」は理由ではなく、理由は中身
 * （1 つの表・1 つの状態機械・1 つの写像）から書く。300 行以下のファイルに宣言が残っていたら
 * それも違反である（腐った宣言を残さない）。
 */

/** 信号の行数（これを超えるファイルが宣言を要る）。 */
export const OVERSIZE_MAX_LINES = 300;

/** 宣言の本文の最小の文字数（ラベルを除く）。 */
export const OVERSIZE_MIN_BODY = 10;

/**
 * 同じ本文の `@split-review` がこの本数以上あれば使い回し（定型文）とみなす本数。
 *
 * 割る案と採らなかった理由は**そのファイルで実際に考えたこと**でなければ意味が無い。どのファイルにも
 * 貼れる理由（例: 「割ると 2 枚を行き来する」）は、検討の跡ではなく宣言を通すための決まり文句になる。
 */
export const REPEATED_REVIEW_MIN = 3;

/** ファイル冒頭として読み飛ばす宣言（ディレクティブ・import・`export … from`）。 */
const DIRECTIVE = /^(["'])use [a-z ]+\1;?/u;
const IMPORT = /^import\b[^;'"]*?(["'])[^'"\n]*\1\s*(?:with\s*\{[^}]*\})?\s*;?/u;
const REEXPORT = /^export\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+(["'])[^'"\n]*\1\s*;?/u;

/** 理由に書いてはならない語（行数そのものは理由にならない）。 */
const FORBIDDEN_REASON = /行数|300\s*行|制限|上限/;

/** 本文の頭に書いてよいラベル（本文の長さに数えない）。 */
const LABEL = /^(超える理由|割る案と結果)\s*[:：]\s*/;

/**
 * ESLint の `max-lines` と同じ数え方で行数を返す（空行もコメントも数える。末尾の改行が作る
 * 空の最終行は数えない）。
 *
 * @param {string} text ファイルの本文
 * @returns {number} 行数
 */
export function countLines(text) {
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/u);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/**
 * ファイル冒頭（コードの前）にあるコメントのうち、最初の JSDoc（`/** … *\/`）の本文を返す。
 * 先頭の shebang・行コメント・ディレクティブ（`'use client'` など）・`import` と
 * `export … from`・JSDoc でないブロックコメントは読み飛ばす（製品の木と仕組み側のパッケージは、
 * `import` の後ろに見出しを置く書き方が多い）。
 *
 * @param {string} text ファイルの本文
 * @returns {string | null} JSDoc の中身（`/**` と `*\/` を除く）。無ければ null
 */
export function headerJsdoc(text) {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const rest = () => text.slice(pos);
  for (;;) {
    const skipped = /^\s+/u.exec(rest());
    if (skipped !== null) pos += skipped[0].length;
    const here = rest();
    if (here.startsWith("#!") || here.startsWith("//")) {
      const end = here.indexOf("\n");
      pos = end === -1 ? text.length : pos + end + 1;
    } else if (here.startsWith("/*")) {
      const end = here.indexOf("*/", 2);
      if (end === -1) return null;
      if (here.startsWith("/**") && !here.startsWith("/**/")) return here.slice(3, end);
      pos += end + 2;
    } else {
      const skipped = DIRECTIVE.exec(here) ?? IMPORT.exec(here) ?? REEXPORT.exec(here);
      if (skipped === null) return null;
      pos += skipped[0].length;
    }
  }
}

/**
 * 行頭のタグの開き(`@oversize` / `@split-review`)。**リテラルで持つ**(`layer/no-dynamic-regexp`:
 * パターンを実行時に組まない)。
 */
const TAG_OPENERS = {
  oversize: /^@oversize(?![\w-])\s*(.*)$/u,
  "split-review": /^@split-review(?![\w-])\s*(.*)$/u,
};

/**
 * JSDoc の中身から、行頭のタグ 1 つぶんの本文を取り出す（次のタグの行まで。行は空白 1 つで繋ぐ）。
 *
 * @param {string} jsdoc JSDoc の中身
 * @param {"oversize" | "split-review"} tag タグ名（`@` は付けない）
 * @returns {string | null} 本文（ラベルを含む。トリム済み）。タグが無ければ null
 */
function tagBody(jsdoc, tag) {
  const opener = TAG_OPENERS[tag];
  const lines = jsdoc.split(/\r\n|[\r\n]/u).map((line) => line.replace(/^\s*\*?[ \t]?/u, "").trimEnd());
  const start = lines.findIndex((line) => opener.test(line));
  if (start === -1) return null;
  const parts = [opener.exec(lines[start] ?? "")?.[1] ?? ""];
  for (const line of lines.slice(start + 1)) {
    if (/^@[\w-]+/u.test(line)) break;
    parts.push(line);
  }
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

/**
 * 宣言 1 つ（`@oversize` か `@split-review`）の本文の問題を返す。
 *
 * @param {string} tag タグ名（メッセージ用）
 * @param {string | null} body タグの本文（無ければ null）
 * @returns {{ id: string, message: string }[]} 問題（無ければ空）
 */
function bodyProblems(tag, body) {
  if (body === null) {
    return [{ id: `missing-${tag}`, message: `@${tag} が無い — ${tag === "oversize" ? "1 つの責務のまま超える理由" : "責務で割れるかを検討した結果(割る案と、採らなかった理由)"}を冒頭の JSDoc に書く` }];
  }
  const text = body.replace(LABEL, "");
  if ([...text].length < OVERSIZE_MIN_BODY) {
    return [{ id: `short-${tag}`, message: `@${tag} の本文が短い(${OVERSIZE_MIN_BODY} 文字以上の中身が要る。ラベルだけの宣言は通さない)` }];
  }
  if (FORBIDDEN_REASON.test(text)) {
    return [{ id: `lines-${tag}`, message: `@${tag} の本文に「行数」「300 行」「制限」「上限」を理由として書かない — 行数は理由にならない。中身(1 つの表・1 つの状態機械・1 つの写像など)から理由を書く` }];
  }
  return [];
}

/**
 * ファイル 1 本の本文に、300 行の宣言の規則を当てる。
 *
 * - 300 行以下: 宣言があれば違反（`leftover` = 腐った宣言）。無ければ何も言わない
 * - 300 行超: 冒頭の JSDoc に `@oversize` と `@split-review` が揃い、どちらも本文が
 *   10 文字以上で、行数を理由に書いていなければ宣言つき（`declared`）。足りなければ違反
 *
 * @param {string} text ファイルの本文
 * @param {number} [max] 信号の行数（既定 300）
 * @returns {{ lines: number, exceeds: boolean, declared: boolean, oversize: string | null, splitReview: string | null, problems: { id: string, message: string }[] }} 判定
 */
export function judgeOversize(text, max = OVERSIZE_MAX_LINES) {
  const lines = countLines(text);
  const exceeds = lines > max;
  const jsdoc = headerJsdoc(text);
  const oversize = jsdoc === null ? null : tagBody(jsdoc, "oversize");
  const splitReview = jsdoc === null ? null : tagBody(jsdoc, "split-review");
  if (!exceeds) {
    const leftover = oversize !== null || splitReview !== null;
    return {
      lines,
      exceeds,
      declared: false,
      oversize,
      splitReview,
      problems: leftover ? [{ id: "leftover", message: `${max} 行以下なのに @oversize / @split-review が残っている(${lines} 行) — 腐った宣言は消す` }] : [],
    };
  }
  const problems =
    oversize === null && splitReview === null
      ? [{ id: "undeclared", message: `${lines} 行あり ${max} 行を超えている — 冒頭の JSDoc に @oversize(1 つの責務のまま超える理由)と @split-review(責務で割れるかの検討の結果)を書くか、責務の境界で割る` }]
      : [...bodyProblems("oversize", oversize), ...bodyProblems("split-review", splitReview)];
  return { lines, exceeds, declared: problems.length === 0, oversize, splitReview, problems };
}

/**
 * 宣言の本文を比べるために整える（ラベルを外し、空白と改行を 1 つの空白にする）。
 *
 * @param {string} body タグの本文
 * @returns {string} 整えた本文
 */
function normalizedReview(body) {
  return body.replace(LABEL, "").replace(/\s+/gu, " ").trim();
}

/**
 * 同じ本文の `@split-review` が `threshold` 本以上ある組を返す（定型文の使い回しを見えるようにする）。
 *
 * ファイル 1 本の判定（`judgeOversize`）では見えない**ファイルをまたぐ性質**なので、規則
 * `layer/declared-oversize` ではなく、全ファイルを数える verify（W4）が呼ぶ。本文が無い・短すぎるものは
 * 数えない（それは `judgeOversize` が違反にする）。
 *
 * @param {{ file: string, splitReview: string | null }[]} entries 宣言つきファイルと `@split-review` の本文
 * @param {number} [threshold] 使い回しとみなす本数（既定 3）
 * @returns {{ body: string, files: string[] }[]} 本文の組（本文の昇順。files は昇順）
 */
export function repeatedSplitReviews(entries, threshold = REPEATED_REVIEW_MIN) {
  /** @type {Map<string, string[]>} */
  const byBody = new Map();
  for (const entry of entries) {
    if (entry.splitReview === null) continue;
    const body = normalizedReview(entry.splitReview);
    if ([...body].length < OVERSIZE_MIN_BODY) continue;
    byBody.set(body, [...(byBody.get(body) ?? []), entry.file]);
  }
  return [...byBody.entries()]
    .filter(([, files]) => files.length >= threshold)
    .map(([body, files]) => ({ body, files: [...files].sort() }))
    .sort((a, b) => (a.body < b.body ? -1 : a.body > b.body ? 1 : 0));
}
