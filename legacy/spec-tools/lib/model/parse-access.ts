/**
 * access_spec({aggregate}/access.md)のパーサー。
 *
 * スキーマの正: domain-spec-writing.md §access_spec。
 * scope は閉じた集合(own / context(entity) / all / none)であり、集合外は V1 違反として弾く。
 * 「全ロールについて reads が書かれているか」(全域性)は V4 が見る。
 *
 * **`reads[].filters`(実行者の属性で行を狭める条件)のパーサーも同じファイルにある。**
 * `scope`(own / context / all / none)は「原理としてどの行か」を答えるが、**テナントの境界**
 * ——「同じ会社の行だけ」—— を言う語を持っていなかった。複数テナントのシステムは `scope: all` と
 * 書くしかなく、**テナントを越える読み取りが「正しい仕様」として verify 緑で通っていた**
 * (束 ⑱ の題材 D が実測した最大の穴)。`filters` はその境界を、`scope` と直交する軸として宣言する。
 *
 * @oversize 超える理由: access_spec の 1 宣言(scope・filters・when・accept・書き込み規則)は 1 つの仕様の読み取りで、
 *   `reads` の各軸と書き込み規則が同じ YAML の読み手と報告器を共有する。読み取りの全軸を 1 か所に並べ、
 *   軸どうしが直交していること(scope と filters)を一目で確かめられる形にしてある。
 * @split-review 割る案と結果: `reads` の下位(`parseReadFilters` ・`parseReadAccepts`。以前の `parse-access-reads.ts`)に割る案
 *   を検討した(以前はそう割っていた)。この 2 つを読むのは `parseReads` だけで、ほかのパーサーは直接読まない
 *   (query の読み取りが借りる `parseReadScope` は本体側にある)。`reads` の軸(scope と filters と accept)を
 *   並べて直交を見せるのがこのファイルの役目なので、filters と accept だけ別ファイルだとその並びが切れる。
 */

import { parseAcceptEventRef } from './accept-events.js';
import type {
  AccessSpec,
  CreateRule,
  DelegateDecl,
  DeleteRule,
  FieldHiddenRule,
  ReadRule,
  ReadScope,
  WriteRule,
  ReadFilter,
  ReadFilterAccept,
  AcceptKind,
} from './types.js';
import { ACCEPT_KINDS } from './types.js';
import {
  asRecord,
  checkDocType,
  elementPointer,
  META_FRONTMATTER_KEYS,
  SpecReporter,
} from './parse-common.js';
import type { ParseResult } from './parse-common.js';
import { eachRecord, YamlReader } from './yaml-reader.js';
import { identifierField } from './sql-fields.js';
import { identifierProblem } from './sql-fragment.js';
import { parseAbuse, parsePublic } from './parse-access-abuse.js';
import { parseSelfAssign } from './parse-self-assign.js';

/**
 * access_spec に書ける宣言の全体(これ以外のキーはエラーにする)。
 *
 * allowlist で閉じているのは、**読まれないキーが黙って無視される**のを防ぐためである。
 * 綴り違い(`tabel:` / `field_hidden:`)が素通りすると「書いたのに効いていない」宣言が仕様に
 * 残り、生成物にも突合にも現れないまま人間だけが効いていると信じることになる。
 */
const SPEC_KEYS: readonly string[] = [
  ...META_FRONTMATTER_KEYS,
  'entity',
  'reads',
  'fields_hidden',
  'creates',
  'writes',
  'transition_writes',
  'deletes',
  'accept',
];

/**
 * reads の要素に書けるキー。
 *
 * 3 つの軸が直交する —— `scope` が「原理としてどの行か」、`filters` が**実行者の属性**による
 * 境界(テナント。束 ⑲-2a)、`when` が**対象の行の状態**による判定(束 §14)である。
 */
const READ_KEYS: readonly string[] = ['by', 'scope', 'filters', 'when'];

/** fields_hidden の要素に書けるキー。 */
const FIELD_HIDDEN_KEYS: readonly string[] = ['field', 'from'];

