/**
 * 層の章(認証・設定・通知・ジョブ・画面など、集約を持たない章)の骨格の HTML 版。
 *
 * 章頭・読む量の 4 枚・前提の語・受け入れ・凡例などの部品を 1 枚に寄せたもの(共有の集計は `face-chapter.ts` / `face-budget.ts`)。
 * 章の形は同じ(章頭 → 読む量の 4 枚 → 前提の語 → 凡例 → 上段(公理)→ 下段(導出)→ 数の出どころ)で、数も同じ集計
 * (`block-reading.ts` の `chapterReading`)から出す。違うのは書き出し方だけで、文字列はすべて出力の口(`markup.ts`)を通す。
 *
 * 章の数の鍵は、章のファイル(`chapters.ts` の `file`)のままにする(レビューの手引きと同じ集計を引くため)。
 * 製品の語は持たない(層の語は呼ぶ側が渡す)。
 *
 * @oversize 超える理由: 層の章の骨格(章頭 → 読む量 → 前提の語 → 凡例 → 上段 → 受け入れ → 下段 → 数の出どころ)は 1 つの並びで、
 *   どの部分も同じ集計(`chapterReading`)の数と同じ目次(`Outline`)を共有する。並びと数の対応を 1 か所で確かめられる。
 * @split-review 割る案と結果: 読む量の 4 枚(予算の格子・件数の添え書き)と受け入れの節(凡例・標識の折りたたみ・受け入れの表)を
 *   別のファイルに割る案を検討した。どちらも呼ぶのは `layerChapter` だけで、割ると集計の結果と目次を引数で回すだけの継ぎ目が増え、
 *   章の並びが 2 枚に散る。部品が散ると並びを追いにくいので 1 枚に寄せたのがこのファイルであり、割らない。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { Finding } from '../../../../kernel/finding.js';
import type { AcceptItem } from '../../../../semantics/reading-load.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { collectSigns } from '../../../prose.js';
import { relativeHref } from '../chapters.js';
import { chapterLoads } from '../chapter-loads.js';
import { chapterReading, requiredOf, type ReaderLoad, type ReadingSum } from '../block-reading.js';
import { pendingLine } from '../finding-placement.js';
import { specRelative } from '../face-sign.js';
import { termGloss } from '../term-gloss.js';
import type { AxiomElement } from '../face-chapter.js';
import { bold, fold, grid, kv, kvs, mark, mono, pts, term, verified, type Glossary } from './face-parts.js';
import { el, join, url, type Attrs, type Child, type Html } from './markup.js';
import type { PageHeading } from './page.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 見出しを本文と同じ順で目次に積む。 */
export class Outline {
  readonly headings: PageHeading[] = [];

  /** 節(`h2`)。 */
  h2(id: string, title: Child): Html {
    const html = join([title]);
    this.headings.push({ level: 2, id, title: el('span', null, html) });
    return el('h2', { id }, html);
  }

  /** 段(`h3`)。 */
  h3(id: string, title: Child): Html {
    const html = join([title]);
    this.headings.push({ level: 3, id, title: el('span', null, html) });
    return el('h3', { id }, html);
  }
}

/**
 * 上段の公理 1 行(行頭に読み方の印)。
 *
 * @param head 行頭の見出し(ID と表示名)
 * @param rows ラベル行
 * @param elements この行が載せる公理の種類
 * @param anchor 行へ飛ぶための `id`
 */
export function axiomRow(head: Child, rows: readonly Child[], elements: readonly AxiomElement[], anchor?: string): Html {
  return el(
    'div',
    {
      class: 'bf-axiom',
      ...(anchor === undefined ? {} : { id: anchor }),
      'data-el': elements.join(' '),
    },
    el('div', { class: 'bf-id' }, head, ' ', mark('axiom')),
    el('div', { class: 'bf-st' }, kvs(rows)),
  );
}

/** 受け入れの 1 種類ぶん(理由をつけて通したもの)。 */
export interface AcceptGroup {
  readonly kind: Child;
  readonly items: readonly AcceptItem[];
}

