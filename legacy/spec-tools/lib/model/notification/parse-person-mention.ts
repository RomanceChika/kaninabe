/**
 * 通知カタログの「本人を名指すメンション」の読み(N0 の一部。`mentions_person` と `person_from`)。
 *
 * `parse-notifications.ts` から切り出した。見るのは 1 ファイルの中で閉じる形(語と行の対・形・宛先がチャンネル)だけで、
 * 集約・欄の実在とメンバーへの参照であることはドメインの仕様が要るので N2(`verifiers/n2-person-mention.ts`)が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type {
  NotificationPersonFrom,
  NotificationRecipientDecl,
  NotificationTrigger,
  NotificationVocabularyAxis,
} from './types.js';

const ALLOWANCE_KEY = 'allows_person_mention';

/**
 * 語の `mentions_person` を読む(`mention` の語だけが書ける)。
 *
 * 他の軸の語に書いても機械は読まないので、書き間違いとして落とす(黙って無視すると、本人を名指す
 * つもりの宣言が効かないまま通る)。
 */
export function parseMentionsPerson(
  item: YamlReader,
  termId: string,
  axis: NotificationVocabularyAxis,
  reporter: SpecReporter,
): boolean {
  rejectMisplacedAllowance(item, termId, axis, reporter);
  if (axis !== 'mention') {
    if (item.has('mentions_person')) {
      reporter.error(
        item.pointer('mentions_person'),
        `${axis} の語 ${termId} に mentions_person は書けません(mention の語だけが持つ)`,
        'mentions_person を消す(本人を名指すのは mention の語の宣言)',
        { id: termId },
      );
    }
    return false;
  }
  return item.optionalBoolean(
    'mentions_person',
    'mentions_person: true と書くと、その語の行は person_from(本人のメンバー ID の出どころ)を持つ',
  );
}

/** `person_from` の形(`{集約}.{欄}`。どちらもスネークケース)。 */
const PERSON_FROM_SHAPE = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

const PERSON_FROM_SUGGESTION =
  'person_from に本人のメンバー ID の出どころを "{集約}.{欄}" で書く(例: 通知を起こした集約が持つメンバーへの参照の欄)';

/**
 * 行の `person_from` を読む(語の宣言との対・形・宛先との組み合わせ = N0)。
 *
 * - 本人を名指す語(`mentions_person`)の行は必ず書く / それ以外の行は書けない(どちらも落とす)
 * - **手動(`manual`)の行は本人を名指せない** — 人が下書きを見て送る通知は、通知を起こした集約の行から本人を機械が
 *   引く経路に乗らない(発火元が無い。書いても黙って名指さずに送るので、通らないようにする)
 * - 形は `{集約}.{欄}`。集約・欄の実在と「メンバーへの参照であること」はドメインの仕様が要るので N2 が見る
 * - 本人を名指せる宛先は、語が `allows_person_mention` を宣言したものだけである(その語はチャンネル宛に限る)
 *
 * @returns 読めた出どころ。書かない行は undefined。違反で行ごと落とすなら null
 */
export function parsePersonFrom(
  item: YamlReader,
  row: {
    readonly id: string;
    readonly mentionsPerson: boolean;
    readonly allowsPersonMention: boolean;
    readonly audience: string;
    readonly trigger: NotificationTrigger;
  },
  reporter: SpecReporter,
): NotificationPersonFrom | undefined | null {
  const raw = item.optionalString('person_from', PERSON_FROM_SUGGESTION);
  if (!row.mentionsPerson) {
    if (raw === undefined) return undefined;
    reporter.error(
      item.pointer('person_from'),
      `通知 ${row.id} は本人を名指す mention ではないので person_from は書けません`,
      'person_from を消すか、mention を mentions_person を宣言した語(vocabulary.mention)にする',
      { id: row.id },
    );
    return null;
  }
  if (row.trigger === 'manual') {
    reporter.error(
      item.pointer('mention'),
      `通知 ${row.id} は trigger: manual なので本人を名指す mention は選べません`,
      'mention を本人を名指さない語にする(manual は人が下書きを見て送るので、本人の出どころを機械が読まない)。' +
        '本人を名指す通知は trigger を auto か schedule にする',
      { id: row.id, trigger: row.trigger },
    );
    return null;
  }
  if (raw === undefined) {
    reporter.error(
      item.pointer('person_from'),
      `通知 ${row.id} は本人を名指す mention ですが person_from がありません`,
      PERSON_FROM_SUGGESTION,
      { id: row.id },
    );
    return null;
  }
  const shape = PERSON_FROM_SHAPE.exec(raw);
  if (shape === null) {
    reporter.error(
      item.pointer('person_from'),
      `通知 ${row.id} の person_from ${raw} が "{集約}.{欄}" の形ではありません`,
      PERSON_FROM_SUGGESTION,
      { id: row.id, person_from: raw },
    );
    return null;
  }
  if (!row.allowsPersonMention) {
    reporter.error(
      item.pointer('audience'),
      `通知 ${row.id} は本人を名指す mention ですが、宛先 ${row.audience} は本人を名指せる宛先ではありません`,
      `本人を名指せる宛先の語に ${ALLOWANCE_KEY}: true を宣言する(宣言できるのはチャンネル宛の語だけ)か、audience を宣言のある語にする` +
        '(個人を名指してよい宛先はアプリの判断で、公開の場には宣言しない)',
      { id: row.id, audience: row.audience },
    );
    return null;
  }
  return { entity: shape[1] ?? '', field: shape[2] ?? '' };
}

/**
 * 宛先の語の `allows_person_mention` を読む(`audience` の語だけ。**チャンネル宛の語だけが宣言できる**)。
 *
 * ロール宛・本人宛の語が宣言すると、名指す相手が二重になる(宛先の集合に本人が重なる)ので落とす。
 *
 * @returns 宣言していれば true
 */
export function parseAllowsPersonMention(
  item: YamlReader,
  termId: string,
  recipient: NotificationRecipientDecl,
  reporter: SpecReporter,
): boolean {
  const declared = item.optionalBoolean(
    ALLOWANCE_KEY,
    `${ALLOWANCE_KEY}: true と書くと、その宛先の行は本人を名指す mention を選べる(チャンネル宛の語だけ)`,
  );
  if (declared && recipient.kind !== 'channel') {
    reporter.error(
      item.pointer(ALLOWANCE_KEY),
      `宛先の語 ${termId} は recipient.kind が channel ではないので ${ALLOWANCE_KEY} を宣言できません`,
      `本人を名指せるのはチャンネル宛だけ(ロール宛・本人宛では名指す相手が二重になる)。${ALLOWANCE_KEY} を消す`,
      { id: termId, kind: recipient.kind },
    );
    return false;
  }
  return declared;
}

/** `audience` 以外の語に `allows_person_mention` を書いたら落とす(機械は読まないので、黙って無視しない)。 */
function rejectMisplacedAllowance(
  item: YamlReader,
  termId: string,
  axis: NotificationVocabularyAxis,
  reporter: SpecReporter,
): void {
  if (axis === 'audience' || !item.has(ALLOWANCE_KEY)) return;
  reporter.error(
    item.pointer(ALLOWANCE_KEY),
    `${axis} の語 ${termId} に ${ALLOWANCE_KEY} は書けません(audience の語だけが持つ)`,
    `${ALLOWANCE_KEY} を消す(本人を名指せる宛先の宣言は audience の語)`,
    { id: termId },
  );
}
