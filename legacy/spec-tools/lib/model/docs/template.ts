/**
 * template_policy に従ってテンプレートを解決し、H2 見出しの集合を取り出す I/O 層。
 *
 * 解決手順の正: docs/rules/meta/standards/template_policy.md「解決手順(優先順位)」。
 *   1. 同じディレクトリの `template.{doc_type}.md` があれば無条件で採用する
 *   2. 同じディレクトリの `template.md` があれば、その doc_type と文書の doc_type を比べる
 *      - 一致、またはテンプレート側に doc_type 指定が無ければ採用する
 *      - 不一致なら採用せず、1 つ上のディレクトリへ探索を続ける
 *   3. どちらも無ければ 1 つ上のディレクトリで 1 から繰り返す
 *   4. docs/ まで遡って見つからなければ「テンプレート未定義」(M5 の対象外)とする
 *
 * テンプレート自身のフロントマター `h2_policy: open` は「H2 の語彙が開いている」宣言で、
 * TemplateSpec.openH2 として M5 に渡る(template_policy.md「H2 の語彙(closed / open)」)。
 *
 * ここは fs に触れる層であり、検証器からは import しない
 * (規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readFrontMatter } from '../../io/front-matter.js';
import { isFile, toRelative } from '../../io/paths.js';
import { isOptionalHeading, isRepeatableHeading, parseMarkdown } from './parse-markdown.js';
import type { TemplateHeading, TemplateSpec } from './types.js';

/** テンプレートを解決する器。同じテンプレートを何度も読まないようキャッシュを持つ。 */
export interface TemplateResolver {
  /**
   * 1 文書に適用されるテンプレートを解決する。
   *
   * @param docPath 文書の絶対パス
   * @param docType 文書の doc_type(無ければ null)
   * @returns 解決したテンプレート。見つからなければ null
   */
  resolve(docPath: string, docType: string | null): TemplateSpec | null;
}

/**
 * テンプレート解決器を作る。
 *
 * @param stopDir 探索の上限ディレクトリ(絶対パス)。通常は docs/。ここより上は探索しない
 * @param repoRoot TemplateSpec.file をこのディレクトリからの相対パスにする
 * @returns テンプレート解決器
 */
export function createTemplateResolver(stopDir: string, repoRoot: string): TemplateResolver {
  const cache = new Map<string, TemplateSpec>();

  const load = (absolute: string): TemplateSpec => {
    const cached = cache.get(absolute);
    if (cached !== undefined) return cached;
    const parsed = parseTemplate(absolute, repoRoot);
    cache.set(absolute, parsed);
    return parsed;
  };

  return {
    resolve(docPath: string, docType: string | null): TemplateSpec | null {
      let dir = dirname(docPath);
      for (;;) {
        const found = resolveInDirectory(dir, docType, load);
        if (found !== null) return found;
        if (dir === stopDir) return null;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
      }
    },
  };
}

/**
 * 1 ディレクトリ内でテンプレートを探す。
 * doc_type 別テンプレートを汎用テンプレートより優先し、
 * doc_type が食い違う汎用テンプレートは採用しない(呼び出し側が上位を探索し直す)。
 */
function resolveInDirectory(
  dir: string,
  docType: string | null,
  load: (absolute: string) => TemplateSpec,
): TemplateSpec | null {
  if (docType !== null) {
    const typed = join(dir, `template.${docType}.md`);
    if (isFile(typed)) return load(typed);
  }
  const generic = join(dir, 'template.md');
  if (!isFile(generic)) return null;

  const spec = load(generic);
  if (spec.docType !== null && docType !== null && spec.docType !== docType) return null;
  return spec;
}

/** テンプレートファイルを読んで H2 見出しの集合を取り出す。読めない場合は空のテンプレートを返す。 */
function parseTemplate(absolute: string, repoRoot: string): TemplateSpec {
  const file = toRelative(repoRoot, absolute);
  const source = readTemplate(absolute);
  if (source === null) return { file, docType: null, h2: [], repeatable: true, openH2: false };

  const frontmatter = templateFrontmatter(source);
  const h2Raw = parseMarkdown(source).headings.filter((heading) => heading.level === 2);
  const h2: TemplateHeading[] = h2Raw.map((heading) => ({
    name: heading.text,
    optional: isOptionalHeading(heading.raw),
  }));
  return {
    file,
    docType: stringOrNull(frontmatter['doc_type']),
    h2,
    repeatable: h2Raw.some((heading) => isRepeatableHeading(heading.raw)),
    openH2: frontmatter['h2_policy'] === 'open',
  };
}

/**
 * テンプレートのフロントマターを読む。読めない場合(壊れている・拒まれた)は空とみなす。
 * 空なら `doc_type` が無く、呼び手は「テンプレート未定義」と同じに扱う。拒んだ理由の Finding は
 * 同じファイルを読む文書の読み込み(`loader.ts`)が出す。
 */
function templateFrontmatter(source: string): Readonly<Record<string, unknown>> {
  const result = readFrontMatter(source);
  return result.kind === 'ok' ? result.data : {};
}

/** フロントマターの値を文字列として読む。文字列でなければ null。 */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** テンプレートを読む。読めない場合は null(テンプレート未定義と同じ扱いにする)。 */
function readTemplate(absolute: string): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}
