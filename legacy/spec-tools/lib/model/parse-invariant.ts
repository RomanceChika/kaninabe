/**
 * invariant_spec({aggregate}/invariants.md)のパーサー。
 *
 * スキーマの正: domain-spec-writing.md §invariant_spec。
 * formal.type と enforced_by[].kind は閉じた集合であり、集合外は V1 違反として弾く。
 * formal は任意(集計を含む制約は DSL の外で扱うため省略できる)。
 * enforced_by の ref が実在するか、formal を省略した宣言が執行点で守られているかは V2 / V10 が見る。
 */

import type { EnforcementDef, InvariantDef, InvariantFormal, InvariantSpec } from './types.js';
import {
  asRecord,
  checkDocType,
  elementPointer,
  SpecReporter,
  type ParseResult,
} from './parse-common.js';
import { eachRecord, YamlReader } from './yaml-reader.js';
import { globalKeyOf } from './parse-global-key.js';

/** 執行点の種別の値域。 */
const ENFORCEMENT_KINDS = ['db_constraint', 'trigger', 'guard', 'application'] as const;

const INVARIANTS_SUGGESTION =
  'invariants: に "- id / statement / entities / formal / enforced_by" を持つ要素を並べる(template.invariant_spec.md 参照)';

/** invariants[] の要素に書けるキーの allowlist(V1)。involves は任意。 */
const INVARIANT_KEYS = ['id', 'statement', 'entities', 'involves', 'formal', 'formal_outside', 'enforced_by'];

const INVOLVES_SUGGESTION =
  'involves にはこの不変条件が数えている/参照している別集約のエンティティ名を並べる(例: involves: [piece, entry_participant])';

const FORMAL_SUGGESTION =
  'formal.type に check / uniqueness / exclusion / cardinality / state_dependency のいずれかを書き、その型に対応するフィールドを添える';

const ENFORCED_BY_SUGGESTION =
  `enforced_by に "- kind: {${ENFORCEMENT_KINDS.join(' | ')}}" と "ref: {執行点の識別子}" を 1 つ以上並べる`;

/**
 * invariants.md のフロントマターを InvariantSpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @returns InvariantSpec と V1 違反。invariants を配列として読めない場合は value=null
 */
export function parseInvariantSpec(data: unknown, file: string): ParseResult<InvariantSpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'invariants.md のフロントマターがマッピングではありません',
      'フロントマターを doc_type: invariant_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'invariant_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  const items = root.requiredList('invariants', INVARIANTS_SUGGESTION);
  if (items === null) return { value: null, findings: reporter.findings() };

  const invariants: InvariantDef[] = [];
  eachRecord(items, 'invariants', reporter, INVARIANTS_SUGGESTION, (reader, index) => {
    const invariant = parseInvariant(reader, index, reporter);
    if (invariant !== null) invariants.push(invariant);
  });
  return {
    value: { invariants, location: reporter.location() },
    findings: reporter.findings(),
  };
}

function parseInvariant(
  reader: YamlReader,
  index: number,
  reporter: SpecReporter,
): InvariantDef | null {
  const id = reader.requiredString('id', '不変条件 ID を INV-{ENTITY}-{NNN} 形式で id に書く');
  const statement = reader.requiredString(
    'statement',
    'この不変条件が何を保証するのかを statement に日本語の平文で書く(人間のレビュー対象)',
  );
  const entities = reader.requiredStringList(
    'entities',
    'この不変条件が関与するエンティティを entities に 1 つ以上並べる',
    false,
  );
  const involves = reader.optionalStringList('involves', INVOLVES_SUGGESTION);
  const formal = parseOptionalFormal(reader, reporter);
  const formalOutside = parseFormalOutside(reader, reporter, formal);
  const enforcedBy = parseEnforcedBy(reader, reporter);
  reader.rejectUnknownKeys(INVARIANT_KEYS, 'invariants の要素', unknownKeyHint(INVARIANT_KEYS));
  if (id === null || statement === null || entities === null || formal === null) return null;
  return {
    id,
    statement,
    entities,
    ...(involves.length === 0 ? {} : { involves }),
    ...(formal === undefined ? {} : { formal }),
    ...(formalOutside === undefined ? {} : { formalOutside }),
    enforcedBy,
    location: reporter.location(elementPointer('invariants', index, id)),
  };
}

