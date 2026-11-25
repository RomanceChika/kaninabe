/**
 * 「誰に何が飛ぶか(通知)」の章の HTML 版。
 *
 * 骨格は `layer-chapter.ts`。上段は通知 1 本 = 1 行と、宛先・メンションの語の宣言。
 * 発火元とテストは下段に畳む。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { NotificationCatalogSpec, NotificationDecl, NotificationTermDecl, NotificationTrigger } from '../../../../model/notification/types.js';
import type { JobCatalogSpec } from '../../../../model/job/types.js';
import { notificationUnits, type LayerUnit } from '../../../../semantics/reading-layers.js';
import { collectSigns } from '../../../prose.js';
import { firingEvents, notificationsFile, originCells } from '../../notification-body.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { bookLayout } from '../face-scope.js';
import { specRelative } from '../face-sign.js';
import { tableCell } from './config-chapter.js';
import { bold, dash, fold, kv, mono, pts, valueOf } from './face-parts.js';
import { axiomRow, items, layerChapter, type Outline } from './layer-chapter.js';
import { el, join, type Child, type Html } from './markup.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const NOTIFICATIONS_TITLE = '誰に何が飛ぶか(通知)';

/** 発火のしかたの言い方。 */
const TRIGGER_WORDS: Readonly<Record<NotificationTrigger, string>> = {
  auto: '遷移のあとで自動',
  manual: '人が送信を押したとき',
  schedule: '時刻で起きる走査が積んだとき',
};

/** 語の表示(表示名 + 内部名)。 */
function named(label: string | undefined, id: string): Html {
  return label === undefined ? mono(id) : join([`${label} `, mono(id)]);
}

/** `{軸}:{語}` → 表示名。 */
function termLabels(catalog: NotificationCatalogSpec): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const [axis, terms] of Object.entries(catalog.vocabulary)) {
    for (const term of terms) if (term.label !== undefined) labels.set(`${axis}:${term.id}`, term.label);
  }
  return labels;
}

/** その通知を積むジョブが失敗したときの方針(ジョブが無い通知は出さない)。 */
function failureLine(id: string, jobs: JobCatalogSpec | null): Html | null {
  const job = jobs?.jobs.find((decl) => decl.id === id && decl.schedule === undefined);
  if (jobs === null || job === undefined) return null;
  const label = jobs.vocabulary.on_failure.find((term) => term.id === job.onFailure)?.label;
  return kv('例外', join(['積むジョブが失敗したとき: ', named(label, job.onFailure)]));
}

/** 通知 1 本の行。 */
function notificationRow(decl: NotificationDecl, unit: LayerUnit, labels: ReadonlyMap<string, string>, jobs: JobCatalogSpec | null): Html {
  return axiomRow(
    mono(decl.id),
    [
      kv('決まること', decl.summary),
      kv('どこへ', named(labels.get(`audience:${decl.audience}`), decl.audience)),
      kv('いつ', join([`${TRIGGER_WORDS[decl.trigger]} `, mono(decl.trigger)])),
      kv(
        '仕様の語',
        join([
          'メンション ',
          named(labels.get(`mention:${decl.mention}`), decl.mention),
          decl.personFrom === undefined ? null : join([' ← ', mono(`${decl.personFrom.entity}.${decl.personFrom.field}`)]),
        ]),
      ),
      failureLine(decl.id, jobs),
    ],
    unit.elements,
  );
}

/** 通知の行を宛先の語ごとにまとめて並べる。 */
function notificationRows(catalog: NotificationCatalogSpec, units: readonly LayerUnit[], labels: ReadonlyMap<string, string>, jobs: JobCatalogSpec | null): Child[] {
  const unitOf = new Map(units.filter((unit) => unit.kind === 'declaration').map((unit) => [unit.id, unit] as const));
  const order = [...new Set([...catalog.vocabulary.audience.map((term) => term.id), ...catalog.notifications.map((decl) => decl.audience)])];
  return order.flatMap((audience) => {
    const group = catalog.notifications.filter((decl) => decl.audience === audience);
    if (group.length === 0) return [];
    return [
      el('p', { class: 'bf-group' }, labels.get(`audience:${audience}`) ?? audience, el('small', null, `${audience} · ${group.length} 本`)),
      ...group.map((decl) => {
        const unit = unitOf.get(decl.id);
        return unit === undefined ? null : notificationRow(decl, unit, labels, jobs);
      }),
    ];
  });
}

