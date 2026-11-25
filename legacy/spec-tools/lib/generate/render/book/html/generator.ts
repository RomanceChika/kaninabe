/**
 * 本の HTML を書き出す生成器(移行の途中)。
 *
 * いまは表紙(`index.html`)・集約の章(`domain/{集約}.html`)・層の章(通知・ジョブ・設定・認証・保証・画面・可視性・操作)と、層の骨格を持たない章(外部連携・タスク・データの置き場・デザイン・UX 原則・網羅台帳・書き方の例・レビューの手引き)と新しい形の章(`spec/{集約}.html` と `spec/index.html`)と、HTML の本が読む資材(`assets/book.js`・`assets/face.css`・検索の索引 `assets/search.json`)を書く。
 * 章を移すたびにここへ足す。事実と語は各章の材料(`*-page.ts` などの共有の部品)から引く。
 */

import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../../gen-kit/generator.js';
import type { SpecModel } from '../../../../model/types.js';
import { systemRoleId } from '../../../../model/role-hierarchy.js';
import { aggregateAccessFacts, roleFacts } from '../../../../semantics/spec-book/access-facts.js';
import { computeIndexOf, invariantFacts } from '../../../../semantics/spec-book/invariant-facts.js';
import { allLifecycleFacts, lifecycleFacts } from '../../../../semantics/spec-book/lifecycle-facts.js';
import { lifecycleAxes } from '../../../../semantics/spec-book/lifecycle-followers.js';
import { aggregateTitle, bookFile } from '../chapters.js';
import { SPEC_LEAD, originsOf } from '../spec-page.js';
import { BOOK_CLIENT_SCRIPT } from './client-script.js';
import { renderPage, type BookPage, type PageLink } from './page.js';
import { searchIndexJson, type SearchSource } from './search-index.js';
import { aggregateChapter, overviewChapter } from './spec-chapter.js';
import { roleChips } from './chips.js';
import type { ChapterBody } from './chapter-parts.js';
import { COVER_WORDS, coverChapter } from './index-chapter.js';
import { AUTH_TITLE, authChapter } from './auth-chapter.js';
import { CONFIG_TITLE, configChapter } from './config-chapter.js';
import { JOBS_TITLE, jobsChapter } from './jobs-chapter.js';
import { GUARANTEES_TITLE, guaranteesChapter } from './guarantees-chapter.js';
import { VISIBILITY_TITLE, visibilityChapter } from './visibility-chapter.js';
import { ACTIONS_TITLE, actionsChapter } from './actions-chapter.js';
import { SCREENS_TITLE, screensChapter } from './screens-chapter.js';
import { NOTIFICATIONS_TITLE, notificationsChapter } from './notifications-chapter.js';
import { EXTERNAL_TITLE, externalChapter } from './external-chapter.js';
import { USECASES_TITLE, usecasesChapter } from './usecases-chapter.js';
import { DATA_TITLE, dataChapter } from './data-chapter.js';
import { DESIGN_TITLE, designChapter } from './design-chapter.js';
import { UX_TITLE, uxPrinciplesChapter } from './ux-principles-chapter.js';
import { SWEEP_TITLE, sweepChapter } from './sweep-chapter.js';
import { REVIEW_GUIDE_TITLE, reviewGuideChapter } from './review-guide-chapter.js';
import { swatchCss } from './swatch-css.js';
import { domainChapter, domainTitle } from './aggregate-chapter.js';
import { domainHref } from './aggregate-env.js';
import { bookLayout } from '../face-scope.js';

/** 本の題(器の `<title>` の後半)。 */
export const BOOK_TITLE = 'システムハンドブック';

/** 生成物の宣言(CSS の注釈)。 */
const CSS_NOTICE = '/* このファイルは全体が生成物である(npm run generate が全置換する)。手で編集しない。写し元はフレームワークの book-face の CSS。 */';

