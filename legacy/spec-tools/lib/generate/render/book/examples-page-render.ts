/**
 * 「書き方の例」章(docs/book/examples.html)の組み立て。
 *
 * カタログ(examples-page-catalog*.ts)が指す抜粋を実ファイルから引き、Markdown に組む。
 * **未解決の印(参照先が無い/印はあるが参照されない)・1 例 40 行超は generate エラーにする**
 * (code-examples.md の規約どおり)—— この章だけが持つ特別な鮮度保証であり、
 * 例が実物とずれた瞬間に `npm run generate` / `generate:check` が落ちる。
 */

import { collectSigns } from '../../prose.js';
import {
  MAX_EXAMPLE_LINES,
  countLines,
  extractRegion,
  extractSection,
  readRepoFile,
  regionNamesIn,
} from '../code-examples.js';
import type { ExampleCategory, ExampleStep, ExcerptSpec } from './examples-page-types.js';

/** 抜粋の解決に失敗したものを集める(1 つずつ落とさず、まとめて報告する)。 */
interface Resolution {
  readonly errors: string[];
  readonly referencedCodeMarks: Set<string>;
  /** 生成対象のリポジトリルート(抜粋を読む起点)。 */
  readonly root: string;
  /** 印が実際に置かれているファイルの母集合(走査の結果。宣言ではない)。 */
  readonly sourceFiles: readonly string[];
  /** この回の生成結果を当てた本文(ファイル → 本文)。あればディスクより先に引く。 */
  readonly generatedTexts: ReadonlyMap<string, string>;
}

/** 抜粋 1 つの解決結果。`fenced` はコードフェンス(コード・仕様の節)、`quote` は引用(標識。Markdown の本文を含む)。 */
export type ResolvedExcerpt =
  | { readonly kind: 'fenced'; readonly lang: 'ts' | 'sql' | 'md'; readonly body: string }
  | { readonly kind: 'quote'; readonly body: string };

/** 解決済みの抜粋 1 つ分(ラベル + 前振り + 抜粋 + 注)。 */
export interface ResolvedStep {
  readonly label: string;
  readonly bridge?: string;
  readonly excerpt?: ResolvedExcerpt;
  readonly note?: string;
}

/** 解決済みの実例。 */
export interface ResolvedExample {
  readonly title: string;
  readonly intro: string;
  readonly steps: readonly ResolvedStep[];
}

/** 解決済みのカテゴリ(カタログの形のまま、抜粋だけが本文になっている)。共有のものを読む。 */
export interface ResolvedCategory {
  readonly title: string;
  readonly intro: string;
  readonly examples: readonly ResolvedExample[];
}

/**
 * カタログ全体の抜粋を実ファイルから解決する。未解決の印・上限超過が 1 件でもあれば例外を投げる
 * (呼び出し元の DocGenerator が `npm run generate` を落とすのに使う)。
 *
 * @param categories 章のカタログ(編集方針)
 * @param root 生成対象のリポジトリルート(抜粋を読む起点)
 * @param sourceFiles 印が実際に置かれているファイルの母集合(走査の結果)
 * @param generatedTexts この回の生成結果を当てた本文(`examples-page-overlay.ts`)。仕様の抜粋はディスクより先にここから引く
 */
export function resolveExamples(
  categories: readonly ExampleCategory[],
  root: string,
  sourceFiles: readonly string[],
  generatedTexts: ReadonlyMap<string, string> = new Map(),
): readonly ResolvedCategory[] {
  const resolution: Resolution = { errors: [], referencedCodeMarks: new Set(), root, sourceFiles, generatedTexts };
  const resolved = categories.map((category) => resolveCategory(category, resolution));
  checkUnreferencedMarks(resolution);
  if (resolution.errors.length > 0) {
    throw new Error(
      `書き方の例(docs/book/examples.md)の生成に失敗しました:\n- ${resolution.errors.join('\n- ')}`,
    );
  }
  return resolved;
}

function resolveCategory(category: ExampleCategory, resolution: Resolution): ResolvedCategory {
  return {
    title: category.title,
    intro: category.intro,
    examples: category.examples.map((example) => ({
      title: example.title,
      intro: example.intro,
      steps: example.steps.map((step) => resolveStep(step, resolution)),
    })),
  };
}

