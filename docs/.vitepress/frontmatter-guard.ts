/**
 * ハンドブック(VitePress)が読む Markdown の頭(フロントマター)を、**実行しない読み方に固定する**関所。
 *
 * VitePress 1.6.4 が同梱する gray-matter と `vitepress-sidebar` が呼ぶ gray-matter は、既定の設定だと
 * 先頭が `---js`(`---javascript`)のファイルの頭を `eval` する(読むだけで任意のコードが動く)。
 * `docs/` の下の Markdown は敵対的な PR に含まれうるので、三段で塞ぐ。
 *
 *   1. `SAFE_GRAY_MATTER_OPTIONS`: VitePress 自身の経路(`markdown.frontmatter.grayMatterOptions`)で、
 *      実行するエンジン(js / javascript / coffee / coffeescript / cson)を、使われたら例外を投げる関数に差し替える。
 *   2. `disableExecutingGrayMatterEngines`: `vitepress-sidebar` が import する gray-matter(docs の node_modules の 1 本)の
 *      **既定のエンジンの表そのもの**を差し替える(gray-matter は呼ぶたびに `Object.assign({}, engines, …)` で
 *      この表を写すので、オプションを渡さない呼び手も拒む関数に当たる)。4 回目 C4-1 の根治。
 *   3. `assertNoExecutableFrontmatter`: **設定を読む時点で、`docs/` の全 `.md` を先に見て**、
 *      (a) 1 行目(改行まで。読む長さで切らない)が `---` で始まるのに `/^---[ \t]*$/` でないファイル、
 *      (b) VitePress の取り込み(`<!--@include: …-->`)を書いたファイルを拒む。取り込みの先は VitePress 同梱の
 *      gray-matter が**オプションなし**で読み、根の外も指せる(1・2 段が届かない)ので、取り込みそのものを禁じる(C4-2)。
 *      (c) VitePress の動的ルートの材料(`[x].md`・`*.paths.*`。`.paths.*` は設定の外のコードとして実行される)を拒む(C5-5)。
 *
 * 本文(頭より後ろ)の関所は `body-guard.ts`(Vue のテンプレートとして実行しない形に閉じる。C5-1)。
 *
 * 仕様側の `legacy/spec-tools/lib/io/front-matter.ts`(`DELIMITER_LINE` = `---` だけを受ける)と同じ規則である。
 * 依存を持たない(node の標準と、docs の node_modules にある gray-matter を差し替えのために引くだけ)。
 */

import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

/** 実行するエンジンの名前(gray-matter の別名も含む)。使われたら例外を投げる。 */
const EXECUTING_ENGINES = ['js', 'javascript', 'coffee', 'coffeescript', 'cson'] as const

function refuse(name: string): never {
  throw new Error(`フロントマターの言語指定 "${name}" は受け付けません(評価されるため)。頭は "---" だけで開き、YAML で書いてください`)
}

function refusingEngine(name: string): { parse: () => never; stringify: () => never } {
  return { parse: () => refuse(name), stringify: () => refuse(name) }
}

/** VitePress の `markdown.frontmatter` に渡す(gray-matter のエンジンを差し替える)。 */
export const SAFE_GRAY_MATTER_OPTIONS = {
  grayMatterOptions: {
    engines: Object.fromEntries(EXECUTING_ENGINES.map((name) => [name, refusingEngine(name)])),
  },
}

/** gray-matter の既定のエンジンの表(`require('gray-matter').engines`。`lib/engines.js` の module.exports と同じもの)。 */
type EngineTable = Record<string, unknown>

/**
 * gray-matter の**既定のエンジンの表**から、実行するエンジンを拒む関数に差し替える(同じ表への 2 回目以降は何もしない)。
 *
 * gray-matter 4 の `defaults()` は呼ぶたびに `Object.assign({}, engines, opts.parsers, opts.engines)` で
 * この表を写し、`engine()` は名前か別名(js → javascript、coffee / cson → coffee)で引く。表の側を差し替えれば、
 * オプションを渡さない呼び手(`vitepress-sidebar` の `getValueFromFrontmatter`)も拒む関数に当たる。
 *
 * @param engines 差し替える表(既定は docs の node_modules の gray-matter。テストは別の表を渡せる)
 * @returns 差し替えた後の表
 */
export function disableExecutingGrayMatterEngines(engines: EngineTable = loadGrayMatterEngines()): EngineTable {
  for (const name of EXECUTING_ENGINES) engines[name] = refusingEngine(name)
  return engines
}

