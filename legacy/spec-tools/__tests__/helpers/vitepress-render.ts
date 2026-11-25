/**
 * docs の**本物の VitePress の Markdown 描画器**を、本物の設定(`docs/.vitepress/markdown-options.ts`)で作る道具。
 * docs の依存が入っていない木(配布の木の一部)では `null` を返す(呼び手は読み飛ばす)。
 * **CI では読み飛ばさない**(12 回目 C12-2): `CI` があって依存が無ければ、この部品を読むテストのファイルが読み込みで赤になる。docs ジョブは `docs/` の `npm ci` を回す。
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reservedName } from '../../lib/kernel/html-allow-list.js';
import { BOOK_MARKDOWN_OPTIONS } from '../../../../docs/.vitepress/markdown-options.js';

const DOCS = path.resolve(import.meta.dirname, '../../../../docs');

/** VitePress の入口(docs の依存)。 */
export const VITEPRESS_ENTRY = path.join(DOCS, 'node_modules/vitepress/dist/node/index.js');

/**
 * CI で VitePress が無いときの説明(読み飛ばしてよい場合は null)。
 *
 * @param ci 環境変数 `CI` の値
 * @param installed VitePress の入口が実在するか
 */
export function vitepressMissingInCi(ci: string | undefined, installed: boolean): string | null {
  if (installed || ci === undefined || ci === '') return null;
  return `CI に docs の依存がありません(${VITEPRESS_ENTRY})。本物の描画器のテストを黙って飛ばさないよう、docs/ の npm ci を回してください`;
}

const missingInCi = vitepressMissingInCi(process.env['CI'], existsSync(VITEPRESS_ENTRY));
if (missingInCi !== null) throw new Error(missingInCi);

/** Markdown を HTML にする関数。 */
export type MarkdownRender = (source: string) => string;

/**
 * 描画器を作る。
 *
 * @returns 描画関数。VitePress が無ければ null
 */
export async function createBookRenderer(): Promise<MarkdownRender | null> {
  if (!existsSync(VITEPRESS_ENTRY)) return null;
  const { createMarkdownRenderer } = (await import(pathToFileURL(VITEPRESS_ENTRY).href)) as {
    createMarkdownRenderer: (srcDir: string, options: unknown, base: string, logger: unknown) => Promise<{ render: (src: string, env: unknown) => string }>;
  };
  const md = await createMarkdownRenderer('/tmp', BOOK_MARKDOWN_OPTIONS, '/', { info: () => undefined, warn: () => undefined, error: () => undefined });
  return (source) => md.render(source, { path: '/tmp/x.md', relativePath: 'x.md', frontmatter: {} });
}

/** コード(`<pre>` と `<code>`。VitePress が v-pre で描く)の外の HTML。 */
export function outsideCode(html: string): string {
  return html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, '');
}

/** 部品の式の属性(`:items` `:cells`)を除いた、タグに付いてはいけない属性(`style` は CSS のカスタムプロパティの宣言だけを無害化が通すので、別に見る)。 */
const FORBIDDEN_ATTRIBUTE = /\s(?:v-[a-z-]+|@[A-Za-z-]+|on[a-z]+)=|\s:(?!(?:items|cells)=)[A-Za-z-]+=/;

