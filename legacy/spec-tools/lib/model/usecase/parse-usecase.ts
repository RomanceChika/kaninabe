/**
 * usecase_spec(`specs/frontend/usecases/{name}.md`)のパーサー。
 *
 * スキーマの正: usecase-spec-writing.md §スキーマ。Y0(スキーマ適合)はここが担う。
 * 他の仕様との突合(Y1〜Y11)は検証器がモデルに対して行う。
 * ファイル I/O は行わない(I/O は lib/model/usecase/loader.ts に集約する。規約: scripts-code-quality.md)。
 *
 * **書けるキーは allowlist で閉じる**(ADR-0011 §2「できないこと」)。ガード・権限・必須・
 * 不変条件に相当するキーが無いのは書き忘れではなく、書けないようにした結果である。
 *
 * **`saves` / `budget` / `accept` の節のパーサー**(`parseSaves` ・`parseBudget` ・`parseAccept`)も
 * 同じファイルにある。
 *
 * @oversize 超える理由: usecase_spec のフロントマターを読む流れ(骨格 → 保存点 → 予算 → 受け入れ)は 1 つの
 *   仕様の読み取りで、書けるキーの allowlist と報告器を共有する。キーの閉世界(ここに無いキーは書けない)
 *   を 1 か所で確かめられる。
 * @split-review 割る案と結果: 骨格と、保存点・予算・受け入れの 3 節(`parseSaves` ・`parseBudget` ・`parseAccept`。以前の
 *   `parse-usecase-saves.ts`)に割る案を検討した(以前はそう割っていた)。3 節の読み取りを呼ぶのは
 *   `parseUsecaseSpec` だけで、ほかのパーサーや検証器は直接読まない(葉が一方向に読まれるだけで、使い手が
 *   1 人)。節ごとの書けるキー(骨格の `ROOT_KEYS` と各節のキー)を 1 か所で見比べて、キーの閉世界を確かめる
 *   ほうを採った。
 */

import { asRecord, checkDocType, META_FRONTMATTER_KEYS, SpecReporter } from '../parse-common.js';
import { requiredMigrationFile } from '../migration-file.js';
import type { ParseResult } from '../parse-common.js';
import { YamlReader, eachRecord } from '../yaml-reader.js';
import { USECASE_BUDGET_METRICS } from './types.js';
import type {
  UsecaseSpec,
  UsecaseAcceptDecl,
  UsecaseBudget,
  UsecaseBudgetMetric,
  UsecaseSaveDecl,
  UsecaseStepDecl,
} from './types.js';
import { parseTestCases } from '../parse-test-case.js';

/** ユースケース名(snake_case)。 */
const NAME = /^[a-z][a-z0-9_]*$/;

const NAME_SUGGESTION = 'name にユースケース名を snake_case で書く(例: entry_self)';
const GOAL_SUGGESTION = 'goal に人の言葉での目的を空でない文字列で書く(例: 自分一人で発表枠に申し込む)';
const ACTOR_SUGGESTION = 'actor に roles.md のグローバル人間ロールを 1 つ書く(例: member)';
const START_SUGGESTION = 'start にこのユースケースが始まる screen_spec の id を書く(例: screen-workshop-list)';
const DONE_SUGGESTION =
  'done に達成条件をガード式と同じ文法で書く(例: entry.state == submitted)';

/** ルートに書けるキー(allowlist。ADR-0011 §2)。 */
const ROOT_KEYS = [
  'doc_type',
  'scope',
  'id',
  'name',
  'goal',
  'actor',
  'start',
  'done',
  'saves',
  'budget',
  'accept',
  'test_cases',
];

/**
 * ユースケース名から id を導く。`_` を `-` に置き換えて `usecase-` を前置する。
 *
 * @param name ユースケース名(snake_case)
 * @returns 期待される id(例: entry_self → usecase-entry-self)
 */
function usecaseIdOf(name: string): string {
  return `usecase-${name.split('_').join('-')}`;
}

/**
 * usecase_spec のパース結果。仕様として読めた(`value` が非 null)ときに、その中で読めずに落とした行の数(受け入れ・予算の指標・
 * テストケースの要素)を添える。仕様ごと読めなかった(`value` が null)ときの数は呼び手が 1 件と数える。
 */
