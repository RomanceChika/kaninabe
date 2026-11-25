/**
 * 文書整合検証器(M1〜M6)のテスト用ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器のテストはファイル I/O を行わず、
 * 入力をテスト内でリテラル構築する。ここではその定型部分(見出し・リンク・
 * テンプレートの埋め草)だけを引き受ける。
 * ローダー自身のテストは fixtures/docs-tree-* を使う。
 */

import type {
  DocHeading,
  DocLink,
  DocsModel,
  LinkedFile,
  ScannedDoc,
  TemplateHeading,
  TemplateSpec,
} from '../../lib/model/docs/types.js';
import { TEST_ROOTS } from './product-roots.js';

/** 走査済みの文書 1 件を作る。doc_type / id はフロントマターにも同じ値を入れる。 */
export function scannedDoc(init: {
  file: string;
  docType?: string | null;
  id?: string | null;
  /** null にするとフロントマターから scope ごと落とす(欠落のテスト用)。 */
  scope?: string | null;
  /** doc_type / id / scope 以外に足したいフロントマター項目。 */
  frontmatter?: Readonly<Record<string, unknown>>;
  /** `## 目的` のような H2 見出し名の並び。 */
  h2?: readonly string[];
  headings?: readonly DocHeading[];
  template?: TemplateSpec | null;
}): ScannedDoc {
  const docType = init.docType === undefined ? 'process' : init.docType;
  const id = init.id === undefined ? null : init.id;
  const scope = init.scope === undefined ? 'common' : init.scope;
  const base: Record<string, unknown> = {};
  if (docType !== null) base['doc_type'] = docType;
  if (scope !== null) base['scope'] = scope;
  if (id !== null) base['id'] = id;
  Object.assign(base, init.frontmatter);

  return {
    file: init.file,
    docType,
    id,
    frontmatter: base,
    headings: init.headings ?? (init.h2 ?? []).map((text, i) => heading(2, text, i + 1)),
    template: init.template ?? null,
  };
}

/** 見出し 1 つを作る。 */
export function heading(level: number, text: string, line = 1): DocHeading {
  return { level, text, raw: text, line };
}

/** リンク 1 つを作る。exists の既定は true(解決できている)。 */
export function link(href: string, exists = true, line = 1): DocLink {
  return { href, target: href.replace(/^\.\//, ''), exists, line };
}

/**
 * テンプレート 1 つを作る。
 * 見出し名の末尾に `?` を付けると `(任意)` 扱い(省略可)になる。
 */
export function template(init: {
  h2: readonly string[];
  file?: string;
  docType?: string | null;
  repeatable?: boolean;
  /** true で「H2 の語彙が開いている」テンプレート(`h2_policy: open`)にする。 */
  openH2?: boolean;
}): TemplateSpec {
  const h2: TemplateHeading[] = init.h2.map((name) =>
    name.endsWith('?')
      ? { name: name.slice(0, -1), optional: true }
      : { name, optional: false },
  );
  return {
    file: init.file ?? 'docs/rules/process/template.md',
    docType: init.docType ?? 'process',
    h2,
    repeatable: init.repeatable ?? false,
    openH2: init.openH2 ?? false,
  };
}

/** リンクを読んだファイル 1 件を作る(M4 の入力)。 */
export function linkedFile(file: string, links: readonly DocLink[]): LinkedFile {
  return { file, links };
}

/** DocsModel を組み立てる。リンクを読んだファイル(M4 の入力)は省略すれば無し。 */
export function docsModel(docs: readonly ScannedDoc[], linked: readonly LinkedFile[] = []): DocsModel {
  return { docs, linked, roots: TEST_ROOTS };
}