/** 受け入れの節の材料。 */
export interface AcceptInput {
  readonly groups: readonly AcceptGroup[];
  readonly pending: readonly Finding[] | null;
  readonly signsDecision: number;
  readonly signFiles: readonly string[];
  readonly signPlaces: string;
}

/** 層の章の材料(断片は `Html`)。 */
export interface LayerChapter {
  readonly title: string;
  /** 章の数の鍵(`chapters.ts` の章のファイル)。 */
  readonly countKey: string;
  /** 書き出す HTML のファイル(リポジトリルート相対。リンクの起点)。 */
  readonly file: string;
  readonly crumb: { readonly layer: string; readonly count: string };
  readonly intro: readonly Child[];
  readonly axiomBreakdown: string;
  readonly upperBullets: readonly Child[];
  /** 上段の本体(見出しは `outline` で組む)。 */
  readonly upper: (outline: Outline) => readonly Child[];
  readonly accept: AcceptInput;
  readonly reasonedWords: string;
  readonly lower: readonly Child[];
  /** 導出の件数と内訳。`verify` は件数と内訳が変異の目録(全部入りの `generate` だけが回す)に依るとき true。 */
  readonly derived: {
    readonly count: number;
    readonly lines: readonly Child[];
    readonly verify?: boolean;
  };
  readonly originRows: readonly (readonly [Child, Child])[];
}

/** 語釈の引き先(台帳の全行)。 */
export function glossaryOf(model: SpecModel, ctx: GenerateContext): Glossary {
  const terms = new Map((ctx.terms?.ledger?.terms ?? []).map((decl) => [decl.id, decl] as const));
  return (id) => {
    const decl = terms.get(id);
    return decl === undefined ? undefined : termGloss(decl, model);
  };
}

/** 読み手 1 人ぶんの受け入れの件数。 */
function acceptOf(load: ReaderLoad): number {
  return load.reasoned + (load.pending ?? 0);
}

/** まだ通していない分の言い方。 */
function pendingWords(pending: number | null): string {
  return pending === null ? 'まだ通していない分は未集計(検証の結果が渡されていない)' : `まだ通していない分 ${pending} 件`;
}

/** 読む量の 4 枚。 */
function budget(sum: ReadingSum, chapter: LayerChapter): Html {
  const { business, developer } = sum.byReader;
  const accept = acceptOf(business) + acceptOf(developer);
  return grid([
    {
      id: 'axiom',
      label: '必読',
      mark: 'axiom',
      value: `業務 ${requiredOf(business)} / 開発者 ${requiredOf(developer)}`,
      verify: true,
      body: [
        pts([
          `公理 ${sum.axioms} 本。${chapter.axiomBreakdown}`,
          `業務 ${requiredOf(business)} 件。受け入れ ${acceptOf(business)} 件。業務の判断をする人が読む`,
          `開発者 ${requiredOf(developer)} 件。受け入れ ${acceptOf(developer)} 件。開発者が通した理由と、未処理の警告`,
        ]),
      ],
    },
    {
      id: 'changed',
      label: '今回変わった',
      mark: 'changed',
      value: sum.changed === null ? '—' : String(sum.changed),
      body: [
        sum.changed === null
          ? pts(['基点が無いので数えない', join(['基点は ', mono('generate -- --base'), ' で渡す'])])
          : pts([`公理の側の動き ${sum.changed} か所`, `${chapter.crumb.layer.replace('の章', '')}の宣言の差分は、まだ数えていない`]),
      ],
    },
    {
      id: 'acceptance',
      label: '受け入れ',
      mark: 'acceptance',
      value: String(accept),
      verify: true,
      body: [pts([`理由をつけて通した分 ${sum.reasoned} 件`, pendingWords(sum.pending), chapter.reasonedWords])],
    },
    {
      id: 'derive',
      label: '導出(畳んだまま可)',
      mark: 'derive',
      value: String(chapter.derived.count),
      body: [pts(chapter.derived.lines)],
      verify: chapter.derived.verify === true,
    },
  ]);
}

