/**
 * entity_spec({aggregate}/entity.md)のパーサー。
 *
 * スキーマの正: domain-spec-writing.md §entity_spec。
 * 参照先(ref(entity) / state(machine))の実在は V2 が見る。
 *
 * 読むのは 2 段 —— 「entity.md 全体の組み立て」(トップレベルのキー・context・table)と、
 * `fields[]` 1 要素分の読み取り(type の解釈・label/personal などの妥当性。`parseFields`)である。
 * 欄の**表示名(`labels`)と値の供給元(`supplied_by`)**の読み取り(`readLabels` ・`readSuppliedBy`)も
 * 同じファイルにある。ここで見るのは**形だけ**で、「input に現れる enum なら labels は必須」(V16)と
 * 「supplied_by: db の欄に機構の宣言があるか」(V17)は検査器が見る —— 必須の判定に要る
 * action_spec / data_table をパーサーが知らずに済むようにするため。
 *
 * @oversize 超える理由: entity_spec の 1 ファイルを読む流れ(全体の骨格 → 欄 1 つ → 欄の下位の宣言)は 1 つの
 *   仕様の読み取りで、書けるキーの allowlist と直し方の文面を共有する。キーの閉世界を 1 か所で確かめられる。
 * @split-review 割る案と結果: 欄 1 つの読み取り(`parseFields` ・`parseFieldType` ほか。以前の `parse-entity-fields.ts`)と、
 *   欄の下位の宣言(`readLabels` ・`readSuppliedBy`。以前の `parse-entity-field-extras.ts`)に割る案を検討した
 *   (以前は 3 枚だった)。`parseFields` を呼ぶのは `parseEntitySpec` だけ、`readLabels` と `readSuppliedBy` を
 *   呼ぶのは `buildField` だけで、骨格 → 欄 → 欄の下位の 1 本の鎖である。外から直接読むのは単体テストが
 *   `parseFieldType` を引くだけなので、鎖の途中に別の使い手はいない。割らずに上から順に読む 1 枚にした。
 */

import { identifierField, patternField } from './sql-fields.js';
import { readBearer } from './parse-entity-bearer.js';
import { readFormat } from './parse-entity-format.js';
import { SUPPLIED_BY_VALUES } from './types.js';
import type { EntitySpec, FieldDef, FieldType, SuppliedBy } from './types.js';
import {
  asRecord,
  checkDocType,
  META_FRONTMATTER_KEYS,
  SpecReporter,
  elementPointer,
} from './parse-common.js';
import type { ParseResult } from './parse-common.js';
import { YamlReader, eachRecord } from './yaml-reader.js';

/**
 * entity_spec のトップレベルに書ける宣言の全体(これ以外のキーはエラーにする)。
 *
 * allowlist で閉じているのは access_spec(parse-access.ts の SPEC_KEYS)と同じ理由である ──
 * 読まれないキーが黙って無視される(綴り違い・スキーマに無いキー)のを防ぐ。
 */
const SPEC_KEYS: readonly string[] = [
  ...META_FRONTMATTER_KEYS,
  'entity',
  'label',
  'summary',
  'display_field',
  'context',
  'table',
  'mirror',
  'fields',
];

/** 知らないキーを見つけたときに示す共通の直し方。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるのは ${allowed.join(' / ')} だけ。綴り違いなら直す`;
}

/** 集約そのものの表示名(トップレベル label)の書き方。 */
const ENTITY_LABEL_SUGGESTION =
  'label はこの集約の表示名(業務の名詞)を空でない文字列で書く。例: label: 催し。' +
  '表示名を決めていないならキーごと消す(label は任意。無ければ従来どおり内部名だけで表示される)';

