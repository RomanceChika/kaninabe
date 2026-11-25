/**
 * W3 の (C): **道具の場所から製品の根を探さない**(`cli/**` だけが相手)。
 *
 * W3 の (A)(B) は「仕組みが製品の根の**綴り**を持たない」を見る。こちらは同じ線の別の辺で、
 * 「仕組みが**自分の場所を足場に**製品の根を決めない」を見る。綴りが 1 文字も無くても、
 * `detectRepoRoot(import.meta.dirname)` は「道具と製品が同じ木に居る」ことを前提にしている ——
 * 道具を製品の木の外(別のパッケージ・別のリポジトリ)へ置いた日に、根が嘘になる。
 * CLI の根は**作業ディレクトリから上へ宣言を探して**決める(`cli/repo-root.ts`・`--root` で上書き)。
 *
 * (C) が見る形は 3 つ(どれも**コメントを落とした本文**の呼び出しだけ。散文は見ない):
 *
 *   - **(C1) `detectRepoRoot(import.meta.dirname …)`** — 道具の場所から宣言を探す形。
 *   - **(C2) `resolve` / `join` に `import.meta.dirname` と相対リテラルを渡し、その行き先が宣言された根の中に
 *     なる形**(例: CLI の置き場から `../../` を登って仕様の木を指す)。行き先は CLI の置き場に
 *     リテラルを当てて**畳んでから**宣言された根と比べるので、`../` の段数の違いで逃げられない。
 *   - **(C3) 同じ呼び出しで、行き先が根の宣言の外 —— リポジトリルートそのもの、またはその上 —— になる形**
 *     (例: `resolve(import.meta.dirname, '../../../')` を「リポジトリルート」とする。`cli/prove-*.mjs` が
 *     そう書いていた)。道具の隣のファイル・道具のパッケージの中を指す形は根ではないので相手にしない。
 *
 * **追えない形**(見ない): 相対を複数の引数に分けた `resolve(import.meta.dirname, '..', '..', '..')`、
 * 変数に入れてから渡す形、`new URL('../', import.meta.url)` / `fileURLToPath` 経由の形。最初のリテラルを
 * 1 つ取る素朴な形だけが相手で、形を増やすより、CLI の根は `repoRootOrExit` 1 本から取るという規約を守る側に倒す。
 *
 * 対象は `cli/**` に限る。`lib/io/oversize-rule.ts` のように「仕組み自身の場所」を探す層は
 * `cli/` の外にあり、検査の相手ではない(免除リストを書かずに済む)。
 */

import { posix } from 'node:path';
import { FRAMEWORK_CLI_DIR } from '../../io/paths.js';
import { stripComments } from '../literals.js';
import type { Finding } from '../../kernel/finding.js';

/** W3 と同じ検証器 ID(判定が複数あるだけで、検査は 1 つ)。 */
const VERIFIER_ID = 'W3';

/** 宣言された根 1 本(名前と綴り。W3 の `DeclaredRoot` と同じ形)。 */
interface RootSpelling {
  readonly name: string;
  readonly value: string;
}

/** (C3) 行き先がリポジトリルートそのもの(またはその上)のときに、根の名前として出す語。 */
const REPOSITORY_ROOT_NAME = 'リポジトリルート';

/** (C1) 道具の場所から宣言を探す形。 */
const DETECT_FROM_TOOL = /(?<![A-Za-z0-9_$.])detectRepoRoot\(\s*import\.meta\.dirname\b/g;

/** (C2) `resolve(import.meta.dirname, '…')` / `join(import.meta.dirname, '…')`(`path.` 付きも)。 */
const RESOLVE_FROM_TOOL =
  /(?<![A-Za-z0-9_$.])(?:path\s*\.\s*)?(?:resolve|join)\(\s*import\.meta\.dirname\s*,\s*(['"`])([^'"`]*)\1/g;

/**
 * `cli/**` の 1 ファイルに、道具の場所から根を探す形が無いかを見る。
 *
 * @param source ファイルの本文
 * @param file リポジトリルート相対のパス(`cli/` の外なら何も見ない)
 * @param targets 宣言された根(長い順)
 * @returns 違反(1 か所につき 1 件)
 */
export function toolLocationHits(source: string, file: string, targets: readonly RootSpelling[]): Finding[] {
  if (!file.startsWith(`${FRAMEWORK_CLI_DIR}/`)) return [];
  const code = stripComments(source);
  const findings: Finding[] = [];
  for (const match of code.matchAll(DETECT_FROM_TOOL)) {
    findings.push(hit(file, lineOf(code, match.index), 'detectRepoRoot(import.meta.dirname)', null));
  }
  for (const match of code.matchAll(RESOLVE_FROM_TOOL)) {
    const literal = match[2] ?? '';
    const landed = posix.normalize(posix.join(FRAMEWORK_CLI_DIR, literal)).replace(/\/$/, '');
    const root = targets.find(({ value }) => landed === value || landed.startsWith(`${value}/`));
    if (root !== undefined) {
      findings.push(hit(file, lineOf(code, match.index), literal, root.name));
      continue;
    }
    if (landed === '.' || landed === '..' || landed.startsWith('../')) {
      findings.push(hit(file, lineOf(code, match.index), literal, REPOSITORY_ROOT_NAME));
    }
  }
  return findings;
}

/** オフセットの行番号(1 始まり)。 */
function lineOf(code: string, index: number | undefined): number {
  return code.slice(0, index ?? 0).split('\n').length;
}

/** 違反 1 件を組み立てる。 */
function hit(file: string, line: number, form: string, rootName: string | null): Finding {
  const what =
    rootName === null
      ? `\`${form}\` は道具の場所から製品の根を探しています`
      : `道具の場所からの相対 "${form}" が製品の根(${rootName})の中を指しています`;
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${what}(道具を製品の木の外に置くと根が嘘になります)`,
    location: { file, pointer: `line ${String(line)}` },
    suggestion:
      'CLI の根は作業ディレクトリから上へ product.md を探して決める(cli/repo-root.ts の repoRootOrExit。' +
      '--root で上書きできる)。仕様の木などは、その根と宣言された根(roots.…)から組み立てる',
    counterexample: rootName === null ? { form } : { form, root: rootName },
  };
}