/** 章頭の数の約束(4 枚の数・数の出どころ・標識と判断ポイント・手引き)。 */
function countHint(model: SpecModel, ctx: GenerateContext, chapter: LayerChapter, glossary: Glossary): Html {
  const load = chapterLoads(model, ctx).find((candidate) => candidate.chapter.file === chapter.countKey);
  return pts(
    [
      '4 枚の数は、この章に並ぶ項目の数と一致する',
      join(['数え方と章の範囲は', el('a', { href: url('#origin') }, '数の出どころ')]),
      ...(load === undefined
        ? []
        : [
            join([term(glossary, 'signpost', '標識'), ` ${load.signCount} 本、`, term(glossary, 'pause_point', '判断ポイント'), ` ${load.declCount} 件。単位が違うので足さない`]),
            join(['ブロックごとの数は', el('a', { href: url('./review-guide.html') }, 'レビューの手引き')]),
          ]),
    ],
    true,
  );
}

/** 読み方の印の凡例。 */
export function legend(sum: Pick<ReadingSum, 'reasoned' | 'pending'>, outline: Outline, glossary: Glossary): Html {
  const row = (kind: Parameters<typeof mark>[0], ...kids: readonly Child[]): Html => el('li', null, mark(kind), el('span', null, kids));
  const words = sum.pending === null ? ['まだ通していない分は未集計'] : [`まだ通していない分 ${sum.pending} 件。後者は `, mono('verify'), ' の警告のうち未分類'];
  return join([
    outline.h2('legend', '読み方の印の凡例'),
    el(
      'ul',
      { class: 'bf-legend' },
      row('axiom', bold(term(glossary, 'axiom', '公理')), '。人が意味を判定する。異議の出し先。受け入れも必読に含める'),
      row('derive', bold(term(glossary, 'derivation', '導出')), '。上段から機械が出した分。読まなくても公理の判定は変わらない'),
      row('acceptance', `機械が疑った場所。理由をつけて通した分 ${sum.reasoned} 件と、`, verified(words)),
      row('changed', '基点のあとに、この章の公理の側で動いた場所'),
    ),
  ]);
}

/**
 * 標識の引用の頭の行に付ける印(出典の仕様ファイルと本数)。章がこのブロックの標識を出したかを、置き場の検査(`block-check.ts`)が
 * この印で確かめる。字の綴りではなく属性で見るので、引用の文言を直しても検査は変わらない。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param count そのファイルの標識の本数
 */
export function signMarker(file: string, count: number): Attrs {
  return { 'data-sign-source': file, 'data-sign-count': String(count) };
}

/** 印を付けた引用の頭の行の開きタグ(置き場の検査が章の本文に探す綴り。書き出しと同じ口で組む)。 */
export function signMarkerTag(file: string, count: number): string {
  const open = el('p', signMarker(file, count));
  return open.slice(0, open.indexOf('>') + 1);
}

/**
 * 標識(手書きの判断)の折りたたみ。原文は Markdown のまま字として出す(本の HTML は Markdown を読まない)。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param pageFile 書き出す章のファイル(出典へのリンクの起点)
 */
export function signFold(file: string, ctx: GenerateContext, pageFile: string): Html | null {
  const signs = collectSigns(ctx.specSources?.get(file) ?? '');
  const label = specRelative(file, ctx);
  return fold(
    { kind: 'sign', title: `標識 ${signs.length} 本`, hint: label },
    signs.length === 0
      ? []
      : [
          el(
            'p',
            signMarker(file, signs.length),
            bold(`標識 ${signs.length} 本`),
            ' — ',
            el('a', { href: url(relativeHref(pageFile, file)) }, label),
            ' に残された手書きの判断(原文のまま転記。違うと思ったら異議を出す場所)',
          ),
          ...signs.map((sign) => el('blockquote', { class: 'bf-sign' }, el('p', { class: 'bf-sign-text' }, sign))),
        ],
  );
}