/** 集約の章頭の 1 文(トップレベル summary)の書き方。 */
const ENTITY_SUMMARY_SUGGESTION =
  'summary はこの集約が何かを人の言葉で 1 文、空でない文字列で書く。例: summary: 世話役が開き、メンバーが申し込む勉強会の単位です。' +
  '文体の規則は domain-spec-writing.md §summary。書かないなら、キーごと消す(ブックに「まだ書かれていない」と出る)';

/** 行の名前の欄(トップレベル display_field)の書き方。 */
const ENTITY_DISPLAY_FIELD_SUGGESTION =
  'display_field はこの集約の行を人に名指す欄の名前(fields に居る string / text の欄)を書く。例: display_field: title。' +
  '名前にあたる欄が無い集約はキーごと消す(任意。無ければ確認の本文に行の名前が出ない)';

/** 写しの宣言(トップレベル mirror)の書き方。 */
const ENTITY_MIRROR_SUGGESTION =
  'mirror はこの集約が他の集約の写し(state_spec の effects[].snapshot.to の写像先)であるときだけ mirror: true と書く。' +
  '写しでないならキーごと消す(V12 が snapshot.to と双方向で突き合わせる)';

/**
 * entity.md のフロントマターを EntitySpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @returns EntitySpec と V1 違反。entity 名または fields を読めない場合は value=null
 */
