/**
 * docs/rules と docs/specs を走査して DocsModel を構築するローダー。
 *
 * ファイル I/O を行うのはこのモジュール(と template.ts / CLI)だけであり、
 * Markdown → 見出しの変換は parse-markdown の純粋関数に委ねる(リンクの実在は `link-scan.ts` が持つ)
 * (規約: scripts-code-quality.md)。
 * 検証器は fs に触れないため、テンプレートの解決という
 * 「ファイルシステムを見ないと分からないこと」もここで済ませてモデルに載せる。
 *
 * 構築時に積む Finding は M1(フロントマターが読めない・閉じていない・無い)だけで、
 * 個々の必須項目や ID・参照の検査は検証器(M1〜M6)が行う。
 */

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readFrontMatter } from '../../io/front-matter.js';
import { detectRepoRoot, isDirectory, toRelative, walkFiles } from '../../io/paths.js';
import { frontmatterDelimiter, parseMarkdown } from './parse-markdown.js';
import { createTemplateResolver, type TemplateResolver } from './template.js';
import type { DocsModel, ScannedDoc } from './types.js';
import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { ProductRoots } from '../product/types.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのはフロントマターの取り出しまで。 */
const LOADER_VERIFIER_ID = 'M1';

/** ローダーの任意設定。 */
export interface LoadDocsOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
  /**
   * サイトルート相対リンク(`/rules/...`)とテンプレート探索の上限になるディレクトリ。
   * 省略時は走査ルートの親(= docs/)。
   */
  readonly docsRoot?: string;
  /** 製品が宣言した根(仕様の木・ドメイン知識の位置)。 */
  readonly roots: ProductRoots;
}

/** loadDocs の結果。 */
export interface LoadDocsResult {
  /** 構築できたモデル。走査ルート自体が無い環境では null。 */
  readonly model: Pick<DocsModel, 'docs' | 'roots'> | null;
  /** 構築中に検出した M1 違反。model が非 null でも空とは限らない。 */
  readonly findings: Finding[];
}

/**
 * 走査ルート配下の Markdown を読み、M 群の入力になるモデルを構築する。
 *
 * ルートは docs/rules(ルール文書)と docs/specs(仕様文書)の 2 つで、
 * どちらも「フロントマターを持つ Markdown」という同じ形をしているため読み方は変わらない。
 * 何をどこまで検査するかは doc_type ごとの表(schema.ts)が決め、ローダーは区別しない。
 *
 * `template.md` / `template.{doc_type}.md` は文書ではなくテンプレートなので、
 * 走査対象から外す(プレースホルダーの id を持つため、そのまま検査すると偽陽性になる)。
 *
 * @param root 走査ルートの絶対パス(docs/rules または docs/specs)
 * @param options 相対パス基準などの任意設定
 * @returns モデルと M1 違反のリスト
 */
export function loadDocs(root: string, options: LoadDocsOptions): LoadDocsResult {
  if (!isDirectory(root)) return { model: null, findings: [] };

  const repoRoot = options.repoRoot ?? detectRepoRoot(root);
  const docsRoot = options.docsRoot ?? dirname(root);
  const resolver = createTemplateResolver(docsRoot, repoRoot);

  const findings: Finding[] = [];
  const docs: ScannedDoc[] = [];
  for (const absolute of walkFiles(root, isScannedDocFile)) {
    const doc = readScannedDoc(absolute, { repoRoot, docsRoot, resolver }, findings);
    if (doc !== null) docs.push(doc);
  }
  return { model: { docs, roots: options.roots }, findings };
}

/** 文書として読む対象か。テンプレートは文書ではない。 */
function isScannedDocFile(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  return !/^template(\..+)?\.md$/.test(name);
}

/** readScannedDoc が使う解決済みのパス情報。 */
interface LoadContext {
  readonly repoRoot: string;
  readonly docsRoot: string;
  readonly resolver: TemplateResolver;
}

/** 1 ファイルを読んで ScannedDoc を作る。フロントマターが取り出せない場合は Finding を積んで null。 */
function readScannedDoc(absolute: string, ctx: LoadContext, findings: Finding[]): ScannedDoc | null {
  const file = toRelative(ctx.repoRoot, absolute);
  const source = readSource(absolute, file, findings);
  if (source === null) return null;

  const frontmatter = readFrontmatter(source, file, findings);
  if (frontmatter === null) return null;

  const parsed = parseMarkdown(source);
  const docType = stringField(frontmatter, 'doc_type');
  return {
    file,
    docType,
    id: stringField(frontmatter, 'id'),
    frontmatter,
    headings: parsed.headings,
    template: ctx.resolver.resolve(absolute, docType),
  };
}

/** ファイルを読む。読めない場合は Finding を積んで null。 */
function readSource(absolute: string, file: string, findings: Finding[]): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch (cause) {
    findings.push(
      makeFinding(LOADER_VERIFIER_ID, {
        message: `ファイルを読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`,
        location: { file },
        suggestion: 'ファイルの権限とパスを確認する',
      }),
    );
    return null;
  }
}

/**
 * YAML フロントマターを取り出す。壊れている・閉じていない・存在しない場合は Finding を積んで null。
 *
 * 閉じ区切りの検査を YAML の読み取り(`readFrontMatter`)と別に行っているのは、読み取りが閉じ `---` の無い
 * ファイルを「末尾までがフロントマター」と解釈して**そのまま通してしまう**ため。
 * 途中で切れた文書は、本文が丸ごと失われていても読み取りからは正常に見える。
 */
function readFrontmatter(
  source: string,
  file: string,
  findings: Finding[],
): Readonly<Record<string, unknown>> | null {
  if (frontmatterDelimiter(source) === 'unclosed') {
    findings.push(
      makeFinding(LOADER_VERIFIER_ID, {
        message: 'YAML フロントマターが "---" で閉じられていません',
        location: { file },
        suggestion:
          'フロントマターの終わりに "---" の行を置く。本文ごと失われている場合は、書きかけ・保存の失敗でファイルが途中で切れていないかを確認する',
      }),
    );
    return null;
  }

  const result = readFrontMatter(source);
  if (result.kind === 'rejected') {
    findings.push(
      makeFinding(LOADER_VERIFIER_ID, {
        message: result.message,
        location: { file },
        suggestion: result.suggestion,
      }),
    );
    return null;
  }
  if (result.kind === 'ok' && Object.keys(result.data).length > 0) return result.data;

  findings.push(
    makeFinding(LOADER_VERIFIER_ID, {
      message: 'YAML フロントマターがありません',
      location: { file },
      suggestion:
        'ファイル先頭を "---" で開き、doc_type と scope から始まる YAML を書いて "---" で閉じる(frontmatter_policy)',
    }),
  );
  return null;
}

/** フロントマターの文字列項目を読む。文字列でなければ null。 */
function stringField(
  frontmatter: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = frontmatter[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