export interface UsecaseParseResult extends ParseResult<UsecaseSpec> {
  /** 仕様の中で読めずに落とした行の数。 */
  readonly dropped: number;
}

/**
 * usecase_spec のフロントマターを UsecaseSpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @param relPath specs/frontend/usecases からの相対パス(例: "entry_self.md")
 * @returns UsecaseSpec と Y0 違反と、落とした行の数。必須項目を読めない場合は value=null
 */
export function parseUsecaseSpec(data: unknown, file: string, relPath: string): UsecaseParseResult {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'usecase_spec のフロントマターがマッピングではありません',
      'template.usecase_spec.md をコピーし、doc_type: usecase_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings(), dropped: reporter.droppedCount() };
  }

  checkDocType(record, 'usecase_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  root.rejectUnknownKeys(
    [...ROOT_KEYS, ...META_FRONTMATTER_KEYS],
    'usecase_spec',
    `書けるのは ${ROOT_KEYS.join(' / ')} だけ(ADR-0011: ユースケースは操作を組み合わせるだけで、` +
      'ガード・権限・必須・不変条件を定義し直せない)',
  );
  checkScope(root, reporter);

  const name = parseName(root, reporter);
  const id = parseId(root, name, reporter);
  const goal = requireNonEmpty(root, reporter, 'goal', GOAL_SUGGESTION);
  const actor = root.requiredString('actor', ACTOR_SUGGESTION);
  const start = root.requiredString('start', START_SUGGESTION);
  const done = requireNonEmpty(root, reporter, 'done', DONE_SUGGESTION);
  const saves = parseSaves(root, reporter);
  const budget = parseBudget(root, reporter);
  const accept = parseAccept(root, reporter);
  const testCases = parseTestCases(root, reporter) ?? [];
  if (name !== null) checkFileName(name, relPath, reporter);

  if (
    id === null ||
    name === null ||
    goal === null ||
    actor === null ||
    start === null ||
    done === null ||
    saves === null
  ) {
    return { value: null, findings: reporter.findings(), dropped: reporter.droppedCount() };
  }

  return {
    value: {
      id,
      name,
      goal,
      actor,
      start,
      done,
      saves,
      budget,
      accept,
      testCases,
      relPath,
      location: reporter.location(),
    },
    findings: reporter.findings(),
    dropped: reporter.droppedCount(),
  };
}

/** scope は frontend 固定(usecase_spec は「人の都合の層」であり frontend 配下)。 */
function checkScope(root: YamlReader, reporter: SpecReporter): void {
  const scope = root.optionalString('scope', 'scope: frontend と書く');
  if (scope === undefined) {
    reporter.error('scope', 'scope がありません', 'フロントマターに scope: frontend を書く');
    return;
  }
  if (scope === 'frontend') return;
  reporter.error(
    'scope',
    'usecase_spec の scope は frontend でなければなりません',
    'scope: frontend に直す(specs/frontend 配下の仕様はすべて frontend)',
    { actual: scope },
  );
}

/** name を読む。snake_case 以外はエラー(id・ファイル名の導出が壊れるため)。 */
function parseName(root: YamlReader, reporter: SpecReporter): string | null {
  const name = root.requiredString('name', NAME_SUGGESTION);
  if (name === null) return null;
  if (NAME.test(name)) return name;
  reporter.error('name', `name ${name} が snake_case ではありません`, NAME_SUGGESTION, { name });
  return null;
}

/** id を読み、name から導かれる `usecase-{name}` と一致するかを見る。 */
function parseId(root: YamlReader, name: string | null, reporter: SpecReporter): string | null {
  const suggestion = 'id を "usecase-{name をハイフン区切りにしたもの}"(例: usecase-entry-self)形式で書く';
  const id = root.requiredString('id', suggestion);
  if (id === null || name === null) return id;
  const expected = usecaseIdOf(name);
  if (id === expected) return id;
  reporter.error(
    'id',
    `id が name(${name})から導かれる ID と一致しません`,
    `id: ${expected} に直す(id は name と 1 対 1 に対応する)`,
    { expected, actual: id },
  );
  return id;
}

/** 空文字を許さない必須文字列(goal / done は「書いたが空」を書き忘れと同じに扱う)。 */
function requireNonEmpty(root: YamlReader, reporter: SpecReporter, key: string, suggestion: string): string | null {
  const value = root.requiredString(key, suggestion);
  if (value === null) return null;
  if (value.trim() !== '') return value;
  reporter.error(root.pointer(key), `${key} が空です`, suggestion);
  return null;
}

