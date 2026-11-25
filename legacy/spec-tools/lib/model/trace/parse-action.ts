/**
 * action_spec(`specs/backend/actions/{aggregate}/{event}.md`)のパーサー。
 *
 * スキーマの正: action-spec-writing.md §スキーマ。
 * ここで見るのは「1 ファイル内で閉じた形式」だけで、他の仕様との突合(A1〜A8)は検証器が行う。
 * ファイル I/O は行わない(I/O は lib/model/trace/loader.ts に集約する。規約: scripts-code-quality.md)。
 */

import { ACTION_UX_CONFIRM_VALUES } from './types.js';
import type {
  ActionErrorDef,
  ActionErrors,
  ActionSpec,
  ActionUxOverride,
  EventRef,
  InputFieldRef,
  RetiredTestCaseRef,
} from './types.js';
import { asRecord, checkDocType, SpecReporter, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseTestCases, TC_ID } from '../parse-test-case.js';
import { parseLintExceptions } from '../parse-lint-exceptions.js';
import { parseComputes, parseRunner } from './parse-action-plan.js';
import { splitQualified } from './parse-action-names.js';

const HANDLES_SUGGESTION =
  'handles にドメインイベント ID を "{machine}.{event}" 形式(例: entry.submit)で 1 つだけ書く';

const INPUT_SUGGESTION =
  'input に受けるフィールドを "{entity}.{field}" 形式で並べる(受けるものが無い場合も input: [] を明示する)';

const ERRORS_SUGGESTION =
  'errors に "inherits: common" を書き、固有のエラーがある場合だけ additional に "- kind / when" を並べる';

const RETIRED_SUGGESTION =
  'retired に欠番にした(廃止した)テストケース ID を "TC-..." 形式で並べる' +
  '(廃止したケースが無ければ retired ごと書かない、または retired: [] と明示する)';

/**
 * action_spec のフロントマターを ActionSpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @param relPath specs/backend/actions からの相対パス(例: "entry/submit.md")
 * @returns ActionSpec とスキーマ違反。必須項目を読めない場合は value=null
 */