/** `formal_outside` の直し方。 */
const FORMAL_OUTSIDE_SUGGESTION =
  'formal_outside には、形式定義の型(check / uniqueness / exclusion / cardinality / state_dependency)で言えない理由を 1 文で書く' +
  '(例: 遷移の時点の条件で、常に成り立つ条件ではない)。書ける条件なら formal を書き、formal_outside は書かない';

/**
 * `formal_outside`(形式定義を書かない理由。点検 22 回目 C22-3)を読む。空の理由と、`formal` と同時の宣言は error。
 *
 * @param reader 不変条件 1 つの読み手
 * @param reporter 違反の記録先
 * @param formal 読めた形式定義(無ければ undefined・壊れていれば null)
 * @returns 理由(書かれていなければ undefined)
 */
function parseFormalOutside(reader: YamlReader, reporter: SpecReporter, formal: InvariantFormal | null | undefined): string | undefined {
  const reason = reader.optionalString('formal_outside', FORMAL_OUTSIDE_SUGGESTION);
  if (reason === undefined) return undefined;
  if (reason.trim() === '') {
    reporter.error(reader.pointer('formal_outside'), 'formal_outside の理由が空です', FORMAL_OUTSIDE_SUGGESTION, { value: reason });
    return undefined;
  }
  if (formal !== undefined) {
    reporter.error(reader.pointer('formal_outside'), 'formal と formal_outside は同時に書けません', FORMAL_OUTSIDE_SUGGESTION, { value: reason });
    return undefined;
  }
  return reason;
}

/** 未知キーの修正案(allowlist を列挙する定型文)。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるキーは ${allowed.join(' / ')} だけです。綴りを確認するか、このキーを削除する`;
}

/**
 * formal を読む。集計を含む制約(DSL の守備範囲外)は formal を書かなくてよいため、
 * 欠落は違反にせず undefined を返す(執行点だけで守る宣言の妥当性は V10 が見る)。
 * 書かれているが構造が壊れている場合だけ null を返し、その不変条件を読み飛ばす。
 */
function parseOptionalFormal(
  reader: YamlReader,
  reporter: SpecReporter,
): InvariantFormal | null | undefined {
  const rawFormal = reader.raw('formal');
  if (rawFormal === undefined || rawFormal === null) return undefined;
  const raw = asRecord(rawFormal);
  if (raw === null) {
    reporter.error(reader.pointer('formal'), 'formal はマッピングで書きます', FORMAL_SUGGESTION, {
      value: String(rawFormal),
    });
    return null;
  }
  const formal = new YamlReader(raw, reader.pointer('formal'), reporter);
  const type = formal.requiredString('type', FORMAL_SUGGESTION);
  if (type === null) return null;
  if (type === 'check') return parseCheck(formal);
  if (type === 'uniqueness') return parseUniqueness(formal, reporter);
  if (type === 'exclusion') return parseExclusion(formal, reporter);
  if (type === 'cardinality') return parseCardinality(formal, reporter);
  if (type === 'state_dependency') return parseStateDependency(formal, reporter);
  reporter.error(formal.pointer('type'), `formal.type "${type}" は使えません`, FORMAL_SUGGESTION, {
    type,
  });
  return null;
}

function parseCheck(formal: YamlReader): InvariantFormal | null {
  const expr = formal.requiredString(
    'expr',
    '1 レコード内で常に成り立つ条件をガード式の文字列で expr に書く。例: expr: "workshop.entry_deadline < workshop.starts_at"(集計は書けない)',
  );
  return expr === null ? null : { kind: 'check', expr };
}

function parseUniqueness(formal: YamlReader, reporter: SpecReporter): InvariantFormal | null {
  const keys = formal.requiredStringList('keys', 'ユニークにするフィールドを keys に 1 つ以上並べる', false);
  if (keys === null) return null;
  const where = formal.optionalString('where', 'where は限定条件をガード式の文字列で書く');
  return { kind: 'uniqueness', keys, ...(where === undefined ? {} : { where }), ...globalKeyOf(formal, reporter) };
}

/** `range` の書き方の案内(端の扱いは体系が固定する — 宣言では選べない)。 */
const RANGE_SUGGESTION =
  'range に期間の [開始フィールド, 終了フィールド] をこの順で 2 つ書く。例: range: [starts_at, ends_at]' +
  '(端の扱いは半開区間 [開始, 終了) に固定。終了 = 次の開始は重なりにならない)';