/** ファイル名が `{name}.md` になっているかを見る(パスから実装を導けるようにするため)。 */
function checkFileName(name: string, relPath: string, reporter: SpecReporter): void {
  if (relPath === `${name}.md`) return;
  reporter.error(
    'name',
    `ファイル名 ${relPath} が name(${name})と一致しません`,
    `ファイルを ${name}.md にリネームするか、name を ${relPath.replace(/\.md$/, '')} に直す`,
    { expected: `${name}.md`, actual: relPath },
  );
}

/** 保存点 ID(snake_case)。 */
const SAVE_ID = /^[a-z][a-z0-9_]*$/;

const SAVES_SUGGESTION = 'saves に保存点を 1 つ以上並べる(各要素は id / label / steps を持つマッピング)';

/** `saves[]` の要素に書けるキー。 */
const SAVE_KEYS = ['id', 'label', 'migration', 'steps'];

/** `saves[].steps[]` の要素に書けるキー。 */
const STEP_KEYS = ['op', 'as', 'label', 'repeat', 'defaults'];

/** 手順の別名(`as`。snake_case)。保存点の中で一意であることは Y11 が見る。 */
const STEP_ALIAS = /^[a-z][a-z0-9_]*$/;

/** `saves[].steps[].defaults` に書けるキー(語彙は `self` の 1 語だけ。types.ts の USECASE_DEFAULT_KEYS)。 */
const DEFAULTS_KEYS = ['self'];

/** `accept[]` の要素に書けるキー。 */
const ACCEPT_KEYS = ['metric', 'invariant', 'reason'];

/** saves を読む。1 つ以上必須。 */
function parseSaves(root: YamlReader, reporter: SpecReporter): readonly UsecaseSaveDecl[] | null {
  const items = root.requiredList('saves', SAVES_SUGGESTION);
  if (items === null) return null;
  if (items.length === 0) {
    reporter.error('saves', 'saves が空です', SAVES_SUGGESTION);
    return null;
  }
  const saves: UsecaseSaveDecl[] = [];
  eachRecord(items, 'saves', reporter, SAVES_SUGGESTION, (reader) => {
    const save = parseSave(reader, reporter);
    if (save !== null) saves.push(save);
  });
  return saves.length === items.length ? saves : null;
}

/** saves[] の 1 要素。 */
function parseSave(reader: YamlReader, reporter: SpecReporter): UsecaseSaveDecl | null {
  reader.rejectUnknownKeys(SAVE_KEYS, 'saves の要素', `書けるのは ${SAVE_KEYS.join(' / ')} だけ`);
  const idSuggestion = 'id に保存点の識別子を snake_case で書く(例: register)';
  const id = reader.requiredString('id', idSuggestion);
  const label = reader.requiredString('label', 'label に人の言葉での説明を書く(例: 枠と参加者と資料を登録して申し込む)');
  const migration = requiredMigrationFile(
    reader,
    reporter,
    'migration',
    'migration に複合 RPC を書き出す migration のファイル名を書く(例: 20260909000050_usecase_entry_self_register.sql)',
  );
  const steps = parseSteps(reader, reporter);
  if (id !== null && !SAVE_ID.test(id)) {
    reporter.error(reader.pointer('id'), `saves の id ${id} が snake_case ではありません`, idSuggestion, { id });
    return null;
  }
  if (id === null || label === null || migration === null || steps === null) return null;
  return { id, label, migration, steps, location: reporter.location(reader.pointer('id')) };
}

/** saves[].steps を読む。1 つ以上必須。 */
function parseSteps(reader: YamlReader, reporter: SpecReporter): readonly UsecaseStepDecl[] | null {
  const stepSuggestion = 'steps に手順を 1 つ以上並べる(各要素は "- op: {操作ID}" の形で書く)';
  const items = reader.requiredList('steps', stepSuggestion);
  if (items === null) return null;
  if (items.length === 0) {
    reporter.error(reader.pointer('steps'), 'steps が空です', stepSuggestion);
    return null;
  }
  const steps: UsecaseStepDecl[] = [];
  eachRecord(items, reader.pointer('steps'), reporter, stepSuggestion, (stepReader) => {
    const step = parseStep(stepReader, reporter);
    if (step !== null) steps.push(step);
  });
  return steps.length === items.length ? steps : null;
}

