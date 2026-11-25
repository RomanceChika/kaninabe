/**
 * W3: **仕組みは製品の根の綴りでパスを組み立てない**(error)。
 *
 * W1 が「仕組みの中にアプリの**語**が無い」を見るのに対し、W3 は「仕組みの中にアプリの
 * **住所**が無い」を見る。同じ「軸は仕組み・値はアプリ」の線の、もう 1 本の辺である。
 *
 * **なぜ必要か。** 分離の設計(framework-product-separation.md §1)の実測はこうだった ——
 * 依存の向きは既に一方通行(製品 → 仕組みの矢印は 0 本・B14 が禁じている)なのに、
 * `legacy/spec-tools/lib` の 132 ファイルが `app/` / `docs/specs/` / `supabase/migrations/` を
 * 文字列で持っていた。**障害は向きではなく綴りだった。** 綴りが残る限り、2 つ目の製品は
 * 「同じ配置にする」以外の選択肢を持てない(別スタック・モノレポ・別の木の名前が全部不可能)。
 *
 * **走査範囲**は仕組みのソース(`FRAMEWORK_SOURCE_DIRS` = 検証器・生成器の置き場と
 * **CLI**。拡張子は `.ts` に加えて `.mjs` / `.cjs` —— `cli/prove-*.mjs` のような道具も
 * 宣言を読む入口である)である。CLI を入れるのは、そこが宣言を読む入口そのものだからである —— 1 本だけ綴りが
 * 残ると「宣言を読んでいるのに 1 か所だけ綴りで実ファイルを読む」形になる(独立レビューが
 * `cli/check-formal.ts` の `supabase/migrations` を実測した)。
 *
 * **判定は 3 つある。** どれも**パスを組み立てている場所**だけを相手にし、散文は見ない。
 *
 *   - **(A) 根で始まるリテラル** —— `'{根}/…'`(または多段の根そのもの)。文の途中に出てくる
 *     `` `app/vercel.json` `` のような引用は散文であり、体系が自分を説明する文として W2 が
 *     `legacy/spec-tools/lib` を対象外にしている線と同じに扱う(散文まで機械で消すと、doc コメントが
 *     読めなくなるほうの害が大きい)。コメントは `stripComments` が前処理で落とす。
 *   - **(B) `path.join` に渡した 1 語の根** —— `path.join(repoRoot, 'app')` の形。(A) だけだと
 *     **1 段の根の直書きが構造的にすり抜ける**(独立レビューが 4 件実測した。うち 1 件は毎回の
 *     verify が通る経路だった)。1 語のリテラルは根の綴りと仕組み自身の語(層の名前 `src/app`)を
 *     字面で区別できないので、**第 1 引数が文字列リテラルでない**ことを条件にして分ける ——
 *     `path.join(repoRoot, 'app')` は根から組んでいるので捕る。第 1 引数が綴りの呼び出し(`join('x', 'y')`)はこの判定の相手にしない(`Array.prototype.join` も同じ形)。
 *     **層の並びの綴り(`src/{層}` ほか)は、かつて「仕組みが決めている形」としてここで許していたが、その許しは撤回した**(部品化 ③-c6)。
 *     コアは層の並びも持たない —— 後段の綴りの表(`lib/gates/platform-spellings.ts` の `TARGET_SPELLINGS` の nextjs の行)が、後段の置き場の外の文字列を見る。解決済みの根を伸ばす
 *     `joinPath(appSrc, 'app', …)` は別の名前なので (B) の相手ではない。
 *   - **(C) 道具の場所から根を探す形**(`cli/**` だけ。`w3-tool-location.ts`)—— `detectRepoRoot(import.meta.dirname)`
 *     と、`resolve` / `join` に `import.meta.dirname` と相対リテラルを渡して**宣言された根の中(またはリポジトリルートそのもの)を指す**形。
 *     綴りは無くても「道具と製品が同じ木に居る」前提を持つので、道具を製品の木の外に置くと根が嘘になる。
 *     CLI の根は作業ディレクトリから上へ宣言を探して決める(`cli/repo-root.ts`・`--root` で上書き)。
 *     `lib/io/oversize-rule.ts` のような**仕組み自身の場所**を探す層は `cli/` の外なので相手ではない。
 *
 * **例外は 1 つもない。** 免除リストを持たない代わりに、仕組みが持ってよい綴りは
 * `product.md`(宣言ファイルの名前。lib/io/paths.ts の `PRODUCT_DECL_FILE`)と、
 * **仕組み自身の住所**(`FRAMEWORK_LIB_DIR` / `FRAMEWORK_CLI_DIR` / `FORMAL_DIR`)だけである。
 * 後者は製品の根ではないので、そもそもこの検査の相手ではない。
 *
 * **まだ届かない範囲(明記)**: `path.join` 以外の口(自作の関数・テンプレートの中の変数展開)に
 * 1 語の根を渡す形は見られない。型も止めない(`appGrounded` / `appPath` は「その口を**通るなら**
 * 宣言を渡せ」と言うだけで、直書きの `path.join(repoRoot, 'app')` は何も言わない)。
 * **ここは人が見る**——(B) を足したのはその面積をいちばん広い口 1 つぶん狭めるためである。
 */