/** 語の行(宛先の語・メンションの語)。 */
function termRow(axis: 'audience' | 'mention', term: NotificationTermDecl, unit: LayerUnit): Html {
  const notes = [
    ...(term.allowsPersonMention === true ? ['特定の 1 人を名指すメンションと組める'] : []),
    ...(term.mentionsPerson === true ? ['特定の 1 人を名指す。行に person_from が要る'] : []),
  ];
  return axiomRow(
    mono(term.id),
    [
      kv('決まること', term.label === undefined ? dash() : term.label),
      term.recipient === undefined
        ? null
        : kv(
            '仕様の語',
            valueOf(
              [join(['種別 ', mono(term.recipient.kind)]), term.recipient.role === undefined ? null : join(['ロール ', mono(term.recipient.role)])].filter((item) => item !== null),
            ),
          ),
      notes.length === 0 ? null : kv('補足', valueOf(notes)),
    ],
    unit.elements,
    `${axis}-${term.id}`,
  );
}

/** 宛先とメンションの語の宣言。 */
function vocabulary(catalog: NotificationCatalogSpec, units: readonly LayerUnit[], outline: Outline): Child[] {
  const unitOf = new Map(units.filter((unit) => unit.kind === 'vocabulary').map((unit) => [unit.id, unit] as const));
  const rows = (axis: 'audience' | 'mention', title: string): Child[] => [
    el('p', { class: 'bf-group' }, title, el('small', null, `${catalog.vocabulary[axis].length} 語`)),
    ...catalog.vocabulary[axis].map((term) => {
      const unit = unitOf.get(`${axis}:${term.id}`);
      return unit === undefined ? null : termRow(axis, term, unit);
    }),
  ];
  return [
    outline.h3('vocabulary', `宛先とメンションの語(${catalog.vocabulary.audience.length + catalog.vocabulary.mention.length})`),
    pts(
      [
        '通知の宛先とメンションは、ここで宣言した語から選ぶ',
        '語の意味は、このアプリの事情として、仕様が宣言する',
        '誰に届く種別か、特定の 1 人を名指せるかは、現実との照合相手が無い。人が判定する',
        '機械が保証するのは、行が語を選んでいることと、特定の 1 人を名指す語の組み合わせだけ',
      ],
      true,
    ),
    ...rows('audience', '宛先の語'),
    ...rows('mention', 'メンションの語'),
  ];
}

/** 下段(発火元と経路・テスト)。 */
function lower(model: SpecModel, catalog: NotificationCatalogSpec, jobs: JobCatalogSpec | null, labels: ReadonlyMap<string, string>): Child[] {
  const events = firingEvents(model);
  const sources = catalog.notifications.map((decl) => [
    mono(decl.id),
    tableCell(originCells(decl.id, events, jobs).join(', ') || '—(人が送る)'),
    join([`${labels.get(`medium:${decl.medium}`) ?? decl.medium}(`, mono(decl.medium), ')']),
  ]);
  const tests = catalog.testCases.map((testCase) => [testCase.id, testCase.type, mono(testCase.implementation.raw)]);
  return [
    fold(
      {
        kind: 'table',
        title: '発火元と経路(通知ごと)',
        count: sources.length,
        hint: 'どの遷移・走査がこの通知を積むか。双方向に閉じている',
        element: 'notification.source',
      },
      sources.length === 0 ? [] : [table(['通知', '発火元(イベント / 走査)', '経路'], sources)],
    ),
    fold(
      {
        kind: 'table',
        title: 'テスト(宣言と実装の突合)',
        count: tests.length,
        hint: '仕様の test_cases の行数',
        element: 'notification.tests',
      },
      tests.length === 0 ? [] : [table(['ID', 'type', '実装'], tests)],
    ),
  ];
}