/** steps[] の 1 要素。 */
function parseStep(reader: YamlReader, reporter: SpecReporter): UsecaseStepDecl | null {
  reader.rejectUnknownKeys(STEP_KEYS, 'steps の要素', `書けるのは ${STEP_KEYS.join(' / ')} だけ`);
  const op = reader.requiredString(
    'op',
    'op にドメインイベント ID(例: entry.submit)または予約 ID(例: entry.create)を書く',
  );
  const alias = parseAlias(reader, reporter);
  const label = parseStepLabel(reader, reporter);
  const repeat = reader.optionalBoolean('repeat', 'repeat は true / false で書く(既定 false)', false);
  const defaultsSelf = parseDefaults(reader, reporter);
  if (op === null || alias === undefined || label === undefined || defaultsSelf === null) return null;
  return { op, alias, label, repeat, defaultsSelf, location: reporter.location(reader.pointer('op')) };
}

/**
 * steps[].as を読む。任意。snake_case。
 *
 * @returns 書かれていなければ null、形が違えば undefined(呼び側が手順ごと落とす)
 */
function parseAlias(reader: YamlReader, reporter: SpecReporter): string | null | undefined {
  const suggestion = 'as に手順の別名を snake_case で書く(例: self。同じ操作を 2 回書くときの鍵になる)';
  if (!reader.has('as')) return null;
  const alias = reader.requiredString('as', suggestion);
  if (alias === null) return undefined;
  if (STEP_ALIAS.test(alias)) return alias;
  reporter.error(reader.pointer('as'), `steps の as ${alias} が snake_case ではありません`, suggestion, { as: alias });
  return undefined;
}

/**
 * steps[].label を読む。任意。空文字は書けない。
 *
 * @returns 書かれていなければ null、空文字なら undefined(呼び側が手順ごと落とす)
 */
function parseStepLabel(reader: YamlReader, reporter: SpecReporter): string | null | undefined {
  const suggestion = 'label にフォームの節の見出しを書く(例: 他の参加者。省略すると操作の label になる)';
  if (!reader.has('label')) return null;
  const label = reader.requiredString('label', suggestion);
  if (label === null) return undefined;
  if (label.trim() !== '') return label;
  reporter.error(reader.pointer('label'), 'steps の label が空です', suggestion);
  return undefined;
}

/** steps[].defaults を読む。書けるのは `self: true` だけ(語彙は閉じている)。 */
function parseDefaults(reader: YamlReader, reporter: SpecReporter): boolean | null {
  if (!reader.has('defaults')) return false;
  const raw = reader.raw('defaults');
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(
      reader.pointer('defaults'),
      'defaults はマッピングで書きます',
      'defaults: { self: true } の形で書く',
    );
    return null;
  }
  const defaultsReader = new YamlReader(record, reader.pointer('defaults'), reporter);
  defaultsReader.rejectUnknownKeys(
    DEFAULTS_KEYS,
    'defaults',
    '書けるのは self だけ(「自分として」の既定値。語彙は閉じている)',
  );
  if (!defaultsReader.has('self')) return false;
  const self = defaultsReader.requiredBoolean('self', 'self は true で書く(自分として、を意味する)');
  if (self === null) return null;
  if (self) return true;
  reporter.error(
    defaultsReader.pointer('self'),
    'self: false は意味を持ちません',
    '既定値が要らないなら defaults ごと消す',
  );
  return null;
}