import { join } from 'node:path';
import {
  FRAMEWORK_LIB_DIR,
  FRAMEWORK_SOURCE_DIRS,
  extractLiterals,
  isScannedFile,
  stripComments,
} from '../scan.js';
import { isDirectory, toRelative, walkFiles } from '../../io/paths.js';
import { tryReadText } from '../../io/read-text.js';
import { toolLocationHits } from './w3-tool-location.js';
import type { Finding } from '../../kernel/finding.js';
import { OPTIONAL_ROOT_NAMES, REQUIRED_ROOT_NAMES, type ProductRoots } from '../../model/product/types.js';

/** 検証器 ID。 */
export const W3_VERIFIER_ID = 'W3';

/** 走査する拡張子(`cli/prove-*.mjs` のような道具も、宣言を読む入口として同じ線で見る)。 */
const SCANNED_EXTENSIONS: readonly string[] = ['.ts', '.mjs', '.cjs'];

/** W3 の入力。 */
export interface PathSpellingInput {
  /** リポジトリルートの絶対パス(走査の起点)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(禁じる綴りの母集合)。 */
  readonly roots: ProductRoots;
}

/** 宣言された根 1 本(名前と綴り)。 */
interface DeclaredRoot {
  readonly name: string;
  readonly value: string;
}

/**
 * 宣言された根の綴り(長い順)。
 *
 * 長い順に見るのは、`app` と `app/src/domain/generated` のように**入れ子になった根**が
 * あるとき、人に示す名前を「より具体的なほう」にするためである。
 */
function declaredRoots(roots: ProductRoots): readonly DeclaredRoot[] {
  return [...REQUIRED_ROOT_NAMES, ...OPTIONAL_ROOT_NAMES]
    .flatMap((name) => {
      const value = roots[name];
      return value === null ? [] : [{ name, value }];
    })
    .sort((a, b) => b.value.length - a.value.length);
}

/**
 * 仕組みのソースに製品の根の綴りが無いことを検査する。
 *
 * @param input リポジトリルートと宣言された根
 * @returns W3 違反(1 か所につき 1 件)
 */
export function verifyPathSpelling(input: PathSpellingInput): Finding[] {
  const targets = declaredRoots(input.roots);
  // 2 つの判定は重なりうる(多段の根を `path.join` に渡すと (A) も (B) も当たる)。
  // **同じ 1 か所を 2 回言わない** —— 直す場所は 1 つなので、指摘も 1 つが正しい。
  const byPlace = new Map<string, Finding>();
  for (const dir of FRAMEWORK_SOURCE_DIRS) {
    const root = join(input.repoRoot, dir);
    if (!isDirectory(root)) continue;
    for (const absolute of walkFiles(root, (name) => isScannedFile(name, SCANNED_EXTENSIONS))) {
      const file = toRelative(input.repoRoot, absolute);
      if (file === SELF_FILE) continue;
      const source = readText(absolute);
      for (const found of [
        ...leadingLiteralHits(source, file, targets),
        ...joinArgumentHits(source, file, targets),
        ...toolLocationHits(source, file, targets),
      ]) {
        const key = `${found.location.file}|${found.location.pointer ?? ''}|${found.counterexample?.['literal'] ?? ''}`;
        if (!byPlace.has(key)) byPlace.set(key, found);
      }
    }
  }
  return [...byPlace.values()];
}

