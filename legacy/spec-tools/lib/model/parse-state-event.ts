/**
 * state_spec のうち events / forbidden / effects のパーサー。
 *
 * parse-state.ts から呼ばれる下位のパーサーで、責務は state_spec の events / forbidden / effects /
 * snapshot の読み取りである。
 * ここで見るのは構造だけ: 必須フィールドの有無・型・by が空でないこと。
 * from に無い状態の禁止理由(otherwise_forbidden)が揃っているかは V3 が見る。
 */

import { COPY_ACCEPT_KEY, parseCopyAccepts } from './parse-copy-accept.js';
import type { EffectDef, EventDef, ForbiddenDef, SnapshotDef, SnapshotFieldMap } from './types.js';
import { asRecord, elementPointer, type SpecReporter } from './parse-common.js';
import { eachRecord, YamlReader } from './yaml-reader.js';
import { identifierField } from './sql-fields.js';
import { parsePublic } from './parse-access-abuse.js';
import { parseSelfAssign } from './parse-self-assign.js';

/**
 * events の要素に書けるキー(EventDef と 1 対 1)。
 *
 * 知らないキーを黙って読み飛ばすと、綴り違いの宣言(`self_asign` など)が「書いたのに効いていない」まま仕様に残る
 * (entity_spec / access_spec の要素と同じ理由で閉じる。R17)。
 */
const EVENT_KEYS: readonly string[] = [
  'id',
  'label',
  'from',
  'to',
  'by',
  'guard',
  'otherwise_forbidden',
  'records_actor',
  'records_time',
  'clears',
  'self_assign',
  'public',
];

const EVENTS_SUGGESTION =
  'events: に "- id / from / to / by" を持つ要素を並べる(template.state_spec.md 参照)';

const FORBIDDEN_SUGGESTION =
  'forbidden: は "- event / from / reason" を持つ要素のリストで書く(状態ごとに理由を分けたい場合だけ書く)';

const EFFECTS_SUGGESTION = 'effects: は "- on: {event_id}" と "do: [{effect_id}]" を持つ要素のリストで書く';

const SNAPSHOT_SUGGESTION =
  'snapshot: は "to: {写像先エンティティ}" と "fields: [{from: {entity}.{field}, to: {field}}]" を持つ' +
  'マッピングで書く(列の対応表であって式ではない。変換の中身は do の副作用が持つ)';

/**
 * 状態機械の events を読む。
 *
 * @param reader 状態機械のマッピングの読み取り器
 * @param reporter 違反の記録先
 * @returns 読み取れたイベント。events 自体が無い場合は違反を記録して空配列
 */
export function parseEvents(reader: YamlReader, reporter: SpecReporter): readonly EventDef[] {
  const items = reader.requiredList('events', EVENTS_SUGGESTION);
  if (items === null) return [];
  const path = reader.pointer('events');
  const events: EventDef[] = [];
  eachRecord(items, path, reporter, EVENTS_SUGGESTION, (eventReader, index) => {
    const event = parseEvent(eventReader, path, index, reporter);
    if (event !== null) events.push(event);
  });
  return events;
}

/**
 * 状態機械の forbidden(状態ごとに理由を分けた明示的な禁止)を読む。任意項目。
 *
 * @param reader 状態機械のマッピングの読み取り器
 * @param reporter 違反の記録先
 */
export function parseForbidden(reader: YamlReader, reporter: SpecReporter): readonly ForbiddenDef[] {
  const items = reader.optionalList('forbidden', FORBIDDEN_SUGGESTION);
  const path = reader.pointer('forbidden');
  const forbidden: ForbiddenDef[] = [];
  eachRecord(items, path, reporter, FORBIDDEN_SUGGESTION, (itemReader, index) => {
    const event = itemReader.requiredString('event', '禁止するイベント ID を event に書く');
    const from = itemReader.requiredStringList(
      'from',
      'この理由で禁止する状態を from に 1 つ以上並べる',
      false,
    );
    const reason = itemReader.requiredString(
      'reason',
      'なぜその状態でこのイベントを受け付けないのかを reason に日本語で書く',
    );
    if (event === null || from === null || reason === null) return;
    forbidden.push({
      event,
      from,
      reason,
      location: reporter.location(elementPointer(path, index, event)),
    });
  });
  return forbidden;
}

/**
 * 状態機械の effects(イベント → outbox ジョブの接続点)を読む。任意項目。
 *
 * @param reader 状態機械のマッピングの読み取り器
 * @param reporter 違反の記録先
 */
export function parseEffects(reader: YamlReader, reporter: SpecReporter): readonly EffectDef[] {
  const items = reader.optionalList('effects', EFFECTS_SUGGESTION);
  const path = reader.pointer('effects');
  const effects: EffectDef[] = [];
  eachRecord(items, path, reporter, EFFECTS_SUGGESTION, (itemReader, index) => {
    const on = itemReader.requiredString('on', '副作用の起点となるイベント ID を on に書く');
    const actions = itemReader.requiredStringList(
      'do',
      'do に副作用 ID を 1 つ以上並べる(実体は specs/backend/external が定義する)',
      false,
    );
    if (on === null || actions === null) return;
    const snapshot = parseSnapshot(itemReader, reporter);
    effects.push({
      on,
      do: actions,
      ...(snapshot === null ? {} : { snapshot }),
      location: reporter.location(elementPointer(path, index, on)),
    });
  });
  return effects;
}

/** 写像の行に書けるキー(`copy_accept` = 約束が写し先で崩れることの理由つき受け入れ)。 */
const SNAPSHOT_FIELD_KEYS: readonly string[] = ['from', 'to', COPY_ACCEPT_KEY];

