/**
 * 通知カタログ(docs/specs/backend/notifications.md)の本文ブロックの生成器。
 *
 * YAML フロントマターが正であり、本文はそのマトリクスにすぎない(生成は情報を足さない)。
 * 「どの操作で誰に何が飛ぶか」を 1 枚で読めるようにするため、`trigger: auto` の行には
 * その通知を発火しているドメインイベントを **effects から引いて**添える(宣言の二重化を避ける)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type {
  NotificationCatalogSpec,
  NotificationDecl,
  NotificationTermDecl,
  NotificationVocabularyAxis,
} from '../../model/notification/types.js';
import { NOTIFICATION_VOCABULARY_AXES } from '../../model/notification/types.js';
import { collectNotifyEffects } from '../../semantics/effect-refs.js';
import { emittedBy } from '../../job/emits.js';
import type { JobCatalogSpec } from '../../model/job/types.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先(リポジトリルート相対)。 */
export function notificationsFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/notifications.md');
}

/** 軸の見出し(語彙の表に出す日本語)。 */
const AXIS_TITLE: Readonly<Record<NotificationVocabularyAxis, string>> = {
  medium: '送信経路(medium)',
  audience: '宛先(audience)',
  mention: 'メンション(mention)',
};

/** 本人を名指す語(`mentions_person`)の表示名に添える注記(語を選んだ行が `person_from` を持つことの案内)。 */
export const PERSON_TERM_NOTE = '(本人を名指す。行に person_from が要る)';

/** 本人を名指すメンションと組める宛先の語(`allows_person_mention`)の表示名に添える注記。 */
export const PERSON_AUDIENCE_NOTE = '(本人を名指すメンションと組める)';

/**
 * 語彙の語の表示名に、機械が読む宣言(`mentions_person` / `allows_person_mention`)の注記を添える。
 *
 * @param term 語彙の語
 * @returns 表のセルの文字列(エスケープ前)
 */
export function termLabelCell(term: NotificationTermDecl): string {
  return `${term.label ?? '—'}${term.mentionsPerson === true ? PERSON_TERM_NOTE : ''}${
    term.allowsPersonMention === true ? PERSON_AUDIENCE_NOTE : ''
  }`;
}

/**
 * メンションの列の語。本人を名指す行は、本人のメンバー ID の出どころ(`person_from`)を `←` で添える。
 *
 * @param decl 通知 1 本の宣言
 * @param shown 語の表示(表示名つきにする側が組む)
 * @returns 表のセルの文字列(エスケープ前)
 */
export function mentionCell(decl: NotificationDecl, shown: string): string {
  return decl.personFrom === undefined ? shown : `${shown} ← \`${decl.personFrom.entity}.${decl.personFrom.field}\``;
}

/**
 * 通知 ID → それを発火しているドメインイベントの一覧を作る。
 *
 * @param model ドメイン仕様全体
 * @returns 通知 ID をキーにしたイベント ID の並び(宣言順・重複なし)
 */
export function firingEvents(model: SpecModel): ReadonlyMap<string, readonly string[]> {
  const byId = new Map<string, string[]>();
  for (const ref of collectNotifyEffects(model)) {
    const events = byId.get(ref.id) ?? [];
    if (!events.includes(ref.event)) events.push(ref.event);
    byId.set(ref.id, events);
  }
  return byId;
}

/**
 * 通知の「発火元」の列の語(遷移のイベント + 積む走査)。
 *
 * 走査は `走査 \`id\`` と書いて、遷移のイベントと区別する(`trigger: schedule` は走査だけが元になる)。
 */
export function originCells(
  id: string,
  events: ReadonlyMap<string, readonly string[]>,
  jobs: JobCatalogSpec | null,
): readonly string[] {
  return [
    ...(events.get(id) ?? []).map((event) => `\`${event}\``),
    ...(emittedBy(jobs).get(id) ?? []).map((scan) => `走査 \`${scan}\``),
  ];
}

/** 語彙の表(このアプリが宣言した語のカタログ)。 */
function vocabularySection(catalog: NotificationCatalogSpec): string {
  const rows = NOTIFICATION_VOCABULARY_AXES.flatMap((axis) =>
    catalog.vocabulary[axis].map((term) => [
      cell(AXIS_TITLE[axis]),
      cell(`\`${term.id}\``),
      cell(termLabelCell(term)),
    ]),
  );
  return ['### 語彙(このカタログが宣言する値域)', '', markdownTable(['軸', '語', '表示名'], rows)].join('\n');
}

/** 通知の全数の表。 */
function catalogSection(
  catalog: NotificationCatalogSpec,
  events: ReadonlyMap<string, readonly string[]>,
  jobs: JobCatalogSpec | null,
): string {
  if (catalog.notifications.length === 0) {
    return '### 通知の全数\n\nまだ通知の宣言がありません。';
  }
  const rows = catalog.notifications.map((decl) => [
    cell(`\`${decl.id}\``),
    cell(decl.trigger),
    cell(originCells(decl.id, events, jobs).join(', ') || '—(人が送る)'),
    cell(decl.audience),
    cell(mentionCell(decl, decl.mention)),
    cell(decl.medium),
    cell(decl.summary),
  ]);
  return [
    '### 通知の全数(effects と双方向に閉じている)',
    '',
    markdownTable(['通知 ID', '発火', '発火元(イベント / 走査)', '宛先', 'メンション', '経路', '何を知らせるか'], rows),
  ].join('\n');
}

/** テストケースの表(data-table-body と同じ形)。 */
function testCaseSection(catalog: NotificationCatalogSpec): string {
  const rows = catalog.testCases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    cell((testCase.covers ?? []).join(', ')),
    cell(testCase.specIds.join(', ')),
    cell(`\`${testCase.implementation.raw}\``),
  ]);
  return ['### テストケース', '', markdownTable(['ID', 'type', 'covers', 'spec_ids', 'implementation'], rows)].join('\n');
}

/**
 * 通知カタログの本文ブロックを生成するジェネレーター。
 * 出力は notifications.md の `notification-body` マーカー 1 か所。
 */
export const notificationBodyGenerator: DocGenerator = {
  id: 'notification-body',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.notifications?.catalog;
    if (catalog === undefined || catalog === null) return [];
    const events = firingEvents(model);
    return [
      {
        file: notificationsFile(ctx.roots),
        marker: 'notification-body',
        content: [
          vocabularySection(catalog),
          catalogSection(catalog, events, ctx.jobs?.catalog ?? null),
          testCaseSection(catalog),
        ].join('\n\n'),
      },
    ];
  },
};