/** 描画結果のタグ(文字として出た `&lt;img onerror=…&gt;` と、引用符つきの属性の値の中の文字は見ない)に、付いてはいけない属性があるか。 */
export function hasForbiddenAttribute(html: string): boolean {
  return (html.match(/<[A-Za-z][^<>]*>/g) ?? []).some((tag) => FORBIDDEN_ATTRIBUTE.test(tag.replace(/="[^"]*"|='[^']*'/g, '=""')));
}

/** 監査の結果。 */
export interface BookAudit {
  /** 無害化した Markdown。 */
  readonly sanitized: string;
  /** 描画した HTML。 */
  readonly html: string;
  /** 見つけた問題(空なら注入は無い)。 */
  readonly issues: readonly string[];
}

/** 部品として属性の式を許すタグ。 */
const EXPRESSION_COMPONENTS: ReadonlySet<string> = new Set(['Fold', 'Term', 'PanZoom', 'Mode', 'Grid', 'Steps']);

/** タグとして現れてはいけないもの。 */
const FORBIDDEN_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base']);

/** Vue の構文木の節(使う欄だけ)。 */
interface VueNode {
  readonly type: number;
  readonly tag?: string;
  readonly content?: unknown;
  readonly props?: readonly VueProp[];
  readonly children?: readonly VueNode[];
}

/** Vue の属性(使う欄だけ)。 */
interface VueProp {
  readonly type: number;
  readonly name: string;
  readonly rawName?: string;
  readonly exp?: { readonly content: string };
  readonly value?: { readonly content: string };
}

/**
 * **Vue の構文木で注入を判定する道具**(字面の検索ではない)。本物の VitePress の描画器で描いた HTML を、Vue が読むのと同じ手順(`@vue/compiler-dom` の `baseParse`)で
 * 読み、次を問題とする: `v-pre` の外の補間(`{{ }}`)・式の属性(登録された部品の `:items` / `:cells` で JSON として読めるものを除く、`v-*` / `@*` / `:*`)・`on*` の属性・
 * 危険な `href` / `src`・危険な `style`・`script` などのタグ・SFC の `<script>` / `<style>` の巻き上げ。
 * さらに **`compile`(サイトが本文にかける Vue のコンパイル)の誤り**(閉じていないタグ・余分な閉じ・置き場の違う `<template #x>`)も問題とする(注入でなくてもサイトが壊れる)。
 *
 * @returns 監査の関数。VitePress か Vue のコンパイラが無ければ null
 */
export async function createBookAudit(sanitize: (source: string) => string): Promise<((source: string, options?: { readonly sanitize?: boolean }) => BookAudit) | null> {
  if (!existsSync(VITEPRESS_ENTRY)) return null;
  const require = createRequire(VITEPRESS_ENTRY);
  const { baseParse, compile } = require('@vue/compiler-dom') as {
    baseParse: (source: string, options: { onError: (error: Error) => void }) => { children: readonly VueNode[] };
    compile: (source: string, options: { onError: (error: Error) => void }) => unknown;
  };
  const { createMarkdownRenderer } = (await import(pathToFileURL(VITEPRESS_ENTRY).href)) as {
    createMarkdownRenderer: (srcDir: string, options: unknown, base: string, logger: unknown) => Promise<{ render: (src: string, env: unknown) => string }>;
  };
  const md = await createMarkdownRenderer('/tmp', BOOK_MARKDOWN_OPTIONS, '/', { info: () => undefined, warn: () => undefined, error: () => undefined });
  return (source, options = {}) => {
    const sanitized = options.sanitize === false ? source : sanitize(source);
    const env: { path: string; relativePath: string; frontmatter: object; sfcBlocks?: { scripts?: unknown[]; styles?: unknown[] } } = { path: '/tmp/x.md', relativePath: 'x.md', frontmatter: {} };
    const html = md.render(sanitized, env);
    const issues: string[] = [];
    if ((env.sfcBlocks?.scripts?.length ?? 0) + (env.sfcBlocks?.styles?.length ?? 0) > 0) issues.push('SFC の script / style が巻き上げられた');
    // サイトが実際にやる Vue のコンパイル(本文は 1 つの外側の div に入る)。閉じていないタグ・余分な閉じ・置き場の違うスロットはここで誤りになる
    const compileErrors: string[] = [];
    try {
      compile(`<div>${html}</div>`, { onError: (error) => compileErrors.push(error.message) });
    } catch (error) {
      compileErrors.push(error instanceof Error ? error.message : String(error));
    }
    if (compileErrors.length > 0) issues.push(`Vue のコンパイルの誤り: ${compileErrors[0]}`);
    let children: readonly VueNode[] = [];
    try {
      children = baseParse(html, { onError: () => undefined }).children;
    } catch (error) {
      return { sanitized, html, issues: [`Vue が読めない: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const visit = (nodes: readonly VueNode[], inPre: boolean): void => {
      for (const node of nodes) {
        if (node.type === 5 && !inPre) issues.push(`補間: ${JSON.stringify(node.content)}`);
        if (node.type !== 1) continue;
        const tag = node.tag ?? '';
        const pre = inPre || (node.props ?? []).some((prop) => prop.type === 6 && prop.name === 'v-pre');
        if (FORBIDDEN_TAGS.has(tag)) issues.push(`タグ ${tag}`);
        if (!pre) {
          for (const prop of node.props ?? []) {
            if (prop.type === 7) {
              const name = prop.rawName ?? prop.name;
              const expression = prop.exp?.content ?? '';
              const slot = tag === 'template' && prop.name === 'slot';
              const allowed = slot || (EXPRESSION_COMPONENTS.has(tag) && (name === ':items' || name === ':cells'));
              if (!allowed) issues.push(`ディレクティブ ${name}(${tag}) = ${expression}`);
              else if (!slot) {
                try {
                  if (!Array.isArray(JSON.parse(expression))) issues.push(`式の属性が配列の JSON でない: ${name}`);
                } catch {
                  issues.push(`式の属性が JSON として読めない: ${name} = ${expression}`);
                }
              }
            }
            if (prop.type === 6 && /^on/i.test(prop.name)) issues.push(`ハンドラの属性 ${prop.name}`);
            if (prop.type === 6 && prop.name === 'id' && prop.value !== undefined && reservedName(prop.value.content)) issues.push(`予約された id: ${prop.value.content}`);
            if (prop.type === 6 && (prop.name === 'href' || prop.name === 'src') && prop.value !== undefined) {
              const compact = prop.value.content.replace(/[\u0000- ]/g, '').toLowerCase();
              // 先頭の `//` `\\` `/\` `\/` はスキーム相対（別のオリジン）。`./` で始まる相対パスの途中のバックスラッシュは同じオリジンの中なので問題にしない
              if (/^(javascript|data|vbscript):|^[\\/]{2}/.test(compact)) issues.push(`危険な ${prop.name}: ${prop.value.content}`);
            }
            if (prop.type === 6 && prop.name === 'style' && prop.value !== undefined && /url\s*\(|expression|@import/i.test(prop.value.content)) issues.push(`危険な style: ${prop.value.content}`);
          }
        }
        visit(node.children ?? [], pre);
      }
    };
    visit(children, false);
    return { sanitized, html, issues };
  };
}
