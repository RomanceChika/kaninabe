/**
 * ハンドブック(VitePress)の Markdown の**本文**を、Vue のテンプレートとして**実行しない**形に閉じる関所(5 回目 C5-1)。
 *
 * VitePress は各 `.md` を描画した HTML を Vue の SFC の `<template>` にして、build のときに Node 上で SSR する。
 * 本文の `{{ 式 }}`・`v-*` / `:x` / `@x` / `#x` の指令・`<script setup>`(SFC に巻き上げられる)・`<component :is>` は
 * そのまま Node で実行される。`docs/` の下の Markdown は敵対的な PR に含まれうる(頭の関所 `frontmatter-guard.ts` と同じ前提)ので、
 * 拒否の表ではなく**許可の表**で閉じる。
 *
 *   0. **手書きの生の HTML は許可表だけ**: 全ページで、Markdown に書いた生の HTML(markdown-it の
 *      `html_block` / `html_inline`)のうち、注釈(`<!-- … -->`)と属性の無い書式のタグ(`RAW_HTML_TAGS`)だけをそのまま通し、
 *      ほかは**文字として**描く(`<script setup>`・`<style>`・`<component :is>`・属性つきのタグ・`</div>` は全部ただの文字になる)。
 *   1. **本文は v-pre**: 全ページで、描画した本文(根の段の塊)を `<div v-pre>` で包む。Vue は中の `{{ }}` も
 *      指令も文字として扱う。例外は mermaid の図(`<Mermaid>` 部品。根の段の図だけ包みの外に置く)。
 *   2. **描画結果の許可表**(全ページ): VitePress が描いた HTML を Vue と同じ読み方(`@vue/compiler-dom` の `parse`)で読み、
 *      Vue が評価するもの(補間・指令・部品)は許可表に載ったものだけを通す。
 *      - 補間(`{{ }}`)は v-pre の外に 1 つも置けない(包みを `</div>` で抜けても、ここで止まる)。
 *      - 部品は `Mermaid`(と mermaid の描画が使う `Suspense`)だけ。`<component>`・`is="vue:…"`・`<slot>` は許さない。
 *      - 指令は `<template #名前>`(静的な名前・式なし)だけ。
 *      - v-pre の中でも、`script` / `style` などのタグ・`on*` の属性・`javascript:` などの URL・`srcdoc` は許さない(静的な HTML として出るため)。
 *        同じサイトの外への送信先(`action` / `formaction`)・基点の付け替え(`xml:base`)・同じ文書の外を指す `url(…)`(SVG の表示の属性)も許さない(8 回目 C8-7)。
 *        `style` の属性はカスタムプロパティの宣言と、包み・表の揃えが付ける字面だけ(`url()`・エスケープを含む CSS は通さない。7 回目 C7-8)。
 *      - SFC の `<script>` / `<style>` の巻き上げ・頭の `head`(ページの `<head>` に任意のタグを足す)も許さない。
 *   3. **取り込みの禁止**: コード片の取り込み `<<< @/…`(根の外のファイルを読んで出力に埋める)は、構文木に出た時点で拒む。
 *
 * 許可表の外が 1 つでもあれば、ページの描画が例外になり build / dev は止まる(そのページは出力されない)。
 *
 * 前提: この関所は「docs を build する木は信頼できる設定(`docs/.vitepress/`)と依存を持つ」ことを前提にする。
 * `.vitepress/` のコードそのものを書き換える PR は、ここでは止まらない(docs の入口の README の「信頼できない木で build しない」)。
 *
 * @oversize 超える理由: 生の HTML の許可表・v-pre の包み・描画結果の許可表は 1 つの関所の 3 段で、互いの前提(どの字句を文字にしたら
 *   どの形が描画結果に残りうるか)を 1 か所で読み通せないと、片方だけを緩める変更に気づけないため。
 * @split-review 割る案と結果: 描画結果の許可表(auditRenderedBody)だけを別のファイルに出す案は、markdown-it の字句の段と
 *   描画の段の対応が 2 つのファイルに割れ、許可表の片側の変更が他方の前提を壊しても読み手が気づきにくいので採らない。
 */

