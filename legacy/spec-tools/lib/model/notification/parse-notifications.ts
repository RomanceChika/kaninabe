/**
 * notification_spec(通知カタログ)のパーサー(N0 = スキーマ適合 + 語彙の閉世界)。
 *
 * スキーマの正: notification-spec-writing.md。
 * ここで見るのは 1 ファイルの中で閉じる形だけである — 行の `medium` / `audience` / `mention` が
 * **同じファイルが宣言した語彙**に載っていること(語彙の一覧を体系側に持たないための形)と、
 * `trigger` がフレームワーク固定の値域にあること。`effects` との双方向突合は N1 が行う。
 */

import type { SpecReporter } from '../parse-common.js';
import { checkDocType, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import { parseAllowsPersonMention, parseMentionsPerson, parsePersonFrom } from './parse-person-mention.js';
import { parseRecipient } from './parse-recipient.js';
import type {
  NotificationCatalogSpec,
  NotificationDecl,
  NotificationTermDecl,
  NotificationTrigger,
  NotificationVocabularyAxis,
} from './types.js';
import {
  NOTIFICATION_TRIGGERS,
  NOTIFICATION_VOCABULARY_AXES,
} from './types.js';

/** 識別子(スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** カタログの文書 ID(1 プロジェクト 1 カタログなので導出元が無く固定)。 */
export const NOTIFICATION_CATALOG_ID = 'notification-catalog';

/**
 * 通知 ID の接頭辞。
 *
 * 「`effects[].do` のうち通知はどれか」を機械が判別する唯一の手がかりであり、
 * N1 の双方向突合はこの接頭辞で母集合を切る。
 */
export const NOTIFY_PREFIX = 'notify_';

const VOCABULARY_SUGGESTION =
  'vocabulary に medium / audience / mention の語彙を "- id / label" のリストで宣言する' +
  '(語彙はこのアプリの事情なので体系側に持たない — notification-spec-writing.md)';

/**
 * 通知カタログ 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築したカタログと N0 違反
 */
export function parseNotificationCatalog(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<NotificationCatalogSpec> {
  checkDocType(data, 'notification_spec', reporter);
  const root = new YamlReader(data, '', reporter);

  const id = root.requiredString('id', `id を ${NOTIFICATION_CATALOG_ID} と書く(1 プロジェクト 1 カタログ)`);
  if (id !== null && id !== NOTIFICATION_CATALOG_ID) {
    reporter.error('id', `id ${id} はカタログの id ではありません`, `id: ${NOTIFICATION_CATALOG_ID} に直す`, {
      id,
      expected: NOTIFICATION_CATALOG_ID,
    });
  }
  const vocabulary = parseVocabulary(root, reporter);
  const notifications = parseNotifications(root, vocabulary, reporter);
  const testCases = parseTestCases(root, reporter) ?? [];

  return {
    value: {
      id: NOTIFICATION_CATALOG_ID,
      vocabulary,
      notifications,
      testCases,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** vocabulary を軸ごとに読む。軸そのものは体系が持ち、語彙は仕様が宣言する。 */
function parseVocabulary(
  root: YamlReader,
  reporter: SpecReporter,
): Record<NotificationVocabularyAxis, readonly NotificationTermDecl[]> {
  const raw = root.raw('vocabulary');
  const reader =
    raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)
      ? null
      : new YamlReader(raw as Readonly<Record<string, unknown>>, 'vocabulary', reporter);
  if (reader === null) {
    reporter.error('vocabulary', 'vocabulary がありません', VOCABULARY_SUGGESTION);
    reporter.dropRows();
  }
  const result = {} as Record<NotificationVocabularyAxis, readonly NotificationTermDecl[]>;
  for (const axis of NOTIFICATION_VOCABULARY_AXES) {
    result[axis] = reader === null ? [] : parseTerms(reader, axis, reporter);
  }
  return result;
}

/** 1 軸分の語彙を読む。重複した語は突合キーが壊れるのでここで落とす。 */
function parseTerms(
  reader: YamlReader,
  axis: NotificationVocabularyAxis,
  reporter: SpecReporter,
): readonly NotificationTermDecl[] {
  const items = reader.optionalList(axis, VOCABULARY_SUGGESTION);
  if (items.length === 0) {
    reporter.error(`vocabulary.${axis}`, `vocabulary.${axis} が空です`, VOCABULARY_SUGGESTION);
    return [];
  }
  const terms: NotificationTermDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, `vocabulary.${axis}`, reporter, VOCABULARY_SUGGESTION, (item, index) => {
    const id = item.requiredString('id', `id に ${axis} の語(スネークケース)を書く`);
    if (id === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `${axis} の語 ${id} がスネークケースではありません`, VOCABULARY_SUGGESTION, { id });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`vocabulary.${axis}[${index}].id`, `${axis} の語 ${id} が重複しています`, '重複した要素を削除する', { id });
      duplicates += 1;
      return;
    }
    seen.add(id);
    const label = item.optionalLabel('label', 'label に人間向けの表示名を書く(未定なら書かない)');
    const mentionsPerson = parseMentionsPerson(item, id, axis, reporter);
    if (axis !== 'audience') {
      terms.push({
        id,
        ...(label === undefined ? {} : { label }),
        ...(mentionsPerson ? { mentionsPerson } : {}),
      });
      return;
    }
    const recipient = parseRecipient(item, id, reporter);
    if (recipient === null) return;
    const allowsPersonMention = parseAllowsPersonMention(item, id, recipient, reporter);
    terms.push({ id, ...(label === undefined ? {} : { label }), recipient, ...(allowsPersonMention ? { allowsPersonMention } : {}) });
  });
  reporter.settleRows(items.length, terms.length, duplicates);
  return terms;
}

/** notifications を読む。行の語彙は宣言された vocabulary に閉じていなければならない。 */
function parseNotifications(
  root: YamlReader,
  vocabulary: Readonly<Record<NotificationVocabularyAxis, readonly NotificationTermDecl[]>>,
  reporter: SpecReporter,
): readonly NotificationDecl[] {
  const items = root.optionalList(
    'notifications',
    'notifications は "- id / medium / audience / mention / trigger / summary" のリストで書く',
  );
  const notifications: NotificationDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'notifications', reporter, 'id と 4 軸と summary を持つ要素として書く', (item, index) => {
    const id = item.requiredString('id', `id に通知 ID(${NOTIFY_PREFIX}… )を書く`);
    if (id === null) return;
    if (!id.startsWith(NOTIFY_PREFIX) || !SNAKE.test(id)) {
      reporter.error(
        item.pointer('id'),
        `通知 ID ${id} が ${NOTIFY_PREFIX} で始まるスネークケースではありません`,
        `${NOTIFY_PREFIX} 接頭辞は「effects のどれが通知か」の唯一の手がかりなので必須`,
        { id },
      );
      return;
    }
    if (seen.has(id)) {
      reporter.error(`notifications[${index}].id`, `通知 ID ${id} が重複しています`, '重複した行を削除する', { id });
      duplicates += 1;
      return;
    }
    seen.add(id);
    const decl = buildDecl(item, id, vocabulary, reporter);
    if (decl !== null) notifications.push(decl);
  });
  reporter.settleRows(items.length, notifications.length, duplicates);
  return notifications;
}