/**
 * 通知の章の本文と目次。通知カタログが読めていなければ、その旨の 1 行だけ。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function notificationsChapter(model: SpecModel, ctx: GenerateContext, catalog: NotificationCatalogSpec | null, countKey: string, file: string): ChapterBody {
  if (catalog === null) {
    return {
      body: join([el('h1', null, NOTIFICATIONS_TITLE), el('p', null, 'まだ通知カタログを読めていない(スキーマエラーを直すと、ここに一覧が生成される)。')]),
      headings: [],
    };
  }
  const units = notificationUnits(catalog);
  const labels = termLabels(catalog);
  const catalogFile = notificationsFile(ctx.roots);
  const all = pendingFindings(ctx);
  const jobs = ctx.jobs?.catalog ?? null;
  const audienceTerms = catalog.vocabulary.audience.length;
  const mentionTerms = catalog.vocabulary.mention.length;
  return layerChapter(model, ctx, {
    title: NOTIFICATIONS_TITLE,
    countKey,
    file,
    crumb: {
      layer: '通知の章',
      count: `通知は ${catalog.notifications.length} 本`,
    },
    intro: [
      '通知はこの一覧に載っているものが全部',
      'ここに無い送信は実装してはならない',
      'この人にこの知らせが届いてよいかを、行ごとに読む',
      'メンションで全員を起こす価値があるかも、行ごとに読む',
    ],
    axiomBreakdown: `通知 ${catalog.notifications.length} 本、宛先の語 ${audienceTerms}、メンションの語 ${mentionTerms}`,
    upperBullets: [
      '通知 1 本が 1 行。宛先、何を知らせるか、いつ、メンションを並べる。積むジョブがあれば、失敗したときの方針も添える',
      '宛先の語とメンションの語の宣言も公理',
      '人が判定するのは、この宛先にこの知らせが届いてよいかどうか',
      '機械が保証するのは、発火元との対応と、語の実在だけ',
    ],
    upper: (outline) => [outline.h3('notifications', `通知(${catalog.notifications.length})`), notificationRows(catalog, units, labels, jobs), vocabulary(catalog, units, outline)],
    accept: {
      groups: [],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: collectSigns(ctx.specSources?.get(catalogFile) ?? '').length,
      signFiles: [catalogFile],
      signPlaces: '通知の仕様',
    },
    reasonedWords: '通知の仕様に、理由を書く欄は無い',
    lower: lower(model, catalog, jobs, labels),
    derived: {
      count: catalog.notifications.length + catalog.testCases.length,
      lines: [`発火元と経路の表 ${catalog.notifications.length} 行、テスト ${catalog.testCases.length} 件`, '発火元は、遷移の effects と、走査の emits から引く'],
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          join(['通知カタログ ', mono(specRelative(catalogFile, ctx)), ' の 1 枚。ブロックは 1 つ']),
          `通知 ${catalog.notifications.length} 本、宛先の語 ${audienceTerms}、メンションの語 ${mentionTerms}`,
          bold('この章で「全部」と言うのは、このカタログに載っている通知だけ'),
        ]),
      ],
      [
        bold('公理の数え方'),
        items([
          '数える単位は宣言 1 つ',
          '通知 1 本は、宛先・メンション・何を知らせるかの 3 つをまとめて 1 本',
          '積むジョブ(通知と同じ ID)が失敗したときの方針は、同じ行に添える。ジョブの章は数えないので、数は増えない。積む元の表は、ジョブの章の下段に残る',
          '宛先の語とメンションの語は、1 語を 1 本。語の宣言は、誰に届く種別か、特定の 1 人を名指せるかを決める',
          join(['経路の語(', mono('medium'), ')は数えない。発火元と並べて、下段の表に出す']),
          '機械が導けないものは、原文を残す。通知が届いてよい相手かどうかは、人が判定する',
          '宛先の実際の URL とメンションの文字列は、運用設定が持つ。仕様は誰に飛ぶかだけを宣言する',
        ]),
      ],
    ],
  });
}