/** budget を読む。任意。書かれた指標だけ既定を上書きする。 */
function parseBudget(root: YamlReader, reporter: SpecReporter): UsecaseBudget {
  if (!root.has('budget')) return {};
  const raw = root.raw('budget');
  const record = asRecord(raw);
  if (record === null) {
    reporter.error('budget', 'budget はマッピングで書きます', `budget: { ${USECASE_BUDGET_METRICS[0]}: 4 } の形で書く`);
    reporter.dropRows();
    return {};
  }
  const reader = new YamlReader(record, 'budget', reporter);
  reader.rejectUnknownKeys(
    [...USECASE_BUDGET_METRICS],
    'budget',
    `書けるのは ${USECASE_BUDGET_METRICS.join(' / ')} だけ`,
  );
  const budget: Record<string, number> = {};
  for (const metric of USECASE_BUDGET_METRICS) {
    if (!reader.has(metric)) continue;
    if (reader.raw(metric) === null) {
      // 値が無い(null)のは読み飛ばした宣言ではない。error で名指すだけで数えない(既定値に戻ることは error が言う。ux の budget も同じ基準)。
      reporter.error(reader.pointer(metric), `budget.${metric} が null です(値が読めません。既定値のままになります)`, `${metric} は正の整数で書く`);
      continue;
    }
    const value = reader.optionalNumber(metric, `${metric} は正の整数で書く`);
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value <= 0) {
      reporter.error(reader.pointer(metric), `budget.${metric} は正の整数で書きます`, `${metric} は正の整数で書く`, {
        value: String(value),
      });
      reporter.dropRows();
      continue;
    }
    budget[metric] = value;
  }
  return budget;
}

/**
 * accept を読む。任意。**warning の理由つき受け入れ**(予算超過 = Y5 / 実行しない不変条件 = Y10)。
 *
 * 1 要素に書けるのは `metric` か `invariant` の**どちらか一方**である —— 両方書ける形にすると
 * 「何を受け入れたのか」が読む側で決まらない。
 */
function parseAccept(root: YamlReader, reporter: SpecReporter): readonly UsecaseAcceptDecl[] {
  if (!root.has('accept')) return [];
  const items = root.optionalList('accept', 'accept に { metric | invariant, reason } のマッピングを並べる');
  const accepts: UsecaseAcceptDecl[] = [];
  eachRecord(items, 'accept', reporter, 'accept の要素は { metric | invariant, reason } のマッピングで書く', (reader) => {
    reader.rejectUnknownKeys(ACCEPT_KEYS, 'accept の要素', `書けるのは ${ACCEPT_KEYS.join(' / ')} だけ`);
    const reason = reader.requiredString('reason', 'reason に受け入れる理由を書く');
    if (reason === null) return;
    if (reason.trim() === '') {
      reporter.error(reader.pointer('reason'), 'reason が空です', 'reason に受け入れる理由を書く');
      return;
    }
    const decl = parseAcceptSubject(reader, reporter, reason);
    if (decl !== null) accepts.push(decl);
  });
  reporter.settleRows(items.length, accepts.length);
  return accepts;
}

/** accept の 1 要素が何を受け入れるか(予算の指標か、不変条件の id か)を読む。 */
function parseAcceptSubject(
  reader: YamlReader,
  reporter: SpecReporter,
  reason: string,
): UsecaseAcceptDecl | null {
  const hasMetric = reader.has('metric');
  const hasInvariant = reader.has('invariant');
  if (hasMetric === hasInvariant) {
    reporter.error(
      reader.pointer(hasMetric ? 'metric' : 'reason'),
      hasMetric
        ? 'accept の要素に metric と invariant の両方は書けません'
        : 'accept の要素に metric も invariant もありません',
      `受け入れる対象を 1 つだけ書く(予算なら metric: ${USECASE_BUDGET_METRICS.join(' / ')}、` +
        '不変条件なら invariant: {不変条件の id})',
    );
    return null;
  }
  if (hasInvariant) {
    const invariant = reader.requiredString('invariant', 'invariant に受け入れる不変条件の id を書く');
    if (invariant === null) return null;
    return { kind: 'invariant', invariant, reason, location: reporter.location(reader.pointer('invariant')) };
  }
  const metricSuggestion = `metric に ${USECASE_BUDGET_METRICS.join(' / ')} のいずれかを書く`;
  const metricRaw = reader.requiredString('metric', metricSuggestion);
  if (metricRaw === null) return null;
  if (!isBudgetMetric(metricRaw)) {
    reporter.error(reader.pointer('metric'), `metric ${metricRaw} は budget の指標ではありません`, metricSuggestion, {
      metric: metricRaw,
    });
    return null;
  }
  return { kind: 'budget', metric: metricRaw, reason, location: reporter.location(reader.pointer('metric')) };
}

/** 文字列が budget の指標名かを判定する。 */
function isBudgetMetric(value: string): value is UsecaseBudgetMetric {
  return (USECASE_BUDGET_METRICS as readonly string[]).includes(value);
}