/** 受け入れの節。 */
export function acceptSection(input: AcceptInput, ctx: GenerateContext, pageFile: string, outline: Outline): Html {
  const reasoned = input.groups.reduce((sum, group) => sum + group.items.length, 0);
  const total = reasoned + (input.pending?.length ?? 0);
  const noAcceptance = reasoned === 0 && input.pending !== null && input.pending.length === 0;
  const signsOnly = noAcceptance && input.signsDecision > 0;
  const label = join(['検証器の警告のうち未分類(', mono('npm run verify'), ' の warning で、拡張候補に当たらないもの)']);
  const pendingRow: readonly Child[] =
    input.pending === null
      ? ['—', label, '未集計。検証の結果が渡されていない(generate の入口が verify を先に回す)']
      : (() => {
          const lines = input.pending.map((finding) => pendingLine(finding, ctx.roots));
          return [
            bold(String(lines.length)),
            join([label, pts(lines.map((line) => join([mono(line.id), ` ${line.what}`, el('br', null), mono(line.where)])))]),
            join(['まだ通していない', pts(lines.map((line) => line.fix))]),
          ];
        })();
  const rows = [
    ...input.groups.map((group): readonly Child[] => [
      bold(String(group.items.length)),
      join([group.kind, pts(group.items.map((item) => item.what))]),
      join(['理由つき', pts(group.items.map((item) => item.reason.replace(/\s*\n\s*/g, ' ')))]),
    ]),
    pendingRow,
  ];
  return join([
    outline.h3('acceptance', join([verified([signsOnly ? '標識' : `受け入れ(${total})`]), ' ', mark('acceptance')])),
    verified(
      [
        pts(
          signsOnly
            ? [
                `${input.signPlaces}に残された標識を並べる。人が下した判断の記録`,
                '受け入れは 0 件。理由をつけて通した分も、まだ通していない分も無い',
                '標識は受け入れの件数に足さない。別に数える',
              ]
            : [
                '機械が疑った場所を並べる。人が理由をつけて通した分と、まだ通していない分',
                '通した理由は仕様に書かれた原文のまま',
                join(['まだ通していない分は検証器の警告のうち未分類で、全文は ', mono('npm run verify'), ' の出力。拡張候補は仕組みの宿題なので数えない']),
                `${input.signPlaces}に残された標識は、人が下した判断の記録なので、この下に置く`,
                '標識は受け入れの件数に足さない。別に数える',
              ],
          true,
        ),
        signsOnly ? null : noAcceptance ? pts(['この章に受け入れは無い。理由をつけて通した分も、まだ通していない分も 0 件']) : table(['件数', '何を', '状態'], rows),
      ],
      true,
    ),
    input.signFiles.map((file) => signFold(file, ctx, pageFile)),
  ]);
}

/** 前提にする語(台帳の `face: book` の語のうち、本文に出るもの)。 */
export function termsSection(model: SpecModel, ctx: GenerateContext, body: string, outline: Outline): Html | null {
  const used = (ctx.terms?.ledger?.terms ?? []).filter((decl) => decl.face === 'book' && body.includes(decl.term));
  if (used.length === 0) return null;
  return join([
    outline.h2('terms', '前提にする語'),
    pts([`この章に出る台帳の語 ${used.length} つ`, join(['台帳は ', mono('terms.md'), '。語釈は台帳のとおり'])], true),
    el(
      'dl',
      { class: 'bf-terms' },
      used.map((decl) => el('div', null, el('dt', null, decl.term, el('small', null, decl.id)), el('dd', null, termGloss(decl, model), kvs([kv('出どころ', mono(decl.first))])))),
    ),
  ]);
}

/** 表のセルの箇条。 */
export function items(list: readonly Child[]): Html {
  return pts(list);
}

/**
 * 層の章の本文と目次。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト
 * @param chapter 層ごとの材料
 */
