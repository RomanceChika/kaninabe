/**
 * 表紙(`index.html`)の本文を、出力の口(`markup.ts`)で組む。
 *
 * 中身は `index-page.ts` の事実と語で、並びは: 製品の一言 → 理由をつけて外している守り → この本に出てくる言葉 → 規模 → 集約関係図 → ロール → 章立て。
 * 章立ては新しい形に移した章(ライフサイクルの全体・集約の章)だけをリンクにし、まだ移していない章は題だけを並べて「移行の途中」と添える
 * (`.md` の生のファイルへは繋がない。読むのは書き出した本である)。
 * 集約関係図は自前の SVG(`aggregate-diagram.ts`)、言葉の表は台帳の `face: book` の行(語と行は `index-page.ts` と同じ)。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { RoleDef } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { exemptionFacts } from '../../../../semantics/spec-book/exemption-facts.js';
import { aggregateTitle, bookChapters, bookFile, CHAPTER_GROUP_TITLES, CHAPTER_GROUPS } from '../chapters.js';
import { EXEMPTION_WORDS, exemptionRows, type ExemptionRow } from '../index-exemptions.js';
import { GLOSSARY_WORDS, GRAPH_WORDS, glossaryRows, scaleRows } from '../index-page.js';
import { OMITTED_LABEL_NOTE, aggregateDiagram } from './aggregate-diagram.js';
import { inline } from './face-parts.js';
import { el, url, type Html } from './markup.js';
import type { PageHeading } from './page.js';
import { code, section, table, type ChapterBody } from './chapter-parts.js';

/** 表紙の語(仕組みの語)。 */
export const COVER_WORDS = {
  title: 'システムハンドブック',
  intro:
    'このハンドブックは仕様(YAML)だけから生成された、「このシステムが何か」の読み物である。数字・図・表はすべて仕様の写像で、生成は情報を足さない。' +
    'レビューもここで完結する。各章に人間の判断が要る箇所(⚠ と標識)が埋め込まれており、どの章をどれだけ読むべきかは',
  guide: 'レビューの手引き',
  introEnd: 'が配る。',
  scale: '規模',
  scaleHeaders: ['', '数'],
  roles: '誰がいるか(ロール)',
  roleHeaders: ['ロールID', '名前', '種別', 'binding', '含意するロール'],
  roleKinds: { global: 'グローバル', contextual: '文脈依存' },
  roleNote: '文脈依存ロールは、そのレコードとの関係で決まる。判定式は binding 列にある。含意するロールを持つ場合、その権限も併せ持つ。',
  toc: '章立て',
  overview: 'ライフサイクルの全体',
  pending: '(HTML への移行の途中)',
  none: '—',
} as const;

/** HTML に移した横断の章(本の根からのファイル名。拡張子なし)。章を移すたびにここへ足す。 */
const MIGRATED: ReadonlySet<string> = new Set([
  'notifications',
  'jobs',
  'config',
  'auth',
  'guarantees',
  'screens',
  'visibility',
  'actions',
  'external',
  'usecases',
  'data',
  'design',
  'ux-principles',
  'sweep',
  'examples',
  'review-guide',
]);

/**
 * 章のファイル(`chapters.ts` の `file`)から、HTML の本の中の相対 URL を引く。集約の章は新しい形の章へ、移した横断の章はその章へ繋ぐ。
 * まだ移していない章(と、章立てに無いファイル)は繋ぐ先が無いので null(呼ぶ側が題だけを出す。`.md` へは繋がない)。
 *
 * @param file 章のファイル(リポジトリルート相対)
 */
export function chapterHref(model: SpecModel, ctx: GenerateContext, file: string): string | null {
  const chapter = bookChapters(model, ctx).find((candidate) => candidate.file === file);
  if (chapter === undefined) return null;
  if (chapter.aggregate !== undefined) return `./spec/${chapter.aggregate}.html`;
  const name = file.slice(bookFile(ctx.roots).length + 1).replace(/\.md$/, '');
  return MIGRATED.has(name) ? `./${name}.html` : null;
}

/** 守りの表の章の欄(集約の章は新しい形へ、移した横断の章はその章へ繋ぐ。まだ移していない章は題だけ)。 */
function chapterCell(row: ExemptionRow): Html {
  if (row.chapter.kind === 'aggregate') return el('a', { class: 'bf-nowrap', href: url(`./spec/${row.chapter.aggregate}.html`) }, row.chapter.label);
  return MIGRATED.has(row.chapter.kind)
    ? el('a', { class: 'bf-nowrap', href: url(`./${row.chapter.kind}.html`) }, row.chapter.label)
    : el('span', { class: 'bf-nowrap' }, row.chapter.label);
}

/** 理由をつけて外している守り。 */
function exemptions(model: SpecModel, ctx: GenerateContext, headings: PageHeading[]): Html {
  const facts = exemptionFacts(model, ctx.auth?.flow ?? null, ctx.config?.catalog ?? null);
  return section('exempt', EXEMPTION_WORDS.heading, headings, () =>
    facts.length === 0
      ? el('p', null, EXEMPTION_WORDS.none)
      : [
          el('p', null, EXEMPTION_WORDS.lead),
          table(
            EXEMPTION_WORDS.headers,
            exemptionRows(facts, model).map((row) => [row.accepted ? EXEMPTION_WORDS.accepted : '', el('b', null, row.guard), row.state, row.reason, chapterCell(row)]),
          ),
        ],
  );
}