/** `vitepress-sidebar` が import するのと同じ gray-matter(docs の node_modules に 1 本)の既定のエンジンの表。 */
function loadGrayMatterEngines(): EngineTable {
  const required = createRequire(import.meta.url)('gray-matter') as { engines?: unknown }
  if (typeof required.engines !== 'object' || required.engines === null) {
    throw new Error('gray-matter のエンジンの表を見つけられません(版が変わった可能性があります)。関所を直すまでハンドブックを開きません')
  }
  return required.engines as EngineTable
}

/** 1 行目として読む上限。これを超えても改行が無い `---` 始まりのファイルは「読めない」として拒む(fail-closed)。 */
const FIRST_LINE_LIMIT_BYTES = 64 * 1024

/** 1 度に読む長さ。 */
const CHUNK_BYTES = 4096

/** 頭の開きとして受ける唯一の形(spec-tools の `DELIMITER_LINE` と同じ)。 */
const DELIMITER_LINE = /^---[ \t]*$/

/**
 * VitePress 1.6.4 の取り込みの式(`processIncludes` の `includesRE` と同じ)。
 * 中身が空(`<!--@include:-->`)は VitePress が何もしないので見逃してよいが、関所は形が出たら一律に拒む。
 */
const INCLUDE_DIRECTIVE = /<!--\s*@include:\s*(.*?)\s*-->/

/**
 * 歩かない名前(根の直下だけ)。VitePress の `srcExclude`(`node_modules/**` / `.vitepress/**`)は根の直下にしか効かないので、
 * 入れ子の同名ディレクトリ(例: `knowledge/node_modules/`)は VitePress が読む → こちらも歩く。
 */
const SKIPPED_AT_ROOT: ReadonlySet<string> = new Set(['node_modules', '.vitepress'])

/**
 * 1 行目(BOM を除き、改行の手前まで。末尾の `\r` 1 つは除く)が、実行されうる開きか。
 *
 * gray-matter は先頭が `---` で、4 文字目が `-` でなければ、改行までの残り(`String#trim` したもの)を言語名にする。
 * `trim` は NBSP・行区切り(U+2028)・`\r` も削るので、拒む側を数えず、**許す形(`---` と空白・タブだけ)を 1 つに決める**。
 *
 * @param head ファイルの先頭(1 行目を含む文字列。改行より後ろは見ない)
 */
export function hasLanguageTag(head: string): boolean {
  const text = head.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return false
  if (text.charAt(3) === '-') return false
  const newline = text.indexOf('\n')
  const firstLine = (newline === -1 ? text : text.slice(0, newline)).replace(/\r$/, '')
  return !DELIMITER_LINE.test(firstLine)
}

/** 1 行目の読み取りの結果。`truncated` は上限まで読んでも改行が無かった(= 判定できない)こと。 */
interface FirstLine {
  readonly text: string
  readonly truncated: boolean
}

/** 先頭から改行が出るまで読む(上限 `FIRST_LINE_LIMIT_BYTES`)。`---` で始まらなければ 1 塊で切り上げる。 */
function readFirstLine(file: string): FirstLine {
  const fd = openSync(file, 'r')
  try {
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const buffer = Buffer.alloc(CHUNK_BYTES)
      const length = readSync(fd, buffer, 0, CHUNK_BYTES, total)
      if (length === 0) return { text: Buffer.concat(chunks).toString('utf8'), truncated: false }
      const chunk = buffer.subarray(0, length)
      const newline = chunk.indexOf(0x0a)
      if (newline !== -1) {
        chunks.push(chunk.subarray(0, newline + 1))
        return { text: Buffer.concat(chunks).toString('utf8'), truncated: false }
      }
      chunks.push(chunk)
      total += length
      const sofar = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
      // `---` で始まらないと分かれば、行の残りは判定に要らない。
      if (sofar.length >= 3 && !sofar.startsWith('---')) return { text: sofar, truncated: false }
      if (total >= FIRST_LINE_LIMIT_BYTES) return { text: sofar, truncated: true }
    }
  } finally {
    closeSync(fd)
  }
}

/** 1 行目が実行されうる開きか、長すぎて判定できない `---` 始まりか。 */
function hasUnsafeOpening(file: string): boolean {
  const { text, truncated } = readFirstLine(file)
  if (truncated) return text.replace(/^\uFEFF/, '').startsWith('---')
  return hasLanguageTag(text)
}