/** deletes の要素に書けるキー(`public` = 未ログインに開く削除の理由つき受け入れ。R5)。 */
const DELETE_KEYS: readonly string[] = ['by', 'when', 'public'];

/** creates の要素に書けるキー(`self_assign` = 役の根拠の欄を作成者が決めることの理由つき受け入れ。R2。`delegate` = 作成の入力で他人を指せることの理由)。 */
const CREATE_KEYS: readonly string[] = ['by', 'when', 'self_assign', 'delegate', 'abuse'];

const DELEGATE_SUGGESTION =
  'delegate には、この規則のロールが自分以外を入れてよい、作成の入力に出した実行者の参照の欄(承認者・代理で作る相手など)を 1 本ずつ名指して理由を書く' +
  ' —— "- field: {集約}.{欄} / reason: {理由}"(理由の空は通らない。名指していない欄は縛ったまま)。' +
  '書かなければ、作成の RPC はその欄を実行者そのものに縛る(違えば UC403)';

/** delegate の要素に書けるキー。 */
const DELEGATE_KEYS: readonly string[] = ['field', 'reason'];

/** `{集約}.{欄}`。 */
const QUALIFIED_FIELD = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/u;

/** writes の要素に書けるキー。 */
const WRITE_KEYS: readonly string[] = ['by', 'fields', 'when', 'effects', 'self_assign', 'public'];

/** 知らないキーを見つけたときに示す共通の直し方。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるのは ${allowed.join(' / ')} だけ。綴り違いなら直す`;
}

const READS_SUGGESTION =
  'reads: に "- by: {role_id}" と "scope: own | context({entity}) | all | none"' +
  '(任意で filters: { {列}: actor.{欄} } / when: {ガード式})を持つ要素を全ロール分並べる';

const SCOPE_SUGGESTION = 'scope に書けるのは own / context({entity}) / all / none のみ';

const READ_WHEN_SUGGESTION =
  'when は「その行が見える条件」をガード式の文字列で書く(対象の行の欄と、context で辿れる' +
  '親の欄だけ。実行者の属性で狭めるのは filters の役なので actor.{欄} は書けない)';

const FIELDS_HIDDEN_SUGGESTION =
  'fields_hidden: は "- field: {field_name}" と "from: [{role_id}]" を持つ要素のリストで書く';

const WRITES_SUGGESTION =
  'writes: は "- by: {role_id}" と "fields: [{field_name}]"(任意で when・effects)を持つ要素のリストで書く';

const TRANSITION_WRITES_SUGGESTION =
  'transition_writes: は、遷移(records_actor / records_time / clears)だけが書く列の名前のリストで書く' +
  '(例: transition_writes: [handled_by])。ロールは書かない —— 編集の経路を作らない宣言である';

const EFFECTS_SUGGESTION =
  'effects は outbox ジョブの ID を 1 つ以上並べる(参照先は source: outbox のジョブ。job-spec-writing.md)';

const CREATES_SUGGESTION =
  'creates: は "- by: {role_id}"(任意で when: {ガード式}・未ログインのロールなら abuse: { global_ceiling: ... })を持つ要素のリストで書く';

const DELETES_SUGGESTION =
  'deletes: は "- by: {role_id}"(任意で when: {ガード式})を持つ要素のリストで書く';

/**
 * access.md のフロントマターを AccessSpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @returns AccessSpec と V1 違反。entity または reads を読めない場合は value=null
 */