export const bookHtmlGenerator: DocGenerator = {
  id: 'book-html',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const origins = originsOf(model, ctx);
    const unscanned = new Map((ctx.actions?.unscanned ?? []).map((decl) => [decl.event, decl.reason]));
    const roleLabel = roleChips(roleFacts(model), systemRoleId(model.roles.roles));
    const computes = computeIndexOf(ctx.actions?.actions ?? []);
    const label = (name: string): string => model.aggregates.get(name)?.entity?.label ?? name;
    const aggregates = [...model.aggregates.values()];
    const pages: GeneratedSection[] = [];
    // 検索の索引の材料(ページを出した順に積む。examples は別の生成器なので入らない)。
    const searchable: SearchSource[] = [];
    const render = (page: BookPage): string => {
      searchable.push({ file: page.file, title: page.title, body: page.body, headings: page.headings });
      return renderPage(page);
    };

    const overview = overviewChapter(lifecycleAxes(model), allLifecycleFacts(model, origins, unscanned), {
      aggregate: label,
      role: roleLabel,
      chapter: (name) => `./${name}.html`,
    });
    const cover = coverChapter(model, ctx);
    pages.push({
      file: bookFile(ctx.roots, 'index.html'),
      content: render({
        file: 'index.html',
        title: COVER_WORDS.title,
        bookTitle: BOOK_TITLE,
        body: cover.body,
        headings: cover.headings,
        modes: false,
        next: { href: './spec/index.html', title: COVER_WORDS.overview },
      }),
      wholeFile: true,
    });

    const layout = bookLayout(model, ctx);
    const first = aggregates[0];
    pages.push({
      file: bookFile(ctx.roots, 'spec/index.html'),
      content: render({
        file: 'spec/index.html',
        title: 'ライフサイクルの全体',
        bookTitle: BOOK_TITLE,
        body: overview.body,
        headings: overview.headings,
        modes: false,
        previous: { href: '../index.html', title: COVER_WORDS.title },
        ...(first === undefined
          ? {}
          : {
              next: {
                href: `./${first.name}.html`,
                title: aggregateTitle(first.name, first.entity?.label),
              },
            }),
      }),
      wholeFile: true,
    });

    aggregates.forEach((specs, index) => {
      const fields = new Map((specs.entity?.fields ?? []).map((field) => [field.name, field.label ?? field.name]));
      const title = aggregateTitle(specs.name, specs.entity?.label);
      const chapter = aggregateChapter(
        title,
        SPEC_LEAD,
        specs.stateMachines.map((machine) => lifecycleFacts(model, specs.name, machine, origins, unscanned)),
        aggregateAccessFacts(model, specs.name),
        invariantFacts(model, specs.name, computes),
        {
          domain: domainHref(layout, specs.name, '../domain/'),
          role: roleLabel,
          field: (field) => fields.get(field) ?? field,
          entity: label,
        },
      );
      const neighbor = (offset: number): PageLink | undefined => {
        const other = aggregates[index + offset];
        return other === undefined
          ? undefined
          : {
              href: `./${other.name}.html`,
              title: aggregateTitle(other.name, other.entity?.label),
            };
      };
      const previous = index === 0 ? { href: './index.html', title: 'ライフサイクルの全体' } : neighbor(-1);
      const next = neighbor(1);
      pages.push({
        file: bookFile(ctx.roots, `spec/${specs.name}.html`),
        content: render({
          file: `spec/${specs.name}.html`,
          title,
          bookTitle: BOOK_TITLE,
          body: chapter.body,
          headings: chapter.headings,
          modes: false,
          ...(previous === undefined ? {} : { previous }),
          ...(next === undefined ? {} : { next }),
        }),
        wholeFile: true,
      });
    });

    // 集約の章(`domain/{集約}.html`。章を持つ集約だけ。従属する集約は親の章の節になる)。
    const flows = allLifecycleFacts(model, origins, unscanned);
    const lifecycle = (aggregate: string, machine: string) => flows.find((facts) => facts.aggregate === aggregate && facts.machine === machine);
    const roots = bookLayout(model, ctx).roots.filter((name) => model.aggregates.has(name));
    roots.forEach((name, index) => {
      const chapter = domainChapter(model, ctx, name, lifecycle);
      if (chapter === null) return;
      const neighbor = (offset: number): PageLink | undefined => {
        const other = roots[index + offset];
        return other === undefined ? undefined : { href: `./${other}.html`, title: domainTitle(model, other) };
      };
      const previous = neighbor(-1);
      const next = neighbor(1);
      pages.push({
        file: bookFile(ctx.roots, `domain/${name}.html`),
        content: render({
          file: `domain/${name}.html`,
          title: domainTitle(model, name),
          bookTitle: BOOK_TITLE,
          body: chapter.body,
          headings: chapter.headings,
          modes: true,
          ...(previous === undefined ? {} : { previous }),
          ...(next === undefined ? {} : { next }),
        }),
        wholeFile: true,
      });
    });

    // 層の章(章のファイル(`chapters.ts` の `file`)を数の鍵にし、同じ名前の .html に書く)。
    const layer = (name: string, title: string, build: (countKey: string, file: string) => ChapterBody): void => {
      const chapter = build(bookFile(ctx.roots, `${name}.md`), bookFile(ctx.roots, `${name}.html`));
      pages.push({
        file: bookFile(ctx.roots, `${name}.html`),
        content: render({
          file: `${name}.html`,
          title,
          bookTitle: BOOK_TITLE,
          body: chapter.body,
          headings: chapter.headings,
          modes: true,
        }),
        wholeFile: true,
      });
    };
    if (ctx.notifications?.available === true) {
      const catalog = ctx.notifications.catalog;
      layer('notifications', NOTIFICATIONS_TITLE, (key, file) => notificationsChapter(model, ctx, catalog, key, file));
    }
    if (ctx.jobs?.available === true) {
      const catalog = ctx.jobs.catalog;
      layer('jobs', JOBS_TITLE, (key, file) => jobsChapter(model, ctx, catalog, key, file, './notifications.html'));
    }
    if (ctx.config?.available === true) {
      const catalog = ctx.config.catalog;
      layer('config', CONFIG_TITLE, (key, file) => configChapter(model, ctx, catalog, key, file));
    }
    if (ctx.auth?.available === true) {
      const flow = ctx.auth.flow;
      layer('auth', AUTH_TITLE, (key, file) => authChapter(model, ctx, flow, key, file));
    }
    if (ctx.guarantees?.available === true) {
      const catalog = ctx.guarantees.catalog;
      layer('guarantees', GUARANTEES_TITLE, (key, file) => guaranteesChapter(model, ctx, catalog, key, file));
    }
    if (ctx.screens?.available === true) {
      const screens = ctx.screens;
      layer('screens', SCREENS_TITLE, (key, file) => screensChapter(model, ctx, screens, key, file));
    }
    layer('visibility', VISIBILITY_TITLE, (key, file) => visibilityChapter(model, ctx, key, file));
    if (ctx.actions !== undefined) {
      const actions = ctx.actions;
      layer('actions', ACTIONS_TITLE, (key, file) => actionsChapter(model, ctx, actions, key, file));
    }
    if (ctx.external?.available === true) {
      const catalog = ctx.external.catalog;
      layer('external', EXTERNAL_TITLE, (key, file) => externalChapter(model, ctx, catalog, key, file));
    }
    if (ctx.usecases?.available === true) {
      const usecases = ctx.usecases;
      layer('usecases', USECASES_TITLE, (key, file) => usecasesChapter(model, ctx, usecases, key, file));
    }
    if (ctx.dataTables?.available === true) {
      const dataTables = ctx.dataTables;
      layer('data', DATA_TITLE, (key, file) => dataChapter(model, ctx, dataTables, key, file));
    }
    if (ctx.design?.available === true && ctx.design.spec !== null) {
      const spec = ctx.design.spec;
      layer('design', DESIGN_TITLE, (key, file) => designChapter(model, ctx, spec, key, file));
    }
    if (ctx.uxPrinciples?.available === true && ctx.uxPrinciples.spec !== null && ctx.uxPrinciples.spec !== undefined) {
      const spec = ctx.uxPrinciples.spec;
      layer('ux-principles', UX_TITLE, (key, file) => uxPrinciplesChapter(model, ctx, spec, key, file));
    }
    if (ctx.actions !== undefined) {
      layer('sweep', SWEEP_TITLE, () => sweepChapter(model, ctx));
    }
    // 書き方の例は実ファイルから抜粋を引くので、別の生成器(`examples-generator.ts`)が書く。
    layer('review-guide', REVIEW_GUIDE_TITLE, (_key, file) => reviewGuideChapter(model, ctx, file));

    pages.push({
      file: bookFile(ctx.roots, 'assets/book.js'),
      content: BOOK_CLIENT_SCRIPT,
      wholeFile: true,
    });
    pages.push({
      file: bookFile(ctx.roots, 'assets/search.json'),
      content: searchIndexJson(searchable),
      wholeFile: true,
    });
    const face = ctx.book?.faceCss;
    if (face !== undefined)
      pages.push({
        file: bookFile(ctx.roots, 'assets/face.css'),
        content: `${CSS_NOTICE}\n${face}${swatchCss(ctx.design?.spec)}`,
        wholeFile: true,
      });
    return pages;
  },
};