function resolveStep(step: ExampleStep, resolution: Resolution): ResolvedStep {
  const excerpt = step.excerpt === undefined ? null : resolveExcerpt(step.excerpt, resolution);
  return {
    label: step.label,
    ...(step.bridge === undefined ? {} : { bridge: step.bridge }),
    ...(excerpt === null ? {} : { excerpt }),
    ...(step.note === undefined ? {} : { note: step.note }),
  };
}

/** 抜粋を実ファイルから引き、検査する。失敗は `resolution.errors` に積んで null を返す(まとめて報告するため)。 */
function resolveExcerpt(excerpt: ExcerptSpec, resolution: Resolution): ResolvedExcerpt | null {
  const source = resolution.generatedTexts.get(excerpt.file) ?? readRepoFile(resolution.root, excerpt.file);
  if (source === null) {
    // 抜粋元が空文字は、置き場の配置が抜粋元の置き場を決められなかった(`examples-sources.ts`)。鮮度エラーとして名指す(前提の失敗)。
    resolution.errors.push(excerpt.file === '' ? `抜粋元の置き場を置き場の配置から決められない: ${excerptLocator(excerpt)}` : `ファイルが無い: ${excerpt.file}`);
    return null;
  }
  if (excerpt.kind === 'code') {
    resolution.referencedCodeMarks.add(markKey(excerpt.file, excerpt.region));
    const body = extractRegion(source, excerpt.region);
    return checked(body, excerpt.lang, `${excerpt.file}#${excerpt.region}`, resolution);
  }
  if (excerpt.kind === 'spec') {
    const body = extractSection(source, excerpt.heading);
    return checked(body, 'md', `${excerpt.file}#${excerpt.heading}`, resolution);
  }
  const found = collectSigns(source).find((candidate) => candidate.includes(excerpt.includes));
  return checked(found ?? null, 'md', `${excerpt.file} の標識「${excerpt.includes}」`, resolution, true);
}

/** 抜粋の指し先(印・見出し・標識)の説明。 */
function excerptLocator(excerpt: ExcerptSpec): string {
  if (excerpt.kind === 'code') return `印 ${excerpt.region}`;
  if (excerpt.kind === 'spec') return `見出し ${excerpt.heading}`;
  return `標識「${excerpt.includes}」`;
}

/** 抜粋の本文を検査する(未解決・上限超過は errors に積んで null)。null の本文は「見つからなかった」の合図。 */
function checked(
  body: string | null,
  lang: 'ts' | 'sql' | 'md',
  locator: string,
  resolution: Resolution,
  quote = false,
): ResolvedExcerpt | null {
  if (body === null) {
    resolution.errors.push(`未解決の印/見出し/標識: ${locator} が見つからない`);
    return null;
  }
  const lines = countLines(body);
  if (lines > MAX_EXAMPLE_LINES) {
    resolution.errors.push(`例が長すぎる: ${locator}(${lines} 行 > ${MAX_EXAMPLE_LINES} 行)`);
    return null;
  }
  return quote ? { kind: 'quote', body } : { kind: 'fenced', lang, body };
}

function markKey(file: string, region: string): string {
  return `${file}#${region}`;
}

/** 印はあるがどの例からも参照されていないコードファイルを検出する。 */
function checkUnreferencedMarks(resolution: Resolution): void {
  for (const file of resolution.sourceFiles) {
    const source = readRepoFile(resolution.root, file);
    if (source === null) {
      // 走査が見つけたファイルなので読めないことは通常ありえない(走査と読み出しの間に
      // 消えた場合だけ)。黙って飛ばさず、他の未解決と同じ字面で報告する。
      resolution.errors.push(`印を持つはずのファイルを読めない: ${file}`);
      continue;
    }
    for (const name of regionNamesIn(source)) {
      if (!resolution.referencedCodeMarks.has(markKey(file, name))) {
        resolution.errors.push(`未参照の印: ${file}#${name} — どの例からも参照されていない(章から消すか印を消す)`);
      }
    }
  }
}