/** (A) 根で始まるリテラル。 */
function leadingLiteralHits(
  source: string,
  file: string,
  targets: readonly DeclaredRoot[],
): Finding[] {
  const findings: Finding[] = [];
  for (const { literal, line } of extractLiterals(source)) {
    const hit = targets.find(
      ({ value }) => literal.startsWith(`${value}/`) || (literal === value && value.includes('/')),
    );
    if (hit === undefined) continue;
    findings.push(finding(file, line, literal, hit.name));
  }
  return findings;
}

/** `path.join(` / `join(`(`joinPath(` 等の別名は含まない)。 */
const JOIN_CALL = /(?<![A-Za-z0-9_$.])(?:path\s*\.\s*)?join\(/g;

/** 引用符で始まるか(= その引数が綴りそのもの)。 */
function isQuoted(argument: string): boolean {
  return /^['"`]/.test(argument.trim());
}

/**
 * (B) `path.join` の引数に現れた 1 語の根。
 *
 * 第 1 引数が文字列リテラルの呼び出しは、この判定の相手にしない(層の並びは綴りの表が見る —— 上の撤回の注)。
 * `Array.prototype.join` も第 1 引数が区切り文字のリテラルなので同じ条件で外れる。
 */
function joinArgumentHits(source: string, file: string, targets: readonly DeclaredRoot[]): Finding[] {
  const code = stripComments(source);
  const findings: Finding[] = [];
  JOIN_CALL.lastIndex = 0;
  for (let match = JOIN_CALL.exec(code); match !== null; match = JOIN_CALL.exec(code)) {
    const open = match.index + match[0].length - 1;
    const args = callArguments(code, open);
    if (args === null || args.length < 2 || isQuoted(args[0] ?? '')) continue;
    const line = code.slice(0, match.index).split('\n').length;
    for (const argument of args.slice(1)) {
      const literal = quotedValue(argument);
      if (literal === null) continue;
      const hit = targets.find(({ value }) => literal === value);
      if (hit !== undefined) findings.push(finding(file, line, literal, hit.name));
    }
  }
  return findings;
}

/**
 * `(` の位置から対応する `)` までを、深さ 0 のカンマで割った引数の並び。
 *
 * 括弧が閉じていなければ null(壊れたソースで推測しない)。
 */
function callArguments(code: string, open: number): readonly string[] | null {
  const parts: string[] = [];
  let current = '';
  let depth = 1;
  for (let index = open + 1; index < code.length; index += 1) {
    const char = code[index] ?? '';
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        parts.push(current);
        return parts.map((part) => part.trim()).filter((part) => part !== '');
      }
    }
    if (char === ',' && depth === 1) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  return null;
}

/** 引数が 1 本の文字列リテラルなら、その中身。そうでなければ null。 */
function quotedValue(argument: string): string | null {
  const found = /^(['"`])([^'"`]*)\1$/.exec(argument.trim());
  return found?.[2] ?? null;
}

/**
 * この検査そのものの置き場。
 *
 * 「禁じる綴りを書く場所そのものが自己違反する」形は W1 / W2 の `SELF_FILES` と同型である。
 * ただし**ここには根の綴りを 1 文字も書いていない**(宣言から組み立てる)ので、除外は
 * 将来この文書が例示を持ったときの保険であり、いまは 0 件を除外している。
 */
const SELF_FILE = `${FRAMEWORK_LIB_DIR}/generality/verifiers/w3-path-spelling.ts`;

/** 違反 1 件を組み立てる。 */
function finding(file: string, line: number, literal: string, rootName: string): Finding {
  return {
    verifier: W3_VERIFIER_ID,
    severity: 'error',
    message: `文字列 "${literal}" が製品の根(${rootName})の綴りでパスを組み立てています`,
    location: { file, pointer: `line ${String(line)}` },
    suggestion:
      `lib/model/product/paths.ts の組み立ての口(specPath / appPath / generatedPath / migrationPath / bookPath …)` +
      `を通して、宣言された根(roots.${rootName})から組み立てる。根を受け取れない場所なら、` +
      '受け取れる呼び出し側で組み立てて値として渡す(仕組みは製品の住所を知らない)',
    counterexample: { literal, root: rootName },
  };
}

/** ファイルを読む。読めなければ空文字(走査は best-effort。ここで検証を止めない)。 */
function readText(absolute: string): string {
  return tryReadText(absolute) ?? '';
}