export function parseActionSpec(data: unknown, file: string, relPath: string): ParseResult<ActionSpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'action_spec のフロントマターがマッピングではありません',
      'template.action_spec.md をコピーし、doc_type: action_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'action_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  checkScope(root, reporter);

  const handles = parseHandles(root, reporter);
  const id = parseId(root, handles, reporter);
  const input = parseInput(root, reporter);
  const computes = parseComputes(root, reporter);
  const owner = parseOwner(root, reporter);
  const runner = parseRunner(root, reporter);
  const errors = parseErrors(root, reporter);
  const testCases = parseTestCases(root, reporter);
  const retired = parseRetired(root, reporter);
  const ux = parseUx(root, reporter);
  const exceptions = parseLintExceptions(root, reporter);

  if (id === null || handles === null || input === null || errors === null || testCases === null) {
    return { value: null, findings: reporter.findings() };
  }
  return {
    value: {
      id,
      handles,
      input,
      computes,
      ...(owner === undefined ? {} : { owner }),
      ...(runner === undefined ? {} : { runner }),
      errors,
      testCases,
      ...(ux === undefined ? {} : { ux }),
      retired,
      exceptions,
      relPath,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

const UX_SUGGESTION =
  'ux: を書くなら confirm(none または required)と reason(上書きの理由。日本語 1 文)を両方書く';

/**
 * `ux:`(方針の導出の上書き)を読む。省略可能 — 上書きが無いファイルは書かなくてよい。
 *
 * `reason` の有無は V14(トレース検証器)が見る。ここでは形(confirm が値域か・
 * reason が文字列か)だけを見て、パーサーは意味的な必須は課さない
 * (パーサーは 1 ファイルの中で閉じた形式しか見ない規約: action-spec-writing.md)。
 */
function parseUx(root: YamlReader, reporter: SpecReporter): ActionUxOverride | undefined {
  if (!root.has('ux')) return undefined;
  const record = asRecord(root.raw('ux'));
  if (record === null) {
    reporter.error('ux', 'ux がマッピングになっていません', UX_SUGGESTION);
    return undefined;
  }
  const reader = new YamlReader(record, 'ux', reporter);
  const confirm = reader.requiredString('confirm', UX_SUGGESTION);
  if (confirm === null) return undefined;
  if (!(ACTION_UX_CONFIRM_VALUES as readonly string[]).includes(confirm)) {
    reporter.error('ux.confirm', `ux.confirm "${confirm}" は値域にありません`, UX_SUGGESTION, { confirm });
    return undefined;
  }
  const reason = reader.optionalString('reason', UX_SUGGESTION);
  return {
    confirm: confirm as ActionUxOverride['confirm'],
    ...(reason === undefined ? {} : { reason }),
    location: reporter.location('ux'),
  };
}

/**
 * retired(欠番にしたテストケース ID)を読む。省略可能 — 廃止したケースが無いファイルは
 * 書かなくてよい。ID の形式だけをここで検査し、実際に再利用されていないかは A9 が
 * 台帳全体を見て検証する(このパーサーは 1 ファイルの中で閉じた形式しか見ない)。
 */
function parseRetired(root: YamlReader, reporter: SpecReporter): readonly RetiredTestCaseRef[] {
  const raw = root.optionalStringList('retired', RETIRED_SUGGESTION);
  const result: RetiredTestCaseRef[] = [];
  for (const id of raw) {
    if (!TC_ID.test(id)) {
      reporter.error(`retired.${id}`, `retired の ${id} がテストケース ID の形式ではありません`, RETIRED_SUGGESTION, {
        id,
      });
      continue;
    }
    result.push({ id, location: reporter.location(`retired.${id}`) });
  }
  return result;
}

/** scope は backend 固定(action_spec はバックエンド仕様)。 */
function checkScope(root: YamlReader, reporter: SpecReporter): void {
  const scope = root.optionalString('scope', 'scope: backend と書く');
  if (scope === undefined) {
    reporter.error('scope', 'scope がありません', 'フロントマターに scope: backend を書く');
    return;
  }
  if (scope === 'backend') return;
  reporter.error(
    'scope',
    'action_spec の scope は backend でなければなりません',
    'scope: backend に直す(specs/backend 配下の仕様はすべて backend)',
    { actual: scope },
  );
}

/** handles を読んで `{machine}.{event}` に分解する。 */
function parseHandles(root: YamlReader, reporter: SpecReporter): EventRef | null {
  const raw = root.requiredString('handles', HANDLES_SUGGESTION);
  if (raw === null) return null;
  const parts = splitQualified(raw);
  if (parts === null) {
    reporter.error('handles', 'handles がドメインイベント ID の形式ではありません', HANDLES_SUGGESTION, {
      handles: raw,
    });
    return null;
  }
  return { raw, machine: parts.head, event: parts.tail };
}

/** id を読み、handles から導かれる `{machine}-{event}-action` と一致するかを見る。 */
function parseId(root: YamlReader, handles: EventRef | null, reporter: SpecReporter): string | null {
  const suggestion = 'id を "{aggregate}-{event}-action"(例: entry-submit-action)形式で書く';
  const id = root.requiredString('id', suggestion);
  if (id === null || handles === null) return id;
  const expected = `${handles.machine}-${handles.event}-action`;
  if (id === expected) return id;
  reporter.error(
    'id',
    `id が handles(${handles.raw})から導かれる ID と一致しません`,
    `id: ${expected} に直す(id は handles と 1 対 1 に対応する)`,
    { expected, actual: id },
  );
  return id;
}

/** input を読んで `{entity}.{field}` のリストに分解する。空リストは正常。 */
function parseInput(root: YamlReader, reporter: SpecReporter): readonly InputFieldRef[] | null {
  const raw = root.requiredStringList('input', INPUT_SUGGESTION);
  if (raw === null) return null;
  const fields: InputFieldRef[] = [];
  raw.forEach((value, index) => {
    const parts = splitQualified(value);
    if (parts === null) {
      reporter.error(`input[${index}]`, `input[${index}] が "{entity}.{field}" の形式ではありません`, INPUT_SUGGESTION, {
        value,
      });
      return;
    }
    fields.push({
      raw: value,
      entity: parts.head,
      field: parts.tail,
      location: reporter.location(`input.${value}`),
    });
  });
  return fields;
}

const OWNER_SUGGESTION =
  'owner には作成者(実行者)そのもので埋める欄を "{entity}.{field}" 形式で 1 つ書く' +
  '(作成の action_spec だけ。人が選ぶ欄なら input に置く。例: owner: document.author_id)';

/** owner(作成の持ち主の欄。作成者で埋める欄の明示)を読む。省略可能。 */
function parseOwner(root: YamlReader, reporter: SpecReporter): InputFieldRef | undefined {
  const raw = root.optionalString('owner', OWNER_SUGGESTION);
  if (raw === undefined) return undefined;
  const parts = splitQualified(raw);
  if (parts === null) {
    reporter.error('owner', 'owner が "{entity}.{field}" の形式ではありません', OWNER_SUGGESTION, { value: raw });
    return undefined;
  }
  return { raw, entity: parts.head, field: parts.tail, location: reporter.location('owner') };
}

/** errors を読む。inherits は "common" 固定、additional は任意。 */
function parseErrors(root: YamlReader, reporter: SpecReporter): ActionErrors | null {
  const record = asRecord(root.raw('errors'));
  if (record === null) {
    reporter.error('errors', 'errors がないか、マッピングになっていません', ERRORS_SUGGESTION);
    return null;
  }
  const reader = new YamlReader(record, 'errors', reporter);
  const inherits = reader.requiredString('inherits', ERRORS_SUGGESTION);
  if (inherits !== null && inherits !== 'common') {
    reporter.error(
      'errors.inherits',
      'errors.inherits は common でなければなりません',
      '3 分類(guard_unsatisfied / forbidden / invariant_violated)は全アクション共通の契約なので inherits: common と書く',
      { actual: inherits },
    );
  }
  return { inherits: inherits ?? 'common', additional: parseAdditional(reader, reporter) };
}

/** errors.additional(固有エラー)を読む。 */
function parseAdditional(reader: YamlReader, reporter: SpecReporter): readonly ActionErrorDef[] {
  const items = reader.optionalList('additional', ERRORS_SUGGESTION);
  const result: ActionErrorDef[] = [];
  eachRecord(items, 'errors.additional', reporter, ERRORS_SUGGESTION, (element, index) => {
    const kind = element.requiredString('kind', 'additional の各要素に kind(エラー種別の識別子)を書く');
    const when = element.requiredString('when', 'additional の各要素に when(発生条件)を日本語で書く');
    if (kind === null || when === null) return;
    result.push({ kind, when, location: reporter.location(`errors.additional[${index}]`) });
  });
  return result;
}