/**
 * 本文に VitePress の取り込みの指令があるか(コードブロックの中も数える。VitePress は描画の前に生の本文を置き換える)。
 *
 * @param source Markdown の本文
 */
export function hasIncludeDirective(source: string): boolean {
  return INCLUDE_DIRECTIVE.test(source)
}

function collect(dir: string, found: string[], seen: Set<string>, atRoot: boolean, wanted: (name: string) => boolean): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (atRoot && SKIPPED_AT_ROOT.has(entry.name)) continue
    const target = path.join(dir, entry.name)
    // リンクの先も辿る(VitePress の走査はリンクを辿る)。同じ実体は 1 度だけ見る。
    const stat = statSync(target, { throwIfNoEntry: false })
    if (stat === undefined) continue
    if (stat.isDirectory()) {
      const key = `${stat.dev}:${stat.ino}`
      if (seen.has(key)) continue
      seen.add(key)
      collect(target, found, seen, false, wanted)
    } else if (stat.isFile() && wanted(entry.name)) {
      found.push(target)
    }
  }
}

function markdownFiles(root: string): string[] {
  const files: string[] = []
  collect(root, files, new Set(), true, (name) => name.toLowerCase().endsWith('.md'))
  return files
}

/**
 * VitePress の動的ルート(`[x].md` と隣の `[x].paths.{js,ts,mjs,mts}`)の材料になる名前か(5 回目 C5-5)。
 * `.paths.*` は設定の外のコードとして設定の読み込みと同じ時点で実行されるので、docs の木に**置くこと自体**を拒む
 * (`[` を含む `.md` も、`.paths.*` の拡張子の種類も数えず、形が出たら一律に拒む)。
 *
 * @param name ファイル名(ディレクトリを含まない)
 */
export function isDynamicRouteName(name: string): boolean {
  const lower = name.toLowerCase()
  return /\.paths\./.test(lower) || (lower.endsWith('.md') && /[[\]]/.test(lower))
}

/**
 * `root` の下の動的ルートの材料(`[x].md`・`*.paths.*`)を返す。
 *
 * @param root ドキュメントの根(VitePress の `srcDir`)
 */
export function findDynamicRouteFiles(root: string): string[] {
  const files: string[] = []
  collect(root, files, new Set(), true, isDynamicRouteName)
  return files.map((file) => path.relative(root, file))
}

/**
 * `root` の下の全 `.md` のうち、頭に言語指定(実行されうる開き)を持つもの・開きの行が長すぎて判定できないものを返す。
 *
 * @param root ドキュメントの根(VitePress の `srcDir`)
 */
export function findExecutableFrontmatter(root: string): string[] {
  return markdownFiles(root)
    .filter((file) => hasUnsafeOpening(file))
    .map((file) => path.relative(root, file))
}

/**
 * `root` の下の全 `.md` のうち、VitePress の取り込み(`<!--@include: …-->`)を書いたものを返す。
 *
 * @param root ドキュメントの根(VitePress の `srcDir`)
 */
export function findIncludeDirectives(root: string): string[] {
  return markdownFiles(root)
    .filter((file) => hasIncludeDirective(readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
}

/**
 * 1 つでも有れば例外を投げる(VitePress の設定を読む時点で呼ぶ。dev / build ともここで止まる)。
 * 先に gray-matter の既定のエンジンを差し替える(関所の判定をすり抜ける形が見つかっても、評価には至らない)。
 */
export function assertNoExecutableFrontmatter(root: string): void {
  disableExecutingGrayMatterEngines()
  const offenders = findExecutableFrontmatter(root)
  if (offenders.length > 0) {
    throw new Error(
      `フロントマターに言語指定(---js など)を持つ・開きの行が長すぎて読めない Markdown があります。評価されうるため読みません: ${offenders.join(', ')}` +
        '(頭は "---" だけで開き、YAML で書いてください)',
    )
  }
  const includes = findIncludeDirectives(root)
  if (includes.length > 0) {
    throw new Error(
      `VitePress の取り込み(<!--@include: …-->)を書いた Markdown があります。取り込みの先は頭が評価されうる読み方で読まれ、根の外も指せるため受け付けません: ${includes.join(', ')}`,
    )
  }
  const dynamic = findDynamicRouteFiles(root)
  if (dynamic.length > 0) {
    throw new Error(
      `VitePress の動的ルート([x].md / *.paths.*)の材料があります。.paths.* は設定の外のコードとして実行されるため受け付けません: ${dynamic.join(', ')}`,
    )
  }
}