export function parseAccessSpec(data: unknown, file: string): ParseResult<AccessSpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'access.md のフロントマターがマッピングではありません',
      'フロントマターを doc_type: access_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'access_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  root.rejectUnknownKeys(SPEC_KEYS, 'access_spec', unknownKeyHint(SPEC_KEYS));
  // 対象エンティティ名は生成 TS の識別子にそのまま置かれるので、識別子の文法で閉じる(R17)。
  const entity = identifierField(
    root,
    reporter,
    'entity',
    root.requiredString('entity', 'entity に対象エンティティ名(entity_spec の entity と同じ)を書く。例: entity: entry'),
  );
  const readItems = root.requiredList('reads', READS_SUGGESTION);
  const id = root.optionalString('id', 'id は "{aggregate}-access" 形式の文字列で書く');
  if (entity === null || readItems === null) {
    return { value: null, findings: reporter.findings() };
  }

  return {
    value: {
      ...(id === undefined ? {} : { id }),
      entity,
      reads: parseReads(readItems, entity, reporter),
      fieldsHidden: parseFieldsHidden(root, reporter),
      creates: parseCreates(root, entity, reporter),
      writes: parseWrites(root, reporter),
      transitionWrites: root.optionalStringList('transition_writes', TRANSITION_WRITES_SUGGESTION),
      deletes: parseDeletes(root, reporter),
      accepts: parseReadAccepts(root, reporter),
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/**
 * 読み取りスコープの文字列を ReadScope に変換する。
 * 値域の外なら V1 違反を記録して null を返す。
 *
 * @param raw scope に書かれた文字列(例: "own", "context(workshop)")
 * @param pointer 違反箇所の YAML パス
 * @param reporter 違反の記録先
 */
export function parseReadScope(
  raw: string,
  pointer: string,
  reporter: SpecReporter,
): ReadScope | null {
  const text = raw.trim();
  if (text === 'own' || text === 'all' || text === 'none') return { kind: text };
  const contextMatch = /^context\(\s*([^()\s]+)\s*\)$/.exec(text);
  if (contextMatch?.[1] !== undefined) return { kind: 'context', entity: contextMatch[1] };
  reporter.error(pointer, `scope "${text}" は使えません`, SCOPE_SUGGESTION, { scope: text });
  return null;
}

function parseReads(items: readonly unknown[], entity: string, reporter: SpecReporter): readonly ReadRule[] {
  const reads: ReadRule[] = [];
  eachRecord(items, 'reads', reporter, READS_SUGGESTION, (reader, index) => {
    reader.rejectUnknownKeys(READ_KEYS, 'reads の要素', unknownKeyHint(READ_KEYS));
    const by = reader.requiredString('by', '読み取り権限を定義するロール ID を by に書く');
    const rawScope = reader.requiredString('scope', SCOPE_SUGGESTION);
    if (by === null || rawScope === null) return;
    const scope = parseReadScope(rawScope, reader.pointer('scope'), reporter);
    if (scope === null) return;
    const filters = parseReadFilters(reader, entity, reporter);
    const when = reader.optionalString('when', READ_WHEN_SUGGESTION);
    reads.push({
      by,
      scope,
      ...(filters.length === 0 ? {} : { filters }),
      ...(when === undefined ? {} : { when }),
      location: reporter.location(elementPointer('reads', index, by)),
    });
  });
  return reads;
}

function parseFieldsHidden(root: YamlReader, reporter: SpecReporter): readonly FieldHiddenRule[] {
  const items = root.optionalList('fields_hidden', FIELDS_HIDDEN_SUGGESTION);
  const rules: FieldHiddenRule[] = [];
  eachRecord(items, 'fields_hidden', reporter, FIELDS_HIDDEN_SUGGESTION, (reader, index) => {
    reader.rejectUnknownKeys(
      FIELD_HIDDEN_KEYS,
      'fields_hidden の要素',
      unknownKeyHint(FIELD_HIDDEN_KEYS),
    );
    const field = reader.requiredString('field', '隠すフィールド名を field に書く');
    const from = reader.requiredStringList(
      'from',
      'そのフィールドを隠すロールを from に 1 つ以上並べる',
      false,
    );
    if (field === null || from === null) return;
    rules.push({
      field,
      from,
      location: reporter.location(elementPointer('fields_hidden', index, field)),
    });
  });
  return rules;
}

/**
 * creates(新規作成の権限)を読む。
 *
 * 宣言そのものが無い access_spec は「誰も作れない」を意味する(deny by default)ので、
 * 欠落は違反にしない。ロールの実在は V11、when の充足性は V9 が見る。
 */
function parseCreates(root: YamlReader, entity: string, reporter: SpecReporter): readonly CreateRule[] {
  const items = root.optionalList('creates', CREATES_SUGGESTION);
  const rules: CreateRule[] = [];
  eachRecord(items, 'creates', reporter, CREATES_SUGGESTION, (reader, index) => {
    reader.rejectUnknownKeys(CREATE_KEYS, 'creates の要素', unknownKeyHint(CREATE_KEYS));
    const by = reader.requiredString('by', '作成権限を与えるロール ID を by に書く');
    if (by === null) return;
    const when = reader.optionalString('when', 'when は作成を許可する条件をガード式の文字列で書く');
    const selfAssign = parseSelfAssign(reader, reporter);
    const delegate = parseDelegate(reader, entity, reporter);
    const location = reporter.location(elementPointer('creates', index, by));
    const abuse = parseAbuse(reader, reporter, location);
    rules.push({
      by,
      ...(when === undefined ? {} : { when }),
      ...(selfAssign.length === 0 ? {} : { selfAssign }),
      ...(delegate.length === 0 ? {} : { delegate }),
      ...(abuse === undefined ? {} : { abuse }),
      location,
    });
  });
  return rules;
}

/**
 * creates の要素の `delegate`(代理で作ってよい欄と理由)を読む(書かれていなければ空)。
 *
 * 緩める宣言なので、読めない・空の要素は**載せない**(緩めない側に倒す)。違反は記録するので verify は止まる。
 * 規則単位の 1 文字列(旧い形)は読まない —— 名指していない欄の縛りまで解く(点検 10 回目 A10-2)。
 */
function parseDelegate(reader: YamlReader, entity: string, reporter: SpecReporter): readonly DelegateDecl[] {
  if (!reader.has('delegate')) return [];
  if (typeof reader.raw('delegate') === 'string') {
    reporter.error(reader.pointer('delegate'), 'delegate を 1 つの文字列では書けません(規則単位の代理は、名指していない実行者への参照の欄の縛りまで解きます)', DELEGATE_SUGGESTION);
    return [];
  }
  const base = reader.pointer('delegate');
  const decls: DelegateDecl[] = [];
  eachRecord(reader.optionalList('delegate', DELEGATE_SUGGESTION), base, reporter, DELEGATE_SUGGESTION, (element, index) => {
    element.rejectUnknownKeys(DELEGATE_KEYS, 'delegate の要素', DELEGATE_SUGGESTION);
    const field = element.requiredString('field', DELEGATE_SUGGESTION);
    const reason = element.requiredString('reason', DELEGATE_SUGGESTION);
    if (field === null || reason === null) return;
    if (reason.trim() === '') {
      reporter.error(`${base}[${index}].reason`, `delegate[${index}] の理由が空です`, DELEGATE_SUGGESTION);
      return;
    }
    const parts = QUALIFIED_FIELD.exec(field.trim());
    if (parts === null || parts[1] !== entity) {
      reporter.error(`${base}[${index}].field`, `delegate[${index}].field が "${entity}.{欄}"(作る集約の欄)の形ではありません`, DELEGATE_SUGGESTION, { value: field });
      return;
    }
    const name = parts[2] ?? '';
    if (decls.some((decl) => decl.field === name)) {
      reporter.error(`${base}[${index}].field`, `delegate に ${entity}.${name} が 2 回あります`, DELEGATE_SUGGESTION, { value: field });
      return;
    }
    decls.push({ entity, field: name, reason, location: reporter.location(`${base}[${index}]`) });
  });
  return decls;
}

/**
 * deletes(物理削除の権限)を読む。
 *
 * creates と対称で、宣言そのものが無い access_spec は「誰も消せない」を意味する
 * (deny by default)ので、欠落は違反にしない。ロールの実在は V11、when の充足性は V9 が見る。
 */
function parseDeletes(root: YamlReader, reporter: SpecReporter): readonly DeleteRule[] {
  const items = root.optionalList('deletes', DELETES_SUGGESTION);
  const rules: DeleteRule[] = [];
  eachRecord(items, 'deletes', reporter, DELETES_SUGGESTION, (reader, index) => {
    reader.rejectUnknownKeys(DELETE_KEYS, 'deletes の要素', unknownKeyHint(DELETE_KEYS));
    const by = reader.requiredString('by', '削除権限を与えるロール ID を by に書く');
    if (by === null) return;
    const when = reader.optionalString('when', 'when は削除を許可する条件をガード式の文字列で書く');
    const isPublic = parsePublic(reader);
    rules.push({
      by,
      ...(when === undefined ? {} : { when }),
      ...(isPublic === undefined ? {} : { public: isPublic }),
      location: reporter.location(elementPointer('deletes', index, by)),
    });
  });
  return rules;
}

function parseWrites(root: YamlReader, reporter: SpecReporter): readonly WriteRule[] {
  const items = root.optionalList('writes', WRITES_SUGGESTION);
  const rules: WriteRule[] = [];
  eachRecord(items, 'writes', reporter, WRITES_SUGGESTION, (reader, index) => {
    reader.rejectUnknownKeys(WRITE_KEYS, 'writes の要素', unknownKeyHint(WRITE_KEYS));
    const by = reader.requiredString('by', '編集権限を与えるロール ID を by に書く');
    const fields = reader.requiredStringList(
      'fields',
      '編集を許可するフィールドを fields に 1 つ以上並べる(state 型と auto: true のフィールドは対象にできない)',
      false,
    );
    if (by === null || fields === null) return;
    const when = reader.optionalString('when', 'when は編集を許可する条件をガード式の文字列で書く');
    const effects = reader.optionalStringList('effects', EFFECTS_SUGGESTION);
    const selfAssign = parseSelfAssign(reader, reporter);
    const isPublic = parsePublic(reader);
    rules.push({
      by,
      fields,
      ...(when === undefined ? {} : { when }),
      ...(effects.length === 0 ? {} : { effects }),
      ...(selfAssign.length === 0 ? {} : { selfAssign }),
      ...(isPublic === undefined ? {} : { public: isPublic }),
      location: reporter.location(elementPointer('writes', index, by)),
    });
  });
  return rules;
}

/** `filters` の書き方。 */
export const FILTERS_SUGGESTION =
  'filters は "{対象の列}: actor.{欄}" か "{親の集約}.{列}: actor.{欄}" の写像で書く(右辺は actor.{欄} だけ。' +
  'その欄は entity_spec で session: true を宣言していなければならない。親は context で 2 段まで辿れる)';

/** `filters` の右辺に書ける唯一の形の接頭辞。 */
const ACTOR_PREFIX = 'actor.';

/** `filters` の左辺の区切り(`{親の集約}.{列}`)。 */
const PATH_SEPARATOR = '.';

/**
 * `filters`(実行者の属性で狭める条件)を読む。
 *
 * 右辺は `actor.{欄}` の 1 形だけである。ここを式にしないのは、**この宣言が RLS の期待・
 * スコープ条件の絞り込み・実行計画の 3 つに写る**からで、写せる形を 1 つに絞ることで「宣言はあるのに
 * どこかで落ちる」を構造的に無くす。
 *
 * 左辺は `{列}`(対象の列)か `{集約}.{列}`(親の列)の 2 形である。自集約の名前で書いた左辺は
 * 裸の `{列}` に畳む —— 同じ境界の綴りが 2 つあると、ポリシーの名前と見張りテストの宣言が
 * 綴りで割れる。親へ届くか・列が実在するか・欄が本当にセッションに載るかは V2 が見る。
 *
 * @param reader `reads` の 1 要素の読み取り器
 * @param entity その access_spec の対象エンティティ(自集約の名前の左辺を畳むのに使う)
 * @param reporter 違反の記録先
 * @returns 宣言順の条件(宣言が無ければ空)
 */
function parseReadFilters(reader: YamlReader, entity: string, reporter: SpecReporter): readonly ReadFilter[] {
  if (!reader.has('filters')) return [];
  const raw = reader.optionalStringMap('filters', FILTERS_SUGGESTION);
  const filters: ReadFilter[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!value.startsWith(ACTOR_PREFIX) || value.slice(ACTOR_PREFIX.length).includes('.')) {
      reporter.error(
        `${reader.pointer('filters')}.${key}`,
        `filters.${key} の右辺 "${value}" は実行者の属性ではありません`,
        FILTERS_SUGGESTION,
        { field: key, value },
      );
      continue;
    }
    const segments = key.split(PATH_SEPARATOR);
    const [head, column] = segments;
    if (segments.length > 2 || segments.some((segment) => segment === '') || head === undefined) {
      reporter.error(
        `${reader.pointer('filters')}.${key}`,
        `filters の左辺 "${key}" は {列} か {親の集約}.{列} の形ではありません`,
        FILTERS_SUGGESTION,
        { field: key, value },
      );
      continue;
    }
    const actorField = value.slice(ACTOR_PREFIX.length);
    // 左辺の集約名・列名と右辺の属性名はポリシーの本文と名前に置かれるので、識別子の文法で閉じる(R17)。
    const badName = [...segments, actorField].find((name) => identifierProblem(name) !== null);
    if (badName !== undefined) {
      reporter.error(
        `${reader.pointer('filters')}.${key}`,
        `filters の ${badName.slice(0, 40)} は識別子の形ではありません: ${identifierProblem(badName) ?? ''}`,
        FILTERS_SUGGESTION,
        { field: key.slice(0, 40) },
      );
      reporter.dropRows();
      continue;
    }
    if (column === undefined || head === entity) filters.push({ field: column ?? head, actorField });
    else filters.push({ entity: head, field: column, actorField });
  }
  return filters;
}

/** `accept` の要素に書けるキー。 */
const ACCEPT_KEYS: readonly string[] = ['by', 'filter', 'reason', 'on', 'events'];

/** `accept` の書き方。 */
const ACCEPT_SUGGESTION =
  'accept は "- by: {ロール} / filter: {テナントを表す列} / reason: {なぜ跨がないか}" を並べる' +
  '(受け入れる対象を名指しする。免除の一覧ではない)。受け入れる種類を "on: [read, create, write, delete, transition]" で名指す(省略は読み取りだけ。書いたら書いた種類にだけ効く)。遷移は "events: [{イベント ID}]" で受け入れる遷移も名指す';

/**
 * `accept`(テナント境界を宣言しないことの理由つき受け入れ)を読む。
 *
 * 3 つとも必須である —— どの読み取り規則の、どの列を、なぜ狭めなくてよいのかが 1 件で読めなければ、
 * 消し込みも見直しもできない(usecase_spec の `accept` と同じ流儀)。
 *
 * @param root access_spec のフロントマターの読み取り器
 * @param reporter 違反の記録先
 * @returns 宣言順の受け入れ(宣言が無ければ空)
 */
function parseReadAccepts(root: YamlReader, reporter: SpecReporter): readonly ReadFilterAccept[] {
  const items = root.optionalList('accept', ACCEPT_SUGGESTION);
  const accepts: ReadFilterAccept[] = [];
  eachRecord(items, 'accept', reporter, ACCEPT_SUGGESTION, (reader, index) => {
    reader.rejectUnknownKeys(ACCEPT_KEYS, 'accept の要素', `書けるのは ${ACCEPT_KEYS.join(' / ')} だけ`);
    const by = reader.requiredString('by', '受け入れる読み取り規則のロール ID を by に書く');
    const field = reader.requiredString('filter', '受け入れる列(テナントを表す列)を filter に書く');
    const reason = reader.requiredString('reason', 'reason になぜ狭めなくてよいかを書く');
    if (by === null || field === null || reason === null) return;
    if (reason.trim() === '') {
      reporter.error(reader.pointer('reason'), 'reason が空です', 'reason になぜ狭めなくてよいかを書く');
      return;
    }
    const on = readAcceptOn(reader, reporter);
    if (on === null) return;
    const events = readAcceptEvents(reader, reporter, on);
    if (events === null) return;
    accepts.push({
      by,
      field,
      reason,
      ...(on.length === 0 ? {} : { on }),
      ...(events.length === 0 ? {} : { events }),
      location: reporter.location(elementPointer('accept', index, by)),
    });
  });
  return accepts;
}

/**
 * `accept[].on`(受け入れる規則の種類)を読む。省略は空(読み取りだけ)。書いたら書いた種類にだけ効く(読み取りも `read` で名指す)。
 *
 * 書けるのは `read` / `create` / `write` / `delete` / `transition` だけで、空の配列・重複・未知の語は違反にする(黙って読み取りだけに戻さない)。
 *
 * @returns 重複を除いた宣言順の種類。書き方が壊れていれば null(違反は記録済み)
 */
function readAcceptOn(reader: YamlReader, reporter: SpecReporter): readonly AcceptKind[] | null {
  const raw = reader.optionalStringList('on', ACCEPT_SUGGESTION);
  if (!reader.has('on')) return [];
  if (raw.length === 0) {
    reporter.error(reader.pointer('on'), 'on が空です', ACCEPT_SUGGESTION);
    return null;
  }
  const unknown = raw.filter((kind) => !(ACCEPT_KINDS as readonly string[]).includes(kind));
  if (unknown.length > 0) {
    reporter.error(reader.pointer('on'), `on に書けない語があります(${unknown.join(' / ')})`, `書けるのは ${ACCEPT_KINDS.join(' / ')} だけ`);
    return null;
  }
  return [...new Set(raw)] as readonly AcceptKind[];
}

/**
 * `accept[].events`(受け入れる状態遷移の名指し。`{イベント ID}` か `{イベント ID}@{遷移元の状態}`)を読む(A4-4・A5-1)。
 *
 * `on` に `transition` があるときは**必須**、無いときは書けない —— 遷移の受け入れはロール × 列ではなく遷移ごとに効く。
 * 名指しの無い受け入れを許すと、後から足した同じロールの遷移の境界まで黙って外れる。
 *
 * @returns 重複を除いた宣言順の ID(遷移を受け入れないなら空)。書き方が壊れていれば null(違反は記録済み)
 */
function readAcceptEvents(reader: YamlReader, reporter: SpecReporter, on: readonly AcceptKind[]): readonly string[] | null {
  const transition = on.includes('transition');
  const suggestion = '遷移を受け入れるなら "on: [transition], events: [{イベント ID}, ...]" で受け入れる遷移を名指す';
  if (!reader.has('events')) {
    if (!transition) return [];
    reporter.error(reader.pointer('on'), 'on: [transition] の受け入れが遷移を名指していません(events が無い)', suggestion);
    return null;
  }
  const raw = reader.optionalStringList('events', suggestion);
  if (!transition) {
    reporter.error(reader.pointer('events'), 'events は on に transition があるときだけ書けます', suggestion);
    return null;
  }
  if (raw.length === 0) {
    reporter.error(reader.pointer('events'), 'events が空です', suggestion);
    return null;
  }
  // 名指しは遷移の定義の単位(A5-1): `{イベント ID}` か `{イベント ID}@{遷移元の状態}`。当たる定義がちょうど 1 本かは V2 が見る。
  const malformed = raw.filter((ref) => parseAcceptEventRef(ref) === null);
  if (malformed.length > 0) {
    reporter.error(
      reader.pointer('events'),
      `events の名指し ${malformed.join(' / ')} の形が読めません(イベント ID か、イベント ID@遷移元の状態)`,
      '同じ ID の遷移が 1 本なら "events: [suspend]"、同じ ID の遷移が遷移元違いで複数あるなら "events: [suspend@active]" のように遷移元の状態で絞る',
    );
    return null;
  }
  return [...new Set(raw)];
}