/**
 * `effects[].snapshot`(スナップショットの列対応表。C-29)を読む。任意項目。
 *
 * ここで見るのは構造だけである —— 写像先の列が実在するか・型が合うか・覆い漏れが無いかは V12 が見る。
 *
 * @param reader effects の 1 要素の読み取り器
 * @param reporter 違反の記録先
 * @returns 宣言があれば SnapshotDef、無ければ null
 */
function parseSnapshot(reader: YamlReader, reporter: SpecReporter): SnapshotDef | null {
  if (!reader.has('snapshot')) return null;
  const path = reader.pointer('snapshot');
  const record = asRecord(reader.raw('snapshot'));
  if (record === null) {
    reporter.error(path, 'snapshot はマッピングで書きます', SNAPSHOT_SUGGESTION);
    return null;
  }
  const snapshotReader = new YamlReader(record, path, reporter);
  const to = snapshotReader.requiredString('to', '写像先のエンティティ名を to に書く。例: to: public_workshop');
  const items = snapshotReader.requiredList('fields', SNAPSHOT_SUGGESTION);
  if (to === null || items === null) return null;

  const fieldsPath = snapshotReader.pointer('fields');
  const fields: SnapshotFieldMap[] = [];
  eachRecord(items, fieldsPath, reporter, SNAPSHOT_SUGGESTION, (fieldReader, index) => {
    const from = fieldReader.requiredString(
      'from',
      '写像元を from に "{entity}.{field}" の 2 段で書く(この写しを作った時刻なら予約語 now)',
    );
    const target = fieldReader.requiredString('to', '写像先の列名を to に裸のフィールド名で書く');
    fieldReader.rejectUnknownKeys(SNAPSHOT_FIELD_KEYS, 'snapshot.fields の要素', `書けるのは ${SNAPSHOT_FIELD_KEYS.join(' / ')} だけ。綴り違いなら直す`);
    const accept = parseCopyAccepts(fieldReader, reporter);
    if (from === null || target === null) return;
    fields.push({
      from,
      to: target,
      ...(accept.length === 0 ? {} : { accept }),
      location: reporter.location(elementPointer(fieldsPath, index, target)),
    });
  });
  return { to, fields, location: reporter.location(path) };
}

function parseEvent(
  reader: YamlReader,
  path: string,
  index: number,
  reporter: SpecReporter,
): EventDef | null {
  reader.rejectUnknownKeys(EVENT_KEYS, 'events の要素', `書けるのは ${EVENT_KEYS.join(' / ')} だけ。綴り違いなら直す`);
  const id = identifierField(reader, reporter, 'id', reader.requiredString('id', 'イベント ID(スネークケース)を id に書く。例: "- id: submit"'));
  const label = reader.optionalString('label', 'label は人間向けの日本語名を文字列で書く。例: label: 提出');
  const from = reader.requiredStringList(
    'from',
    'このイベントを受け付ける状態を from に 1 つ以上並べる。例: from: [draft]',
    false,
  );
  const to = reader.requiredString('to', '遷移先の状態を to に 1 つ書く。例: to: submitted');
  const by = reader.requiredStringList(
    'by',
    'この遷移を実行できるロールを by に 1 つ以上並べる(空は許可者なしを意味するためエラー)。例: by: [performer]',
    false,
  );
  if (id === null || from === null || to === null || by === null) return null;

  const guard = reader.optionalString('guard', 'guard はガード式を文字列で書く。例: guard: "workshop.state == accepting"');
  const otherwiseForbidden = reader.optionalString(
    'otherwise_forbidden',
    'otherwise_forbidden は from に無い状態でこのイベントが禁止される理由を日本語の文字列で書く',
  );
  const recordsActor = reader.has('records_actor')
    ? reader.requiredStringList(
        'records_actor',
        'records_actor にはこの遷移が実行者を書き留める自分の列を並べる(例: records_actor: [handled_by])。' +
          '列は ref(実行者の集約)型で、access_spec の writes に by: system で載っていなければならない(V19)',
        false,
      )
    : null;
  const recordsTime = reader.has('records_time')
    ? reader.requiredStringList(
        'records_time',
        'records_time にはこの遷移が「いま」を書き留める自分の列を並べる(例: records_time: [archived_at])。' +
          '列は datetime 型で空にできて、access_spec の writes に by: system で載っていなければならない(V19)。' +
          '値は SQL の now() なので RPC の引数は増えない',
        false,
      )
    : null;
  const clears = reader.has('clears')
    ? reader.requiredStringList(
        'clears',
        'clears にはこの遷移が空にする自分の列を並べる(例: clears: [member_id])。' +
          '列は空にできて、access_spec の writes に by: system で載っていなければならない(V19)。' +
          '宣言しなければ「この遷移はその列に触れない」を意味する',
        false,
      )
    : null;
  const selfAssign = parseSelfAssign(reader, reporter);
  const isPublic = parsePublic(reader);
  return {
    id,
    ...(label === undefined ? {} : { label }),
    from,
    to,
    by,
    ...(guard === undefined ? {} : { guard }),
    ...(otherwiseForbidden === undefined ? {} : { otherwiseForbidden }),
    ...(recordsActor === null ? {} : { recordsActor }),
    ...(recordsTime === null ? {} : { recordsTime }),
    ...(clears === null ? {} : { clears }),
    ...(selfAssign.length === 0 ? {} : { selfAssign }),
    ...(isPublic === undefined ? {} : { public: isPublic }),
    location: reporter.location(elementPointer(path, index, id)),
  };
}