/** この本に出てくる言葉(台帳の語と、実装の側の 3 語の対応表)。 */
function glossary(model: SpecModel, ctx: GenerateContext, headings: PageHeading[]): Html {
  const words = GLOSSARY_WORDS;
  const rows = glossaryRows(model, ctx);
  return section('glossary', words.heading, headings, () => {
    headings.push({ level: 3, id: 'glossary-code', title: el('span', null, words.implHeading) });
    return [
      el('p', null, words.lead),
      rows.length === 0
        ? el('p', null, inline(words.none))
        : table(
            words.headers,
            rows.map((row) => [el('b', null, row.term), inline(row.gloss)]),
          ),
      el('h3', { id: 'glossary-code' }, words.implHeading),
      el('p', null, inline(words.implLead.join(''))),
      table(
        words.implHeaders,
        words.implRows.map((row) => row.map(inline)),
      ),
      el('p', null, inline(words.tail.join(''))),
    ];
  });
}

/** 集約関係図の読み方(SVG の図に合わせる)。 */
const GRAPH_LEGEND =
  '矢印は、参照している向き。線の名前は、参照する欄の名前。節は上から順に、内部名、日本語名、状態機械。' +
  '日本語名と状態機械は、宣言がある集約だけに出る。参照の型と必須の別は、各集約の章のフィールド表が正。';

/** 集約関係図(このページの要)。 */
function graph(model: SpecModel, headings: PageHeading[]): Html {
  const figure = aggregateDiagram(model, (aggregate) => `./spec/${aggregate}.html`, GRAPH_WORDS.heading);
  return section('graph', GRAPH_WORDS.heading, headings, () => [
    figure ?? el('p', null, GRAPH_WORDS.none),
    el('p', { class: 'bf-note' }, GRAPH_LEGEND, figure === null ? null : ` ${OMITTED_LABEL_NOTE}`),
  ]);
}

/** ロールの表の 1 行。 */
function roleRow(role: RoleDef): readonly (Html | string)[] {
  const implies = role.implies ?? [];
  return [
    code(role.id) ?? '',
    role.label ?? COVER_WORDS.none,
    role.binding === undefined ? COVER_WORDS.roleKinds.global : COVER_WORDS.roleKinds.contextual,
    code(role.binding) ?? COVER_WORDS.none,
    implies.length === 0 ? COVER_WORDS.none : implies.join(', '),
  ];
}

/** 章立て。グループと並びの正は `chapters.ts`。 */
function chapterList(model: SpecModel, ctx: GenerateContext, headings: PageHeading[]): Html {
  const chapters = bookChapters(model, ctx);
  return section('toc', COVER_WORDS.toc, headings, () =>
    CHAPTER_GROUPS.map((group) => {
      const members = chapters.filter((chapter) => chapter.group === group);
      if (members.length === 0) return null;
      const items = members.flatMap((chapter) => {
        if (chapter.aggregate === undefined) {
          const name = chapter.file.slice(bookFile(ctx.roots).length + 1).replace(/\.md$/, '');
          return [
            MIGRATED.has(name)
              ? el('li', null, el('a', { href: url(`./${name}.html`) }, chapter.title))
              : el('li', null, chapter.title, el('span', { class: 'bf-note' }, COVER_WORDS.pending)),
          ];
        }
        // 新しい形では従属する集約も自分の章を持つので、親の章の下に並べて直接繋ぐ。
        const folded = (chapter.folded ?? []).map((name) =>
          el('li', null, el('a', { href: url(`./spec/${name}.html`) }, aggregateTitle(name, model.aggregates.get(name)?.entity?.label))),
        );
        return [el('li', null, el('a', { href: url(`./spec/${chapter.aggregate}.html`) }, chapter.title), folded.length === 0 ? null : el('ul', null, folded))];
      });
      const lead = group === 'domain' ? [el('li', null, el('a', { href: url('./spec/index.html') }, COVER_WORDS.overview))] : [];
      const id = `toc-${group}`;
      headings.push({
        level: 3,
        id,
        title: el('span', null, CHAPTER_GROUP_TITLES[group]),
      });
      return [el('h3', { id }, CHAPTER_GROUP_TITLES[group]), el('ul', null, lead, items)];
    }),
  );
}

/**
 * 表紙の本文と目次。
 *
 * @param model 仕様
 * @param ctx 製品の一言・認証・設定・章立ての材料
 */
export function coverChapter(model: SpecModel, ctx: GenerateContext): ChapterBody {
  const headings: PageHeading[] = [];
  const summary = ctx.roots.summary;
  const body = [
    el('h1', null, COVER_WORDS.title),
    summary === undefined ? null : el('p', { class: 'bf-summary' }, el('strong', null, summary)),
    el('p', null, COVER_WORDS.intro, el('a', { href: url('./review-guide.html') }, COVER_WORDS.guide), COVER_WORDS.introEnd),
    exemptions(model, ctx, headings),
    glossary(model, ctx, headings),
    section('scale', COVER_WORDS.scale, headings, () =>
      table(
        COVER_WORDS.scaleHeaders,
        scaleRows(model, ctx).map(([key, value]) => [el('b', null, key), value]),
      ),
    ),
    graph(model, headings),
    section('roles', COVER_WORDS.roles, headings, () => [table(COVER_WORDS.roleHeaders, model.roles.roles.map(roleRow)), el('p', { class: 'bf-note' }, COVER_WORDS.roleNote)]),
    chapterList(model, ctx, headings),
  ];
  return { body: el('div', { class: 'bf-cover' }, body), headings };
}