import { createRequire } from 'node:module'

/** どのページでも許す部品(mermaid の図の描画。`vitepress-plugin-mermaid` の出力の形)。 */
export const DIAGRAM_COMPONENTS: readonly string[] = ['Mermaid', 'Suspense']

/** 手書きのページで生のまま通すタグ(属性なし・開きと閉じ・空要素だけ)。ほかの生の HTML は文字として描く。 */
export const RAW_HTML_TAGS: ReadonlySet<string> = new Set([
  'br', 'wbr', 'code', 'kbd', 'samp', 'var', 'sub', 'sup', 'b', 'i', 'u', 's', 'em', 'strong', 'small', 'mark', 'del', 'ins', 'details', 'summary',
])

/**
 * 生の注釈 1 つ。HTML の注釈の決まり(本文が `>` / `->` で始まらない・`<!--` / `-->` / `--!>` を含まない・`<!-` で終わらない)を満たすものだけ。
 * ブラウザは `<!-->` と `<!--->` をその場で閉じ、`--!>` でも閉じるので、満たさない注釈は後ろの文字を生の HTML として読ませる(6 回目 C6-6)。
 */
const RAW_COMMENT = /^<!--(?!>|->)(?:(?!-->|--!>|<!--)[\s\S])*(?<!<!-)-->$/

/** 属性の無いタグ 1 つ(`<br>` `<br/>` `<br />` `</code>`)。 */
const RAW_SIMPLE_TAG = /^<(\/?)([A-Za-z][A-Za-z0-9]*)\s*(\/?)>$/

/**
 * 手書きのページの生の HTML(1 字句の中身)を、そのまま通してよいか。注釈 1 つか、`RAW_HTML_TAGS` の属性の無いタグ 1 つだけ。
 *
 * @param content markdown-it の `html_block` / `html_inline` の中身
 */
export function isAllowedRawHtml(content: string): boolean {
  const text = content.trim()
  if (RAW_COMMENT.test(text)) return true
  const match = RAW_SIMPLE_TAG.exec(text)
  return match !== null && RAW_HTML_TAGS.has((match[2] ?? '').toLowerCase())
}

/** v-pre の中でも置けないタグ(静的な HTML として出るだけで害がある・SFC として抜き出されうる)。 */
const FORBIDDEN_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'noscript',
  'slot',
  'component',
  // SVG のアニメーション(別の属性の値を書き換える。`href` を `javascript:` にできる。6 回目 C6-6)。小文字で比べる。
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  // MathML の動作の要素(`actiontype` で状態行・切り替えを起こす。7 回目 C7-8)。
  'maction',
  // `noscript` と同じ「中身を生の文字として読む」要素(ブラウザは `</xmp>` まで中身をタグとして読まない。Vue の読み方と食い違う。8 回目 C8-7)。
  'xmp',
  'noembed',
  'noframes',
  'plaintext',
  // 別の文書を埋め込む要素(iframe と同じ。8 回目 C8-7)。
  'portal',
  'fencedframe',
])

/** 送信先の属性(8 回目 C8-7)。値は同じサイトの根からのパス(`/…`。画面の見本が描くログアウトの `<form action="/api/auth/logout">` の形)だけ。 */
const FORM_TARGET_ATTRIBUTES: ReadonlySet<string> = new Set(['action', 'formaction'])

/** 送信先に許す値(制御文字・空白を除いた綴り): `/` で始まり、2 文字目が `/` でも `\` でもない(外のサイト・scheme・相対の綴りは通さない)。 */
const SAME_SITE_PATH = /^\/(?![\/\\])[^\\]*$/