/** 1 行分の 4 軸と summary を読む。1 つでも読めなければ行ごと落とす。 */
function buildDecl(
  item: YamlReader,
  id: string,
  vocabulary: Readonly<Record<NotificationVocabularyAxis, readonly NotificationTermDecl[]>>,
  reporter: SpecReporter,
): NotificationDecl | null {
  const axes: Partial<Record<NotificationVocabularyAxis, string>> = {};
  for (const axis of NOTIFICATION_VOCABULARY_AXES) {
    const value = item.requiredString(axis, `${axis} を vocabulary.${axis} に宣言した語から選ぶ`);
    if (value === null) return null;
    const known = vocabulary[axis].map((term) => term.id);
    if (!known.includes(value)) {
      reporter.error(
        item.pointer(axis),
        `${axis} ${value} は vocabulary.${axis} に宣言されていません`,
        `vocabulary.${axis} の語(${known.join(' / ') || '未宣言'})から選ぶか、語彙の側に足す`,
        { [axis]: value },
      );
      return null;
    }
    axes[axis] = value;
  }
  const trigger = item.requiredString('trigger', `trigger を ${NOTIFICATION_TRIGGERS.join(' / ')} から書く`);
  if (trigger === null) return null;
  if (!(NOTIFICATION_TRIGGERS as readonly string[]).includes(trigger)) {
    reporter.error(
      item.pointer('trigger'),
      `trigger ${trigger} は値域(${NOTIFICATION_TRIGGERS.join(' / ')})にありません`,
      'auto(effects から自動)/ manual(下書きを人が送る)/ schedule(時刻で起きる走査が emits で積む)のどれかに直す',
      { trigger },
    );
    return null;
  }
  const summary = item.requiredString('summary', 'summary に「何を知らせるか」を 1 行で書く');
  if (summary === null) return null;
  const { medium, audience, mention } = axes;
  if (medium === undefined || audience === undefined || mention === undefined) return null;
  // audience の語が recipient を持たないのは N0 が既に別の違反として記録済み(parseRecipient)。
  // ここで見つからない場合は行ごと落とし、二重の指摘を避ける。
  const recipient = vocabulary.audience.find((term) => term.id === audience)?.recipient;
  if (recipient === undefined) return null;
  const mentionsPerson = vocabulary.mention.find((term) => term.id === mention)?.mentionsPerson === true;
  const allowsPersonMention = vocabulary.audience.find((term) => term.id === audience)?.allowsPersonMention === true;
  const personFrom = parsePersonFrom(
    item,
    { id, mentionsPerson, allowsPersonMention, audience, trigger: trigger as NotificationTrigger },
    reporter,
  );
  if (personFrom === null) return null;
  return {
    id,
    medium,
    audience,
    mention,
    trigger: trigger as NotificationTrigger,
    ...(personFrom === undefined ? {} : { personFrom }),
    summary,
    recipient,
    location: reporter.location(`notifications.${id}`),
  };
}
