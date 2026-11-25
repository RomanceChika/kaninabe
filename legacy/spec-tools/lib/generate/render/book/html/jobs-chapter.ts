/**
 * 「誰も見ていないときに何が動くか(ジョブ)」の章の HTML 版。
 *
 * 中身は `jobs-lower.ts` の行と語で、骨格は `layer-chapter.ts`。上段はジョブ 1 本 = 1 行(時刻で起きるものは行、
 * 積まれるものは表の行)と、失敗したときの語。通知を送るジョブは通知の章が数えるので、下段の積む元の表に畳む。下段の表の行は共有の行(`jobs-lower.ts`)を使う。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { JobCatalogSpec, JobDecl } from '../../../../model/job/types.js';
import { cronWords } from '../../../../semantics/cron-words.js';
import { jobUnits, notificationJobIds, type LayerUnit } from '../../../../semantics/reading-layers.js';
import { acceptCounts, acceptItems } from '../../../../semantics/reading-load.js';
import { collectSigns } from '../../../prose.js';
import { jobsFile } from '../../job-body.js';
import { jobTestTable, scheduleTable, sourceTable, type JobLowerTable } from '../jobs-lower.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { bookLayout } from '../face-scope.js';
import { specRelative } from '../face-sign.js';
import { tableCell } from './config-chapter.js';
import { bold, dash, fold, kv, mark, mono, pts, valueOf } from './face-parts.js';
import { axiomRow, items, layerChapter, type Outline } from './layer-chapter.js';
import { el, join, url, type Child, type Html } from './markup.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const JOBS_TITLE = '誰も見ていないときに何が動くか(ジョブ)';

/** 語の表示(表示名 + 内部名)。 */
function named(label: string | undefined, id: string): Html {
  return label === undefined ? mono(id) : join([`${label} `, mono(id)]);
}

/** `{軸}:{語}` → 表示名。 */
function termLabels(catalog: JobCatalogSpec): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const [axis, terms] of Object.entries(catalog.vocabulary)) {
    for (const term of terms) if (term.label !== undefined) labels.set(`${axis}:${term.id}`, term.label);
  }
  return labels;
}

/** 「いつ」の値。 */
function whenValue(decl: JobDecl): Child {
  const schedule = decl.schedule;
  if (schedule === undefined) return dash();
  const cron = schedule.cron;
  const words = cron === undefined ? null : cronWords(cron);
  return valueOf(
    [
      ...(cron === undefined ? ['まだ動いていない'] : [words, mono(cron)].filter((item) => item !== null)),
      schedule.dueFrom === undefined ? null : join(['基準の時刻 ', mono(schedule.dueFrom)]),
    ].filter((item) => item !== null),
  );
}

/** 時刻で起きるジョブ 1 本の行。 */
function scheduledRow(decl: JobDecl, unit: LayerUnit, labels: ReadonlyMap<string, string>): Html {
  return axiomRow(
    mono(decl.id),
    [kv('決まること', decl.summary), kv('いつ', whenValue(decl)), kv('仕様の語', join(['失敗したら ', named(labels.get(`on_failure:${decl.onFailure}`), decl.onFailure)]))],
    unit.elements,
  );
}

/** 失敗したときの語を選んでいるジョブの数の言い方。 */
function usageWords(term: string, jobs: readonly JobDecl[], sending: ReadonlySet<string>): string {
  const using = jobs.filter((decl) => decl.onFailure === term);
  const timed = using.filter((decl) => decl.schedule !== undefined).length;
  const notifying = using.filter((decl) => sending.has(decl.id)).length;
  if (using.length === 0) return '選んでいるジョブは無い';
  const parts = [`時刻で起きるもの ${timed}`, `積まれるもの ${using.length - timed}`, ...(notifying === 0 ? [] : [`うち通知を送るもの ${notifying}`])];
  return `ジョブ ${using.length} 本(${parts.join('・')})`;
}

