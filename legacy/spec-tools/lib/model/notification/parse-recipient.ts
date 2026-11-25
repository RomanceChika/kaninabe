/**
 * 通知カタログの `audience` の語が持つ宛先(`recipient`)の読み(N0 の一部)。
 *
 * 宛先の種別(self / role / channel)の値域とキーの対(role なら role・self なら subject_key)を 1 か所で読む。
 * 語彙の読み取り(`parse-notifications.ts`)が audience の語ごとに呼ぶ。
 */

import type { SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { NotificationRecipientDecl } from './types.js';
import { NOTIFICATION_RECIPIENT_KINDS } from './types.js';

const RECIPIENT_SUGGESTION =
  'recipient に "kind: self / role / channel" のいずれかを書く' +
  '(role なら role: {role_id} を、self なら subject_key: {payload のキー名} を添える)';

/**
 * `audience` の語が持つ `recipient` を読む。
 *
 * 宛先種別(self / role / channel)は体系側の値域だが、`role` の中身(どのロールか)・
 * `self` の `subject_key`(どの payload キーか)はこのアプリの事情であり、
 * ここで宣言させることで実装(`handlers.ts`)から定数を追い出す(notification-spec-writing.md)。
 */
export function parseRecipient(item: YamlReader, audienceId: string, reporter: SpecReporter): NotificationRecipientDecl | null {
  const raw = item.raw('recipient');
  const record =
    raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)
      ? null
      : new YamlReader(raw as Readonly<Record<string, unknown>>, `vocabulary.audience.${audienceId}.recipient`, reporter);
  if (record === null) {
    reporter.error(
      `vocabulary.audience.${audienceId}.recipient`,
      `audience ${audienceId} に recipient がありません`,
      RECIPIENT_SUGGESTION,
      { audience: audienceId },
    );
    return null;
  }
  const kind = record.requiredString('kind', RECIPIENT_SUGGESTION);
  if (kind === null) return null;
  if (!(NOTIFICATION_RECIPIENT_KINDS as readonly string[]).includes(kind)) {
    reporter.error(
      record.pointer('kind'),
      `recipient.kind ${kind} は値域(${NOTIFICATION_RECIPIENT_KINDS.join(' / ')})にありません`,
      RECIPIENT_SUGGESTION,
      { kind },
    );
    return null;
  }
  if (kind === 'role') {
    const role = record.requiredString('role', 'role に宛先のロール ID(roles.md に宣言したもの)を書く');
    if (role === null) return null;
    return { kind: 'role', role };
  }
  if (kind === 'self') {
    const subjectKey = record.requiredString(
      'subject_key',
      'subject_key にジョブ payload から本人のメンバー ID を取り出すキー名を書く(例: member_id)',
    );
    if (subjectKey === null) return null;
    return { kind: 'self', subjectKey };
  }
  return { kind: 'channel' };
}