export function parseEntitySpec(data: unknown, file: string): ParseResult<EntitySpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'entity.md のフロントマターがマッピングではありません',
      'フロントマターを doc_type: entity_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'entity_spec', reporter);

  const root = new YamlReader(record, '', reporter);
  root.rejectUnknownKeys(SPEC_KEYS, 'entity_spec', unknownKeyHint(SPEC_KEYS));
  // エンティティ名は生成 SQL の引数名(`p_{entity}_id`)と生成 TS の識別子にそのまま置かれるので、識別子の文法で閉じる(R17)。
  const entity = identifierField(
    root,
    reporter,
    'entity',
    root.requiredString('entity', 'entity にエンティティ名(集約ディレクトリ名と同じスネークケース)を書く。例: entity: entry'),
  );
  const label = root.optionalLabel('label', ENTITY_LABEL_SUGGESTION);
  const summary = root.optionalLabel('summary', ENTITY_SUMMARY_SUGGESTION);
  const displayField = root.optionalLabel('display_field', ENTITY_DISPLAY_FIELD_SUGGESTION);
  const context = root.optionalStringMap(
    'context',
    'context は "{エンティティ名}: {参照パス}" の写像で書く。例: workshop: entry.workshop_id',
  );
  const rawTable = root.optionalString(
    'table',
    'table は DB のテーブル名を文字列で書く(規則どおりの複数形なら書かない)。例: table: people',
  );
  const table = rawTable === undefined ? undefined : (identifierField(root, reporter, 'table', rawTable) ?? undefined);
  const mirror = root.optionalBoolean('mirror', ENTITY_MIRROR_SUGGESTION);
  const items = root.requiredList('fields', FIELDS_SUGGESTION);
  if (entity === null || items === null) {
    return { value: null, findings: reporter.findings() };
  }

  const fields = parseFields(items, reporter);
  return {
    value: {
      entity,
      ...(label === undefined ? {} : { label }),
      ...(summary === undefined ? {} : { summary }),
      ...(displayField === undefined ? {} : { displayField }),
      ...(table === undefined ? {} : { table }),
      ...(mirror ? { mirror: true as const } : {}),
      context,
      fields,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** パラメータを持たないフィールド型の値域。 */
const SCALAR_FIELD_TYPES = [
  'uuid',
  'string',
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
] as const;

const TYPE_SUGGESTION =
  `type に書けるのは ${SCALAR_FIELD_TYPES.join(' / ')} / enum([...]) / ref(entity) / state(machine) のみ`;

/** entity_spec の `fields:` に要素が 1 つも無い・要素の形が違うときの直し方。 */
const FIELDS_SUGGESTION =
  'fields: に "- name: {field_name}" と "type: {型}" を持つ要素を並べる(template.entity_spec.md 参照)';

/**
 * fields[] の要素に書けるキー(domain-spec-writing.md §entity_spec / FieldDef と 1 対 1)。
 *
 * `max_lenght` のような綴り違いは、allowlist が無いと黙って無視され(生成される zod に
 * 制約が乗らない)、「書いたのに効いていない」宣言のまま仕様に残ってしまう。
 */
const FIELD_KEYS: readonly string[] = [
  'name',
  'type',
  'required',
  'label',
  'description',
  'auto',
  'max_length',
  'unbounded',
  'not_boundary',
  'min',
  'max',
  'pattern',
  'format',
  'bearer',
  'personal',
  'personal_placeholder',
  'session',
  'labels',
  'supplied_by',
];

/**
 * unbounded の書き方(文字列の欄に長さの上限を置かないことの、理由つきの受け入れ)。
 *
 * 上限の無い文字列は巨大な入力・ログ・通知の本文・保存の費用の口になるので、上限の省略は R10 が止める。
 * 意図して上限を置かない欄だけが、その理由をここに書く(理由の中身と、`max_length` との併記の禁止は R10 が見る)。
 */
const UNBOUNDED_SUGGESTION =
  'unbounded は文字列の欄に長さの上限を置かない理由を文字列で書く(例: unbounded: 外部の文書をそのまま写すので上限を決められない)。' +
  '上限を決められるなら unbounded を消して max_length を書く';

/** not_boundary の書き方(実行者の集約の参照の欄がテナントの境界でないことの、理由つきの宣言。A5-4)。 */
const NOT_BOUNDARY_SUGGESTION =
  'not_boundary は参照の欄(ref)に、その欄がテナントの境界ではない理由を文字列で書く(例: not_boundary: 好みの店舗の印で、見える行を狭めない)。' +
  'テナントの境界なら not_boundary を消して session: true を付け、各表の reads の filters と書き込みの when で actor.{欄} に結ぶ';

/** `not_boundary`(参照の欄だけ・空でない理由)を読む。 */
function readNotBoundary(reader: YamlReader, reporter: SpecReporter, type: FieldType): string | undefined {
  const reason = reader.optionalString('not_boundary', NOT_BOUNDARY_SUGGESTION);
  if (reason === undefined) return undefined;
  if (type.kind !== 'ref' || reason.trim() === '') {
    reporter.error(reader.pointer('not_boundary'), type.kind !== 'ref' ? 'not_boundary は参照の欄(ref)にだけ書けます' : 'not_boundary の理由が空です', NOT_BOUNDARY_SUGGESTION);
    return undefined;
  }
  return reason;
}

/** フィールドの表示名(fields[].label)の書き方。 */
const FIELD_LABEL_SUGGESTION =
  'label は UI の表示名(業務の名詞)を空でない文字列で書く。例: label: 演目名。説明文は description に書く';

/**
 * session の書き方(省略可・既定 false)。
 *
 * `session: true` はこの列の値をログインセッション(`app_metadata.profile`)に載せることを
 * 宣言する(auth-spec-writing.md §session 属性)。**認証ユーザーに対応する集約(1 つだけ)**
 * にしか付けられない — V13 が全集約を横断して見る。
 */
const SESSION_SUGGESTION =
  'session は true / false で書く(ログインセッションの属性に載せる列か)。' +
  '付けられるのは認証ユーザーに対応する集約(1 つだけ)に限る(V13)。省略時は false';

/** personal の書き方(全フィールド必須)。 */
const PERSONAL_SUGGESTION =
  'personal は true / false で書く(特定の個人に結びつき、本人が消去を求めうる値か)。' +
  '目安は表示名・連絡先(メール・電話・Discord ID)・自由記述で人について書く欄・本人の属性の申告なら true、' +
  '金額・状態・順序・日時・題名・著者・会場名・タイトル・説明なら false。迷ったら true' +
  '(domain-spec-writing.md §entity_spec)';

/** personal: true のフィールドで personal_placeholder が無いときの書き方。 */
const PERSONAL_PLACEHOLDER_REQUIRED_SUGGESTION =
  'personal: true のフィールドは手順 2(anonymize)が書く置換値を personal_placeholder に書く' +
  '(文字列リテラル。一意制約のある列は {id} を含めて行 id に置換。NOT NULL でない列は null も可)';

/** personal: false のフィールドに personal_placeholder が書かれているときの書き方。 */
const PERSONAL_PLACEHOLDER_FORBIDDEN_SUGGESTION =
  'personal_placeholder は personal: true のフィールドにだけ書ける。personal: false ならキーごと消す';

/** personal_placeholder の型が文字列でも null でもないときの書き方。 */
const PERSONAL_PLACEHOLDER_TYPE_SUGGESTION =
  'personal_placeholder は文字列(置換値)、または NOT NULL でない列を消去時に NULL にする null で書く';

/**
 * フィールド型の文字列を FieldType に変換する。
 *
 * 値域(domain-spec-writing.md §entity_spec)の外なら V1 違反を記録して null を返す。
 *
 * @param raw type に書かれた文字列(例: "uuid", "enum([a, b])", "ref(workshop)")
 * @param pointer 違反箇所の YAML パス(例: "fields[0].type")
 * @param reporter 違反の記録先
 */
export function parseFieldType(
  raw: string,
  pointer: string,
  reporter: SpecReporter,
): FieldType | null {
  const text = raw.trim();
  const scalar = SCALAR_FIELD_TYPES.find((kind) => kind === text);
  if (scalar !== undefined) return { kind: scalar };

  const enumMatch = /^enum\(\s*\[(.*)\]\s*\)$/s.exec(text);
  if (enumMatch !== null) return parseEnumType(enumMatch[1] ?? '', pointer, reporter);

  const refMatch = /^ref\(\s*([^()\s]+)\s*\)$/.exec(text);
  if (refMatch?.[1] !== undefined) return { kind: 'ref', entity: refMatch[1] };

  const stateMatch = /^state\(\s*([^()\s]+)\s*\)$/.exec(text);
  if (stateMatch?.[1] !== undefined) return { kind: 'state', machine: stateMatch[1] };

  reporter.error(pointer, `型 "${text}" は使えません`, TYPE_SUGGESTION, { type: text });
  return null;
}

function parseEnumType(inner: string, pointer: string, reporter: SpecReporter): FieldType | null {
  const values = inner
    .split(',')
    .map((value) => value.trim().replace(/^["']|["']$/g, ''))
    .filter((value) => value !== '');
  const hostile = values.find((value) => value.includes('$$'));
  if (hostile !== undefined) {
    reporter.error(pointer, 'enum の値に $$ は置けません(SQL の本文を閉じる並び)', 'enum の値から $$ を除く', { value: hostile.slice(0, 40) });
    return null;
  }
  if (values.length === 0) {
    reporter.error(
      pointer,
      'enum に値がありません',
      'enum([draft, submitted]) のように取り得る値を 1 つ以上並べる',
    );
    return null;
  }
  return { kind: 'enum', values };
}

/**
 * entity_spec の `fields:` を FieldDef の並びに変換する。
 *
 * @param items `fields:` の生の要素配列(呼び出し側が requiredList で読み取り済み)
 * @param reporter 違反の記録先
 */
function parseFields(items: readonly unknown[], reporter: SpecReporter): readonly FieldDef[] {
  const fields: FieldDef[] = [];
  eachRecord(items, 'fields', reporter, FIELDS_SUGGESTION, (reader, index) => {
    reader.rejectUnknownKeys(FIELD_KEYS, 'fields の要素', unknownKeyHint(FIELD_KEYS));
    const name = identifierField(reader, reporter, 'name', reader.requiredString('name', 'フィールド名(スネークケース)を name に書く'));
    const rawType = reader.requiredString('type', TYPE_SUGGESTION);
    if (name === null || rawType === null) return;
    const type = parseFieldType(rawType, reader.pointer('type'), reporter);
    if (type === null) return;
    fields.push(
      buildField(name, type, reader, reporter, reporter.location(elementPointer('fields', index, name))),
    );
  });
  checkLabelUniqueness(fields, reporter);
  return fields;
}

/**
 * label の重複を指摘する(最小限の妥当性検査)。
 *
 * label は画面の表示名になるため、同じエンティティの中で 2 つのフィールドが同じ表示名を
 * 持つと、UI 上で区別が付かない(内部名で配線・label で表示、の表示側が壊れる)。
 */
function checkLabelUniqueness(fields: readonly FieldDef[], reporter: SpecReporter): void {
  const seen = new Map<string, string>();
  for (const field of fields) {
    if (field.label === undefined) continue;
    const first = seen.get(field.label);
    if (first !== undefined) {
      reporter.error(
        field.location.pointer,
        `label "${field.label}" が ${first} と ${field.name} で重複しています`,
        '表示名はエンティティの中で一意にする(同じ表示名の欄が 2 つ並ぶと画面で区別できない)',
        { label: field.label, fields: `${first}, ${field.name}` },
      );
      continue;
    }
    seen.set(field.label, field.name);
  }
}

function buildField(
  name: string,
  type: FieldType,
  reader: YamlReader,
  reporter: SpecReporter,
  location: FieldDef['location'],
): FieldDef {
  const label = reader.optionalLabel('label', FIELD_LABEL_SUGGESTION);
  const description = reader.optionalString(
    'description',
    'description はフィールドの意味を日本語の文字列で書く(生成されるフィールド定義表の説明列になる)',
  );
  const maxLength = reader.optionalNumber('max_length', 'max_length は文字数を数値で書く。例: max_length: 50');
  const min = reader.optionalNumber('min', 'min は下限を数値で書く。例: min: 1');
  const max = reader.optionalNumber('max', 'max は上限を数値で書く。例: max: 30');
  const unbounded = reader.optionalString('unbounded', UNBOUNDED_SUGGESTION);
  const notBoundary = readNotBoundary(reader, reporter, type);
  const pattern = patternField(reader, reporter, reader.optionalString('pattern', 'pattern は正規表現を文字列で書く'));
  const format = readFormat(reader, reporter, type, pattern, maxLength);
  const personal = reader.requiredBoolean('personal', PERSONAL_SUGGESTION) ?? false;
  const personalPlaceholder = readPersonalPlaceholder(reader, reporter, personal);
  const session = reader.optionalBoolean('session', SESSION_SUGGESTION) ?? false;
  const labels = readLabels(reader, reporter, type);
  const suppliedBy = readSuppliedBy(reader, reporter);
  const bearer = readBearer(reader, reporter, { type, suppliedBy, format, maxLength });
  return {
    name,
    type,
    ...(labels === undefined ? {} : { labels }),
    ...(suppliedBy === undefined ? {} : { suppliedBy }),
    required: reader.optionalBoolean('required', 'required は true / false で書く'),
    auto: reader.optionalBoolean('auto', 'auto は true / false で書く'),
    personal,
    session,
    ...(label === undefined ? {} : { label }),
    ...(description === undefined ? {} : { description }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(unbounded === undefined ? {} : { unbounded }),
    ...(notBoundary === undefined ? {} : { notBoundary }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(pattern === undefined ? {} : { pattern }),
    ...(format === undefined ? {} : { format }),
    ...(bearer === undefined ? {} : { bearer }),
    ...(personalPlaceholder === undefined ? {} : { personalPlaceholder }),
    location,
  };
}

/**
 * personal_placeholder を読み、`personal` との整合を検査する。
 *
 * - `personal: true` で欠落 → V1 違反(置換値を宣言させる)。
 * - `personal: false` で書かれている → V1 違反(false の列に置換値は無意味)。
 * - 型は文字列または明示的な null のみ(`optionalStringOrNull` が検査)。
 */
function readPersonalPlaceholder(
  reader: YamlReader,
  reporter: SpecReporter,
  personal: boolean,
): string | null | undefined {
  const present = reader.has('personal_placeholder');
  if (!personal) {
    if (present) {
      reporter.error(
        reader.pointer('personal_placeholder'),
        'personal: false のフィールドに personal_placeholder は書けません',
        PERSONAL_PLACEHOLDER_FORBIDDEN_SUGGESTION,
      );
    }
    return undefined;
  }
  if (!present) {
    reporter.error(
      reader.pointer('personal_placeholder'),
      'personal_placeholder がありません',
      PERSONAL_PLACEHOLDER_REQUIRED_SUGGESTION,
    );
    return undefined;
  }
  return reader.optionalStringOrNull('personal_placeholder', PERSONAL_PLACEHOLDER_TYPE_SUGGESTION);
}

/** enum の値 → 人の言葉(labels)の書き方。過不足は V16 が見る。 */
const LABELS_SUGGESTION =
  'labels は "{enum の値}: {人の言葉}" のマッピングで書く(例: labels: { performance: 発表枠 })。' +
  'enum([...]) の欄にだけ書け、キー集合は値集合と一致しなければならない(V16)';

/** 値の供給元(supplied_by)の書き方。 */
const SUPPLIED_BY_SUGGESTION =
  `supplied_by に書けるのは ${SUPPLIED_BY_VALUES.join(' / ')} だけ(既定は「入力か実行者」なのでキーごと書かない)。` +
  'db は「入力に現れず DB(列の既定値・トリガ)が決める」の宣言であり、機構は data_table 側が' +
  '`defaults` / `triggers[].supplies` で宣言する(V17)';

/**
 * `labels`(enum の値 → 人の言葉)を読む。
 *
 * ここで見るのは形だけである(マッピングであること・enum の欄にしか書けないこと)。
 * 「input に現れる enum なら必須」「キー集合 = 値集合」は V16 が見る —— 同じ欠落に 2 つの
 * 検査を並べず、必須の判定に要る action_spec をパーサーが知らずに済むようにするため。
 *
 * @param reader この欄のフロントマターの読み取り口
 * @param reporter 違反の記録先
 * @param type この欄の型(enum 以外に labels は書けない)
 * @returns 宣言があれば値 → 表示名の写像、無ければ undefined
 */
function readLabels(
  reader: YamlReader,
  reporter: SpecReporter,
  type: FieldType,
): Readonly<Record<string, string>> | undefined {
  if (!reader.has('labels')) return undefined;
  if (type.kind !== 'enum') {
    reporter.error(reader.pointer('labels'), 'labels は enum([...]) の欄にだけ書けます', LABELS_SUGGESTION, {
      type: type.kind,
    });
    return undefined;
  }
  return reader.optionalStringMap('labels', LABELS_SUGGESTION);
}

/**
 * `supplied_by` を読む(値域の外は V1 違反)。
 *
 * @param reader この欄のフロントマターの読み取り口
 * @param reporter 違反の記録先
 * @returns 宣言があれば供給元、無ければ undefined
 */
function readSuppliedBy(reader: YamlReader, reporter: SpecReporter): SuppliedBy | undefined {
  const raw = reader.optionalString('supplied_by', SUPPLIED_BY_SUGGESTION);
  if (raw === undefined) return undefined;
  const found = SUPPLIED_BY_VALUES.find((value) => value === raw);
  if (found === undefined) {
    reporter.error(reader.pointer('supplied_by'), `supplied_by "${raw}" は使えません`, SUPPLIED_BY_SUGGESTION, {
      supplied_by: raw,
    });
    return undefined;
  }
  return found;
}
