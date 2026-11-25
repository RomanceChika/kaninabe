/**
 * 通知カタログ → 実装側の期待表(`app/src/domain/generated/notifications.ts`)の生成器。
 *
 * カタログが宣言する「通知の全数と、その宛先・メンション・経路・発火のしかた」を
 * **実装が突き合わせられる形**に写す。app 側のユニットテストが登録済みハンドラと
 * 双方向に突き合わせ、「仕様に無い通知を送る」「仕様にある通知のハンドラが無い」の
 * 両方を落とす(data-table-expectations と同じ流儀)。
 *
 * 語彙(medium / audience / mention)はこのアプリの宣言なので、型も**カタログから生成する**
 * (体系側に語の一覧を持たない)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { NotificationCatalogSpec, NotificationVocabularyAxis } from '../../model/notification/types.js';
import {
  NOTIFICATION_RECIPIENT_KINDS,
  NOTIFICATION_TRIGGERS,
  NOTIFICATION_VOCABULARY_AXES,
} from '../../model/notification/types.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, toPascalCase, tsString } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'notifications.ts');

/** 軸ごとの TS 型名(`medium` → `NotificationMedium`)。 */
function axisTypeName(axis: NotificationVocabularyAxis): string {
  return `Notification${toPascalCase(axis)}`;
}

/** 語彙 1 軸をユニオン型として出す。 */
function axisType(catalog: NotificationCatalogSpec, axis: NotificationVocabularyAxis): string[] {
  const terms = catalog.vocabulary[axis];
  const union = terms.length === 0 ? 'never' : terms.map((term) => tsString(term.id)).join(' | ');
  return [
    docComment([`${axis} の語彙(カタログの vocabulary.${axis} が正)。`]),
    `export type ${axisTypeName(axis)} = ${union};`,
    '',
  ];
}

/** `NotificationRecipientDecl` をリテラルに写す(undefined のフィールドは出さない)。 */
function recipientLiteral(recipient: NotificationCatalogSpec['notifications'][number]['recipient']): LiteralValue {
  return {
    kind: recipient.kind,
    ...(recipient.role === undefined ? {} : { role: recipient.role }),
    ...(recipient.subjectKey === undefined ? {} : { subjectKey: recipient.subjectKey }),
  };
}

/** 通知 1 本を突合用のリテラルに写す。 */
function notificationLiteral(catalog: NotificationCatalogSpec): LiteralValue {
  return catalog.notifications.map((decl) => ({
    id: decl.id,
    medium: decl.medium,
    audience: decl.audience,
    mention: decl.mention,
    trigger: decl.trigger,
    ...(decl.personFrom === undefined
      ? {}
      : { personFrom: { entity: decl.personFrom.entity, field: decl.personFrom.field } }),
    summary: decl.summary,
    recipient: recipientLiteral(decl.recipient),
  }));
}

/**
 * `audience` の語 → 宛先種別の対応(カタログの `vocabulary.audience[].recipient` が正)。
 *
 * `app/src/operation/jobs/handlers.ts` が手で持っていた同名の定数を置き換える生成物 ——
 * カタログの `recipient` を直せばここも直り、実装側で語を書き写す必要が無くなる。
 */
function audienceRecipientLiteral(catalog: NotificationCatalogSpec): LiteralValue {
  const entries: Record<string, LiteralValue> = {};
  for (const term of catalog.vocabulary.audience) {
    if (term.recipient !== undefined) entries[term.id] = recipientLiteral(term.recipient);
  }
  return entries;
}

/** 期待表のファイル全体を組み立てる。 */
function renderFile(catalog: NotificationCatalogSpec): string {
  const triggers = NOTIFICATION_TRIGGERS.map((trigger) => tsString(trigger)).join(' | ');
  return [
    generatedHeader([catalog.location.file]),
    '',
    ...NOTIFICATION_VOCABULARY_AXES.flatMap((axis) => axisType(catalog, axis)),
    docComment([
      '発火のしかた(auto = effects から自動 / manual = 文面を用意して人が送る /',
      'schedule = 時刻で起きる走査が emits で積む)。',
    ]),
    `export type NotificationTrigger = ${triggers};`,
    '',
    docComment([
      '宛先種別の値域(フレームワーク固定)。`role` の中身(どのロールか)・`self` の',
      '`subjectKey`(どの payload キーか)はこのアプリの事情(カタログの `vocabulary.audience[].recipient` が正)。',
    ]),
    `export type NotificationRecipientKind = ${NOTIFICATION_RECIPIENT_KINDS.map((kind) => tsString(kind)).join(' | ')};`,
    '',
    docComment([
      '宛先種別 1 件。`kind: role` のときだけ `role` を、`kind: self` のときだけ `subjectKey` を持つ。',
    ]),
    'export interface NotificationRecipient {',
    '  readonly kind: NotificationRecipientKind;',
    '  readonly role?: string;',
    '  readonly subjectKey?: string;',
    '}',
    '',
    docComment([
      '通知 1 本の宣言。**突合の対象は 4 軸**(medium / audience / mention / trigger)で、',
      '`summary` はそこに入らない —— こちらは**送る文面の最小要素**として写している。',
      '',
      '文面そのものは運用設定だが、「何を知らせる通知か」の 1 行はすでに仕様にある。',
      '実装がその 1 行を書き写すと仕様と送信文が二重管理になるので、状態の `label` や',
      '不変条件の `statement` と同じ流儀で生成物として渡す(仕様を直せば文面も直る)。',
    ]),
    'export interface NotificationDecl {',
    '  readonly id: string;',
    ...NOTIFICATION_VOCABULARY_AXES.map((axis) => `  readonly ${axis}: ${axisTypeName(axis)};`),
    '  readonly trigger: NotificationTrigger;',
    '  /** 名指す相手を引く出どころ(`mentions_person` の語を選んだ行だけが持つ。`person_from` の `{集約}.{欄}` を分けた写し)。 */',
    '  readonly personFrom?: { readonly entity: string; readonly field: string };',
    '  /** 何を知らせる通知か(カタログの `summary`)。送る文面の最小要素。 */',
    '  readonly summary: string;',
    '  /** 宛先種別(`audience` の語が宣言した `recipient` の写し)。 */',
    '  readonly recipient: NotificationRecipient;',
    '}',
    '',
    docComment([
      'このシステムが送る通知の**全数**(閉世界)。',
      '',
      'ここに無い通知を実装が送ってはならず、ここにある通知はハンドラを持たなければならない。',
      '突合は app/src/operation/__tests__/jobs/notification-catalog.test.ts。',
    ]),
    `export const NOTIFICATIONS: readonly NotificationDecl[] = ${renderLiteral(notificationLiteral(catalog))};`,
    '',
    docComment([
      '`audience` の語 → 宛先種別の対応(カタログの `vocabulary.audience[].recipient` が正)。',
      '',
      '実装(`app/src/operation/jobs/handlers.ts`)はこれを引くだけで、宛先種別を手で持たない。',
    ]),
    `export const AUDIENCE_RECIPIENT: Readonly<Record<NotificationAudience, NotificationRecipient>> = ${renderLiteral(
      audienceRecipientLiteral(catalog),
    )};`,
    '',
  ].join('\n');
}

/**
 * 通知カタログから実装側の期待表を生成するジェネレーター。
 * 出力は app/src/domain/generated/notifications.ts の 1 ファイル(全置換)。
 */
export const notificationExpectationsGenerator: DocGenerator = {
  id: 'code-notifications',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.notifications?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(catalog), wholeFile: true }];
  },
};