/** 失敗したときの語の宣言。 */
function failures(catalog: JobCatalogSpec, units: readonly LayerUnit[], sending: ReadonlySet<string>, outline: Outline): Child[] {
  const unitOf = new Map(units.filter((unit) => unit.kind === 'vocabulary').map((unit) => [unit.id, unit] as const));
  return [
    outline.h3('on-failure', `失敗したときの語(${catalog.vocabulary.on_failure.length})`),
    pts(
      [
        'ジョブが失敗したときの業務の方針を、ここで宣言した語から選ぶ',
        '失敗したときにどうなるかは、語の説明が決める。やり直すか、止めるか、飛ばすかは、語によって違う',
        '語ごとに、その語を選んでいるジョブの数を添える。一部のジョブにしか当てはまらない振る舞いを、ジョブ全体のこととして読まない',
      ],
      true,
    ),
    ...catalog.vocabulary.on_failure.map((term) => {
      const unit = unitOf.get(`on_failure:${term.id}`);
      return unit === undefined
        ? null
        : axiomRow(
            mono(term.id),
            [kv('決まること', term.label === undefined ? dash() : term.label), kv('補足', usageWords(term.id, catalog.jobs, sending))],
            unit.elements,
            `on_failure-${term.id}`,
          );
    }),
  ];
}

/** 下段の表 1 つを折りたたみにする。 */
function lowerFold(entry: JobLowerTable): Html | null {
  return fold(
    entry.fold,
    entry.rows.length === 0
      ? []
      : [
          table(
            entry.headers,
            entry.rows.map((row) => row.map(tableCell)),
          ),
        ],
  );
}

/**
 * ジョブの章の本文と目次。ジョブカタログが読めていなければ、その旨の 1 行だけ。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 * @param notificationsHref 通知の章への相対の URL(通知を送るジョブの読み先)
 */