/** 相対 URL の基点を付け替える属性(`<base>` と同じ働き。8 回目 C8-7)。 */
const BASE_ATTRIBUTES: ReadonlySet<string> = new Set(['xml:base', 'xlink:base'])

/** CSS の値(`url()` を含みうる)を取る SVG の表示の属性(8 回目 C8-7)。 */
const CSS_URL_ATTRIBUTES: ReadonlySet<string> = new Set(['fill', 'stroke', 'filter', 'mask', 'clip-path', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor'])

/**
 * `style` の外の属性の値に、同じ文書の中(`#id`)でない `url(` の参照があるか(SVG の表示の属性 `fill` / `stroke` / `filter` / `mask` /
 * `clip-path` / `marker-*` / `cursor` は CSS の `url()` を値に取り、外の文書を取りに行く。8 回目 C8-7)。表示の属性の値の CSS のエスケープ(`\`)も拒む
 * (`u\72l(…)` は CSS では `url(…)` と読まれ、字面の `url(` の検出を抜ける)。
 *
 * @param name 属性の名前(小文字)
 * @param value 属性の値(Vue が実体参照を解いたもの)
 */
function hasForeignCssUrl(name: string, value: string): boolean {
  const lower = value.toLowerCase()
  if (CSS_URL_ATTRIBUTES.has(name) && lower.includes('\\')) return true
  return [...lower.matchAll(/url\(\s*['"]?\s*(.?)/g)].some((match) => match[1] !== '#')
}

/**
 * URL を値に持つ属性。`to` / `from` / `by` / `values` は SVG のアニメーション(`<set attributeName="href" to="javascript:…">`)が
 * 別の属性へ書き込む値で、`values` は `;` 区切りの並び(6 回目 C6-6)。
 */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'background', 'srcset', 'to', 'from', 'by', 'values',
  // 7 回目 C7-8: URL を値に持つ残りの属性。
  'ping', 'cite', 'longdesc', 'manifest', 'icon', 'codebase', 'archive', 'usemap', 'dynsrc', 'lowsrc', 'imagesrcset',
])

/**
 * `style` の属性に許す形(7 回目 C7-8)。**CSS のカスタムプロパティの宣言だけ**(`--名前: 値;` の並び。値は `var(--名前)` か、
 * 英数字・`#`・`.`・`%`・`-`・空白だけ)。生成器が吐く色見本(`--swatch: var(--color-…)`)がこの形である。
 * `url(…)`・`expression(…)`・`@import`・CSS のエスケープ(`\6a`)・ほかの性質の宣言は全部ここで落ちる —— 拒否の表ではなく許可の表にする。
 */
const STYLE_ALLOWED = /^\s*(?:--[a-z0-9-]+\s*:\s*(?:var\(--[a-z0-9-]+\)|[a-z0-9#.%\s-]+)\s*(?:;\s*|$))*$/i

/**
 * `style` の属性に許す値の字面。本文の包み `BODY_OPEN_HTML` が自分で付けるものと、markdown-it が表の列の揃え(`:---:` など)から
 * `<th>` / `<td>` に付けるもの。
 */
const STYLE_ALLOWED_LITERALS: ReadonlySet<string> = new Set(['display:contents', 'text-align:left', 'text-align:center', 'text-align:right'])

/** 危険な URL(制御文字・空白を除いて小文字にした値の先頭)。 */
const DANGEROUS_URL = /^(?:javascript|vbscript|data):/

/** Vue の構文木の節(使う欄だけ)。 */
interface VueNode {
  readonly type: number
  readonly tag?: string
  readonly tagType?: number
  readonly content?: unknown
  readonly props?: readonly VueProp[]
  readonly children?: readonly VueNode[]
}

/** Vue の属性・指令(使う欄だけ)。 */
interface VueProp {
  readonly type: number
  readonly name: string
  readonly rawName?: string
  readonly arg?: { readonly content: string; readonly isStatic: boolean }
  readonly exp?: { readonly content: string }
  readonly value?: { readonly content: string }
}

/** `@vue/compiler-dom` の `parse`(サイトが本文にかけるのと同じ HTML の読み方)。 */
type VueParse = (source: string, options: { onError: (error: Error) => void }) => { readonly children: readonly VueNode[] }

const NODE_ELEMENT = 1
const NODE_COMMENT = 3
const NODE_INTERPOLATION = 5
const NODE_ATTRIBUTE = 6
const NODE_DIRECTIVE = 7
const TAG_COMPONENT = 1
const TAG_SLOT = 2
const TAG_TEMPLATE = 3

let cachedParse: VueParse | undefined

/** docs の node_modules の `@vue/compiler-dom`(VitePress が SFC のコンパイルに使うものと同じ 1 本)。 */
function vueParse(): VueParse {
  if (cachedParse === undefined) {
    const required = createRequire(import.meta.url)('@vue/compiler-dom') as { parse?: unknown }
    if (typeof required.parse !== 'function') {
      throw new Error('@vue/compiler-dom の parse を見つけられません(版が変わった可能性があります)。関所を直すまでハンドブックを開きません')
    }
    cachedParse = required.parse as VueParse
  }
  return cachedParse
}

/** 描画の結果(関所が見るもの)。 */
export interface RenderedPage {
  /** 描画した HTML(包みを付けた後)。 */
  readonly html: string
  /** SFC に巻き上げられた `<script>` / `<style>` などの数。 */
  readonly hoistedBlocks: number
  /** 頭の `head`(ページの `<head>` に足すタグ)があるか。 */
  readonly hasHead: boolean
}

function attributeProblems(tag: string, prop: VueProp): string[] {
  const name = prop.name.toLowerCase()
  if (/^on/.test(name)) return [`ハンドラの属性 ${prop.name}(<${tag}>)`]
  if (name === 'srcdoc') return [`srcdoc の属性(<${tag}>)`]
  if (name === 'is') return [`is の属性(<${tag}>。部品に化ける)`]
  if (name === 'style' && prop.value !== undefined && !STYLE_ALLOWED_LITERALS.has(prop.value.content) && !STYLE_ALLOWED.test(prop.value.content)) {
    return [`style の属性がカスタムプロパティの宣言だけでない(<${tag}>): ${prop.value.content.slice(0, 80)}`]
  }
  if (FORM_TARGET_ATTRIBUTES.has(name) && !SAME_SITE_PATH.test((prop.value?.content ?? '').replace(/[\u0000- ]/g, ''))) {
    return [`危険な ${prop.name}(<${tag}>。送信先は同じサイトの /… だけ): ${(prop.value?.content ?? '').slice(0, 80)}`]
  }
  if (BASE_ATTRIBUTES.has(name)) return [`${prop.name} の属性(<${tag}>。相対 URL の基点を付け替える)`]
  if (name !== 'style' && prop.value !== undefined && hasForeignCssUrl(name, prop.value.content)) {
    return [`同じ文書の中(#…)でない url( の参照 ${prop.name}(<${tag}>): ${prop.value.content.slice(0, 80)}`]
  }
  if (URL_ATTRIBUTES.has(name) && prop.value !== undefined) {
    const compact = prop.value.content.replace(/[\u0000- ]/g, '').toLowerCase()
    // `;`(SVG の values)と `,`(srcset の並び)で割った各部分の先頭を見る(7 回目 C7-8: srcset の 2 つめ以降)。
    if (compact.split(/[;,]/).some((part) => DANGEROUS_URL.test(part))) return [`危険な ${prop.name}(<${tag}>): ${prop.value.content.slice(0, 80)}`]
  }
  return []
}

function directiveProblems(node: VueNode, prop: VueProp): string[] {
  const tag = node.tag ?? ''
  const shown = `${prop.rawName ?? prop.name}${prop.exp ? `="${prop.exp.content.slice(0, 80)}"` : ''}`
  // 名前つきの差し込み口(`<template #axiom>`)。名前が静的で、式を持たないものだけ。
  if (prop.name === 'slot') {
    if (node.tagType === TAG_TEMPLATE && prop.arg?.isStatic === true && prop.exp === undefined) return []
    return [`指令 ${shown}(<${tag}>。差し込み口は <template #静的な名前> だけ)`]
  }
  return [`指令 ${shown}(<${tag}>)`]
}

function visit(nodes: readonly VueNode[], issues: string[]): void {
  const components = new Set(DIAGRAM_COMPONENTS)
  for (const node of nodes) {
    if (node.type === NODE_INTERPOLATION) {
      issues.push(`v-pre の外の補間 {{ … }}: ${JSON.stringify((node.content as { content?: unknown } | undefined)?.content ?? '').slice(0, 80)}`)
      continue
    }
    if (node.type === NODE_COMMENT) {
      // Vue は `--!>` で注釈を閉じないが、ブラウザは閉じる(開発中の描画は注釈を残す)。HTML の注釈の決まりを外れる本文は拒む(6 回目 C6-6)。
      const text = typeof node.content === 'string' ? node.content : ''
      if (/--!>|<!--|^-?>|<!-$/.test(text)) issues.push(`HTML の注釈の決まりを外れる注釈(ブラウザが途中で閉じる): ${JSON.stringify(text).slice(0, 80)}`)
      continue
    }
    if (node.type !== NODE_ELEMENT) continue
    const tag = node.tag ?? ''
    if (FORBIDDEN_TAGS.has(tag.toLowerCase())) issues.push(`タグ <${tag}>`)
    else if (node.tagType === TAG_SLOT) issues.push(`差し込み口の描画 <${tag}>`)
    else if (node.tagType === TAG_COMPONENT && !components.has(tag)) issues.push(`許可表に無い部品 <${tag}>`)
    for (const prop of node.props ?? []) {
      if (prop.type === NODE_ATTRIBUTE) issues.push(...attributeProblems(tag, prop))
      else if (prop.type === NODE_DIRECTIVE) issues.push(...directiveProblems(node, prop))
    }
    visit(node.children ?? [], issues)
  }
}

/**
 * 描画した本文が許可表の中か(問題の一覧を返す。空なら許可表の中)。
 *
 * @param page 描画の結果
 * @param parse Vue の読み取り(テストは差し替えない。既定は docs の `@vue/compiler-dom`)
 */
export function auditRenderedBody(page: RenderedPage, parse: VueParse = vueParse()): string[] {
  const issues: string[] = []
  if (page.hoistedBlocks > 0) issues.push('本文の <script> / <style> が SFC に巻き上げられる')
  if (page.hasHead) issues.push('頭の head(ページの <head> にタグを足す)')
  const errors: string[] = []
  let children: readonly VueNode[] = []
  try {
    children = parse(page.html, { onError: (error) => errors.push(error.message) }).children
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (errors.length > 0) issues.push(`Vue として読めない(${errors[0]})`)
  visit(children, issues)
  return issues
}

/** markdown-it の字句(使う欄だけ)。 */
interface MdToken {
  type: string
  info: string
  level: number
  nesting: number
  block: boolean
  content: string
  src?: unknown
  children?: MdToken[] | null
}

/** 空要素(閉じを持たない)。 */
const VOID_RAW_TAGS: ReadonlySet<string> = new Set(['br', 'wbr'])

/**
 * 通した生のタグの開きと閉じを突き合わせ、対にならないもの(閉じの無い開き・開きの無い閉じ)を文字として描く字句に替える。
 * 対の範囲は 1 つの並び(根の段の `html_block` の並び、または 1 つの行内の子の並び)の中だけ。
 */
function balanceRawTags(tokens: MdToken[]): void {
  const stack: { name: string; token: MdToken }[] = []
  for (const token of tokens) {
    const escapedType = ESCAPED_TYPE[token.type]
    if (escapedType === undefined) continue
    const match = RAW_SIMPLE_TAG.exec(token.content.trim())
    if (match === null) continue
    const name = (match[2] ?? '').toLowerCase()
    if (VOID_RAW_TAGS.has(name) || match[3] === '/') continue
    if (match[1] === '') {
      stack.push({ name, token })
    } else if (stack.at(-1)?.name === name) {
      stack.pop()
    } else {
      token.type = escapedType
    }
  }
  for (const open of stack) open.token.type = ESCAPED_TYPE[open.token.type] ?? open.token.type
}

/** markdown-it の規則の並び(使う欄だけ)。 */
interface RulerLike<Rule> {
  readonly __rules__: readonly { readonly name: string; readonly fn: Rule; readonly alt: readonly string[] }[]
  at: (name: string, fn: Rule, options?: { alt?: readonly string[] }) => void
}

/** 字句を積む段の状態(使う欄だけ)。 */
interface ParseState {
  tokens: MdToken[]
  readonly env: Record<string, unknown>
}

/** 字句を読む規則(block は 4 引数、inline は 2 引数。どちらも積んだら true)。 */
type ParseRule = (state: ParseState, ...rest: unknown[]) => boolean

/** markdown-it の本体(使う欄だけ)。 */
interface MarkdownItLike {
  render: (source: string, env?: Record<string, unknown>) => string
  core: { ruler: { push: (name: string, rule: (state: { tokens: MdToken[]; env: Record<string, unknown>; Token: new (type: string, tag: string, nesting: number) => MdToken }) => void) => void } }
  block: { ruler: RulerLike<ParseRule> }
  inline: { ruler: RulerLike<ParseRule> }
  renderer: { rules: Record<string, ((tokens: MdToken[], index: number) => string) | undefined> }
  utils: { escapeHtml: (text: string) => string }
}

const ESCAPED_BLOCK = 'docs_escaped_html_block'
const ESCAPED_INLINE = 'docs_escaped_html_inline'

/** 生の HTML の字句の種類 → 文字として描く字句の種類(VitePress の `html_block` の規則は部品の行を `html_inline` の字句で積むので、両方を見る)。 */
const ESCAPED_TYPE: Readonly<Record<string, string>> = { html_block: ESCAPED_BLOCK, html_inline: ESCAPED_INLINE }

/**
 * 生の HTML を読む規則を包み、手書きのページで許可表の外の字句を「文字として描く」字句に替える。
 * (後から別の規則が足した `html_inline`。例: 見出しのアンカーの `&ZeroWidthSpace;` は、この規則を通らないので触らない。)
 */
function restrictRawHtml(ruler: RulerLike<ParseRule>, name: string): void {
  const rule = ruler.__rules__.find((entry) => entry.name === name)
  if (rule === undefined) throw new Error(`markdown-it の規則 ${name} が見つかりません(版が変わった可能性があります)。関所を直すまでハンドブックを開きません`)
  const original = rule.fn
  ruler.at(
    name,
    (state, ...rest) => {
      const before = state.tokens.length
      const matched = original(state, ...rest)
      if (!matched) return matched
      for (const token of state.tokens.slice(before)) {
        const escapedType = ESCAPED_TYPE[token.type]
        if (escapedType !== undefined && !isAllowedRawHtml(token.content)) token.type = escapedType
      }
      return matched
    },
    { alt: rule.alt },
  )
}

/** mermaid の図の囲み(`vitepress-plugin-mermaid` が部品に描くもの)。 */
function isDiagramFence(token: MdToken): boolean {
  if (token.type !== 'fence') return false
  const info = token.info.trim()
  return info === 'mermaid' || info === 'mmd'
}

const BODY_OPEN = 'docs_body_vpre_open'
const BODY_CLOSE = 'docs_body_vpre_close'

/** 本文の包み(レイアウトに影響しない箱)。 */
const BODY_OPEN_HTML = '<div v-pre class="docs-body" style="display:contents">\n'
const BODY_CLOSE_HTML = '</div>\n'

/** 関所を通らなかったときの例外。 */
export class UnsafeMarkdownBodyError extends Error {}

function pageName(env: Record<string, unknown>): string {
  return typeof env.relativePath === 'string' ? env.relativePath : typeof env.path === 'string' ? env.path : '(名前の無いページ)'
}

/**
 * VitePress の markdown-it に関所を付ける(`markdown.config` で呼ぶ)。
 *
 * - 読む段で: 生の HTML を許可表に絞る(外は文字として描く)。
 * - 字句の段で: コード片の取り込み(`<<<`)を拒み、根の段の塊を v-pre の箱で包む(根の段の mermaid の図は外)。
 * - 描画の段で: 描画した本文を許可表に当て、外れたら例外を投げる。
 *
 * @param md VitePress の markdown-it(`sfcPlugin` が付いた後のもの)
 */
export function installBodyGuard(md: MarkdownItLike): void {
  restrictRawHtml(md.block.ruler, 'html_block')
  restrictRawHtml(md.inline.ruler, 'html_inline')
  md.renderer.rules[ESCAPED_BLOCK] = (tokens, index) => `<p>${md.utils.escapeHtml((tokens[index]?.content ?? '').trim())}</p>\n`
  md.renderer.rules[ESCAPED_INLINE] = (tokens, index) => md.utils.escapeHtml(tokens[index]?.content ?? '')
  md.core.ruler.push('docs_body_guard', (state) => {
    const snippets = state.tokens.filter((token) => token.src !== undefined)
    if (snippets.length > 0) {
      throw new UnsafeMarkdownBodyError(
        `${pageName(state.env)}: コード片の取り込み(<<< …)は受け付けません(根の外のファイルを読んで出力に埋めるため)。コードは本文に書いてください`,
      )
    }
    balanceRawTags(state.tokens)
    for (const token of state.tokens) if (token.type === 'inline' && token.children) balanceRawTags(token.children)
    const wrapped: MdToken[] = []
    let open = false
    for (const token of state.tokens) {
      const atRoot = token.level === 0 && token.nesting !== -1
      if (atRoot && isDiagramFence(token)) {
        if (open) wrapped.push(new state.Token(BODY_CLOSE, '', -1))
        open = false
      } else if (atRoot && !open) {
        wrapped.push(new state.Token(BODY_OPEN, '', 1))
        open = true
      }
      wrapped.push(token)
    }
    if (open) wrapped.push(new state.Token(BODY_CLOSE, '', -1))
    state.tokens = wrapped
  })
  md.renderer.rules[BODY_OPEN] = () => BODY_OPEN_HTML
  md.renderer.rules[BODY_CLOSE] = () => BODY_CLOSE_HTML

  const render = md.render.bind(md)
  md.render = (source, env = {}) => {
    const html = render(source, env)
    const blocks = env.sfcBlocks as { scripts?: unknown[]; styles?: unknown[]; customBlocks?: unknown[] } | undefined
    const frontmatter = env.frontmatter as Record<string, unknown> | undefined
    const issues = auditRenderedBody({
      html,
      hoistedBlocks: (blocks?.scripts?.length ?? 0) + (blocks?.styles?.length ?? 0) + (blocks?.customBlocks?.length ?? 0),
      hasHead: frontmatter !== undefined && Object.prototype.hasOwnProperty.call(frontmatter, 'head'),
    })
    if (issues.length > 0) {
      throw new UnsafeMarkdownBodyError(
        `${pageName(env)}: 本文に Vue が評価する形・許可表の外の HTML があります(docs の Markdown はテンプレートとして実行しません): ${issues.slice(0, 5).join(' / ')}` +
          (issues.length > 5 ? ` ほか ${issues.length - 5} 件` : ''),
      )
    }
    return html
  }
}