export function layerChapter(model: SpecModel, ctx: GenerateContext, chapter: LayerChapter): ChapterBody {
  const sum = chapterReading(model, ctx, chapter.countKey);
  const glossary = glossaryOf(model, ctx);
  const { business, developer } = sum.byReader;
  const accept = acceptOf(business) + acceptOf(developer);
  const product = ctx.roots.name === null ? '' : `${ctx.roots.name} `;

  // 前提の語は本文から引くので、本文を先に組む。目次は節ごとに積み、最後に本文と同じ順に並べ直す。
  const legendOutline = new Outline();
  const upperOutline = new Outline();
  const lowerOutline = new Outline();
  const termsOutline = new Outline();
  const originOutline = new Outline();
  const head = join([
    el('p', { class: 'bf-note' }, `${product}ハンドブック · ${chapter.crumb.layer} · ${chapter.crumb.count}`),
    budget(sum, chapter),
    countHint(model, ctx, chapter, glossary),
    pts(chapter.intro, true),
  ]);
  const legendHtml = legend(sum, legendOutline, glossary);
  const upper = join([
    upperOutline.h2('upper', join(['上段 — 公理 ', mark('axiom')])),
    pts(chapter.upperBullets, true),
    chapter.upper(upperOutline),
    acceptSection(chapter.accept, ctx, chapter.file, upperOutline),
  ]);
  const lower = join([
    lowerOutline.h2('lower', join(['下段 — 導出 ', mark('derive')])),
    pts(['ここにあるのは、上段から機械が出したもの', bold('読まなくても公理の判定は変わらない'), '上段を疑うときに開く', 'ここに違和感があるときに直すのは、上段の側'], true),
    chapter.lower,
  ]);
  const terms = termsSection(model, ctx, `${head}${legendHtml}${upper}${lower}`, termsOutline);
  const origin = join([
    originOutline.h2('origin', '数の出どころ'),
    pts(['この章に出る数は、すべて仕様の宣言を数えたもの', '数えられないものは未集計と書く'], true),
    table(
      ['数 / 語', '数え方・定義'],
      [
        ...chapter.originRows,
        [
          verified([bold(`必読 ${requiredOf(business) + requiredOf(developer)}`)]),
          verified(
            [
              items([
                bold(`必読 = 公理 + 受け入れ`),
                `公理 ${sum.axioms} 本に、受け入れ ${accept} 件を足した`,
                `読み手ごとに分ける。業務 ${requiredOf(business)}、開発者 ${requiredOf(developer)}`,
                '公理は業務の判断。受け入れは、仕様の種類ごとに読み手が決まる',
                '4 枚の数は、レビューの手引きのブロックの数と同じ集計から出る',
              ]),
            ],
            true,
          ),
        ],
        [
          verified([bold(`受け入れ ${accept}`)]),
          verified(
            [
              items([
                `理由つき ${sum.reasoned} 件。${chapter.reasonedWords}`,
                sum.pending === null
                  ? 'まだ通していない分は未集計。検証の結果が渡されていない'
                  : `まだ通していない ${sum.pending} 件 = 検証器の警告のうち未分類。場所のファイルが、この章の仕様ファイルに入るものを配る`,
                join(['全文は ', mono('npm run verify'), ' の出力。章に出すのは ID・場所・対処の 1 行']),
              ]),
            ],
            true,
          ),
        ],
        chapter.derived.verify === true
          ? [verified([bold(`参照 ${chapter.derived.count}`)]), verified([items([...chapter.derived.lines, 'テストの件数は公理に足さない'])], true)]
          : [bold(`参照 ${chapter.derived.count}`), items([...chapter.derived.lines, 'テストの件数は公理に足さない'])],
        [
          bold('変更'),
          items(
            sum.changed === null
              ? [join(['基点は引数で受ける。', mono('npm run generate -- --base <ref>'), ' で渡す。渡さなければ数えない(0 とは書かない)'])]
              : ['基点つきのときも、この層の宣言の差分は数えていない。0 は「差分が無い」の意味ではない'],
          ),
        ],
        [
          bold('原文の写し方'),
          items([
            '宣言の値は仕様の欄のまま出す。言い換えない',
            '人が書いた説明の文は、書かれたまま出す。書かれていなければ「(まだ書かれていない)」と出す',
            '機械が導けないものは、原文と出典を残す',
          ]),
        ],
      ],
    ),
  ]);
  return {
    body: join([el('h1', null, chapter.title), head, terms, legendHtml, upper, lower, origin]),
    headings: [...termsOutline.headings, ...legendOutline.headings, ...upperOutline.headings, ...lowerOutline.headings, ...originOutline.headings],
  };
}