export function jobsChapter(model: SpecModel, ctx: GenerateContext, catalog: JobCatalogSpec | null, countKey: string, file: string, notificationsHref: string): ChapterBody {
  if (catalog === null) {
    return {
      body: join([el('h1', null, JOBS_TITLE), el('p', null, 'まだジョブカタログを読めていない(スキーマエラーを直すと、ここに一覧が生成される)。')]),
      headings: [],
    };
  }
  const notifications = ctx.notifications?.catalog ?? null;
  const units = jobUnits(catalog, notifications);
  const sending = notificationJobIds(catalog, notifications);
  const labels = termLabels(catalog);
  const catalogFile = jobsFile(ctx.roots);
  const unitOf = new Map(units.filter((unit) => unit.kind === 'declaration').map((unit) => [unit.id, unit] as const));
  const scheduled = catalog.jobs.filter((decl) => decl.schedule !== undefined);
  const queued = catalog.jobs.filter((decl) => decl.schedule === undefined);
  const queuedAxioms = queued.filter((decl) => !sending.has(decl.id));
  const all = pendingFindings(ctx);
  const accepted = acceptItems(acceptCounts([], [], [], [], catalog.jobs)).filter((item) => item.file === catalogFile);
  const terms = catalog.vocabulary.on_failure.length;
  const upper = (outline: Outline): Child[] => [
    outline.h3('scheduled', `時刻で起きるジョブ(${scheduled.length})`),
    scheduled.map((decl) => {
      const unit = unitOf.get(decl.id);
      return unit === undefined ? null : scheduledRow(decl, unit, labels);
    }),
    outline.h3('queued', `イベントなどで積まれるジョブ(${queuedAxioms.length})`),
    sending.size === 0 ? null : pts([`通知を送るジョブ ${sending.size} 本は含めない。同じ ID の通知が、宛先とメンションを決めている`], true),
    queuedAxioms.length === 0
      ? pts(['この種類のジョブは無い'])
      : table(
          ['ジョブ', '決まること', '失敗したら'],
          queuedAxioms.map((decl) => [
            join([mono(decl.id), ' ', mark('axiom')]),
            decl.summary,
            join([`${labels.get(`on_failure:${decl.onFailure}`) ?? decl.onFailure} `, mono(decl.onFailure)]),
          ]),
        ),
    failures(catalog, units, sending, outline),
  ];
  return layerChapter(model, ctx, {
    title: JOBS_TITLE,
    countKey,
    file,
    crumb: { layer: 'ジョブの章', count: `ジョブは ${catalog.jobs.length} 本` },
    intro: [
      '人が押していないのに動くものは、この一覧に載っているものが全部',
      '遷移のあとで積まれるものと、時刻で起きるものがある',
      'これが 1 日止まっていたら誰が困るかを、行ごとに読む',
      '二重に走ったら何が壊れるかも、行ごとに読む',
      sending.size === 0 ? null : join([`通知を送るジョブ ${sending.size} 本は、`, el('a', { href: url(notificationsHref) }, '通知の章'), 'で読む。ここでは下段の表に畳む']),
    ].filter((item) => item !== null),
    axiomBreakdown: `ジョブ ${scheduled.length + queuedAxioms.length} 本(時刻で起きるもの ${scheduled.length})、失敗したときの語 ${terms}`,
    upperBullets: [
      'ジョブ 1 本が 1 行。いつ、何をするか、失敗したらどうするかを並べる',
      '時刻で起きるものは、人の時刻と基準の時刻も並べる',
      '失敗したときの語の宣言も公理',
      '人が判定するのは、止まったら誰が困るか、失敗の方針がそれでよいか',
      '機械が保証するのは、cron の登録との対応と、積む元との対応だけ',
    ],
    upper,
    accept: {
      groups:
        accepted.length === 0
          ? []
          : [
              {
                kind: join(['時刻の登録をまだしていないジョブ(', mono('not_scheduled_reason'), ')']),
                items: accepted,
              },
            ],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: collectSigns(ctx.specSources?.get(catalogFile) ?? '').length,
      signFiles: [catalogFile],
      signPlaces: 'ジョブの仕様',
    },
    reasonedWords: `時刻の登録をまだしていない理由(not_scheduled_reason) ${accepted.length} 件`,
    lower: [scheduleTable(scheduled, labels), sourceTable(model, catalog, queued, labels, sending), jobTestTable(catalog)].map(lowerFold),
    derived: {
      count: scheduled.length + queued.length + catalog.testCases.length,
      lines: [
        `走査の表 ${scheduled.length} 行、積む元の表 ${queued.length} 行、テスト ${catalog.testCases.length} 件`,
        '実装と登録は、cron の登録(vercel.json と migration)と突き合わせる',
      ],
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          join(['ジョブカタログ ', mono(specRelative(catalogFile, ctx)), ' の 1 枚。ブロックは 1 つ']),
          `ジョブ ${catalog.jobs.length} 本(時刻で起きるもの ${scheduled.length}、そのほか ${queued.length}。そのほかのうち通知を送るもの ${sending.size})、失敗したときの語 ${terms}`,
          bold('この章で「全部」と言うのは、このカタログに載っているジョブだけ'),
        ]),
      ],
      [
        bold('公理の数え方'),
        items([
          '数える単位は宣言 1 つ',
          '通知を送るジョブ(通知カタログに同じ ID がある)は数えない。同じ事実を通知の章が公理に数える。ここでは下段の積む元の表に出す',
          'ジョブ 1 本は、何をするか・失敗したらどうするかをまとめて 1 本。時刻で起きるものは、いつと基準の時刻も同じ 1 本に入る',
          '失敗したときの語は、1 語を 1 本',
          join(['種別の語(', mono('kind'), ')・鳴る場所・実装・積む元は数えない。下段の表に出す']),
          '人の時刻は、cron 式を日本時間に直した読み。cron の実行者は UTC で動く',
          '読み替えられない形の cron 式は、式だけを出す。推測で言い換えない',
        ]),
      ],
    ],
  });
}