/**
 * `exclusion`(期間の重なりの排他)を読む。
 *
 * `keys` は「一致していなければ重なってよい」鍵、`range` は期間を表す 2 フィールドである。
 * `range` を 2 要素ちょうどに縛るのは、区間の端の扱い(半開)を体系側で 1 つに固定するため
 * であり、3 つ目の「端の指定」を宣言に持たせない(ARCH-SP-BE-0001 §排他制約)。
 */
function parseExclusion(formal: YamlReader, reporter: SpecReporter): InvariantFormal | null {
  const keys = formal.requiredStringList(
    'keys',
    '一致していなければ重なってよい鍵を keys に 1 つ以上並べる。例: keys: [room_id]',
    false,
  );
  const range = formal.requiredStringList('range', RANGE_SUGGESTION, false);
  if (keys === null || range === null) return null;
  if (range.length !== 2) {
    reporter.error(formal.pointer('range'), `range は開始と終了の 2 つで書きます(${range.length} 個あります)`, RANGE_SUGGESTION, {
      range: range.join(', '),
    });
    return null;
  }
  const [start = '', end = ''] = range;
  if (start === end) {
    reporter.error(formal.pointer('range'), `range の開始と終了が同じフィールド(${start})です`, RANGE_SUGGESTION, {
      range: range.join(', '),
    });
    return null;
  }
  const where = formal.optionalString('where', 'where は限定条件をガード式の文字列で書く');
  return { kind: 'exclusion', keys, range: [start, end], ...(where === undefined ? {} : { where }), ...globalKeyOf(formal, reporter) };
}

function parseCardinality(formal: YamlReader, reporter: SpecReporter): InvariantFormal | null {
  const keys = formal.requiredStringList('keys', 'group-by するキーを keys に 1 つ以上並べる', false);
  const maxSuggestion = 'max に上限を数値リテラルか親フィールド参照の文字列で書く。例: max: 5 / max: workshop.capacity';
  const rawMax = formal.raw('max');
  if (keys === null) return null;
  if (typeof rawMax !== 'number' && typeof rawMax !== 'string') {
    reporter.error(
      formal.pointer('max'),
      rawMax === undefined ? 'max がありません' : 'max は数値または親フィールド参照の文字列で書きます',
      maxSuggestion,
      rawMax === undefined ? undefined : { value: String(rawMax) },
    );
    return null;
  }
  const where = formal.optionalString('where', 'where は限定条件をガード式の文字列で書く');
  return { kind: 'cardinality', keys, max: rawMax, ...(where === undefined ? {} : { where }), ...globalKeyOf(formal, reporter) };
}

/** 前提のキーは if に統一されている(when は使えない)。 */
const IF_SUGGESTION = '前提の条件をガード式の文字列で if に書く。例: if: "workshop.state == program_published"';

function parseStateDependency(formal: YamlReader, reporter: SpecReporter): InvariantFormal | null {
  if (formal.has('when')) {
    reporter.error(
      formal.pointer('when'),
      'state_dependency の前提は when ではなく if に書きます',
      `when を if に書き換える。${IF_SUGGESTION}`,
      { key: 'when' },
    );
  }
  const condition = formal.requiredString('if', IF_SUGGESTION);
  const then = formal.requiredString(
    'then',
    '前提が成り立つときに満たすべき条件をガード式の文字列で then に書く',
  );
  if (condition === null || then === null) return null;
  return { kind: 'state_dependency', if: condition, then };
}

function parseEnforcedBy(reader: YamlReader, reporter: SpecReporter): readonly EnforcementDef[] {
  const items = reader.requiredList('enforced_by', ENFORCED_BY_SUGGESTION) ?? [];
  const path = reader.pointer('enforced_by');
  const enforcements: EnforcementDef[] = [];
  eachRecord(items, path, reporter, ENFORCED_BY_SUGGESTION, (itemReader, index) => {
    const rawKind = itemReader.requiredString('kind', ENFORCED_BY_SUGGESTION);
    const ref = itemReader.requiredString('ref', 'ref に執行点の識別子(インデックス名 / イベント ID / 関数名)を書く');
    if (rawKind === null || ref === null) return;
    const kind = ENFORCEMENT_KINDS.find((candidate) => candidate === rawKind);
    if (kind === undefined) {
      reporter.error(
        itemReader.pointer('kind'),
        `enforced_by.kind "${rawKind}" は使えません`,
        ENFORCED_BY_SUGGESTION,
        { kind: rawKind },
      );
      return;
    }
    enforcements.push({
      kind,
      ref,
      location: reporter.location(elementPointer(path, index, ref)),
    });
  });
  return enforcements;
}
