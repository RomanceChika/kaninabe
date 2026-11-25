/**
 * auth_spec(認証フロー仕様)のパーサー(H0 = スキーマ適合 + 軸の閉世界)。
 *
 * スキーマの正: auth-spec-writing.md。
 * ここで見るのは 1 ファイルの中で閉じる形だけである — id の固定値・行の id の重複・
 * 軸の値が値域に載っていること・**条件の組が 2 行に現れないこと**(決定表として
 * 結末が一意であること)。他の仕様への接地(状態・画面・イベント)は H1・H2 が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { checkDocType, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import type {
  AuthAxisDecl,
  AuthFlowSpec,
  AuthGateDecl,
  AuthLandingDecl,
  GateFailure,
  GateSubject,
  SignInBranchDecl,
} from './types.js';
import { GATE_FAILURES, GATE_SUBJECTS } from './types.js';
import { parseAxes } from './parse-auth-axes.js';
import { parseAuthEntries } from './parse-auth-callback.js';
import { parseProviders } from './parse-auth-providers.js';
import { parseDeclaredSections } from './parse-auth-sections.js';
import { IdClaims, readEnum, readSnakeId } from './parse-auth-shared.js';

/** 認証フロー仕様の文書 ID(1 プロジェクト 1 フローなので導出元が無く固定)。 */
export const AUTH_FLOW_ID = 'auth-flow';

/**
 * 認証フロー仕様 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築した宣言と H0 違反
 */
export function parseAuthFlow(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<AuthFlowSpec> {
  checkDocType(data, 'auth_spec', reporter);
  const root = new YamlReader(data, '', reporter);

  const id = root.requiredString('id', `id を ${AUTH_FLOW_ID} と書く(1 プロジェクト 1 フロー)`);
  if (id !== null && id !== AUTH_FLOW_ID) {
    reporter.error('id', `id ${id} は認証フロー仕様の id ではありません`, `id: ${AUTH_FLOW_ID} に直す`, {
      id,
      expected: AUTH_FLOW_ID,
    });
  }
  const declaredSubject = root.requiredString(
    'subject',
    'subject に分岐の主語を書く(state_spec の state_machine 名か、' +
      'entity_spec の enum の欄を指す "{エンティティ}.{欄}")',
  );
  // 主語が読めないまま空の主語で続けると、決定表の軸を引けない弱いモデルになる(落とした宣言として数える)。
  if (declaredSubject === null) reporter.dropRows();
  const subject = declaredSubject ?? '';
  const { providers, localOnly } = parseProviders(root, reporter);
  const axes = parseAxes(root, subject, reporter);
  const landings = parseLandings(root, reporter);
  const branches = parseBranches(root, axes, reporter);
  const gates = parseGates(root, reporter);
  const entries = parseAuthEntries(root, reporter);
  const sections = parseDeclaredSections(root, reporter);
  const testCases = parseTestCases(root, reporter) ?? [];

  return {
    value: {
      id: AUTH_FLOW_ID,
      subject,
      providers,
      localOnly,
      axes,
      landings,
      branches,
      gates,
      ...entries,
      ...sections,
      testCases,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** `landings` を読む。着地 ID は実装が返す語なので、形はスネークケースに限る。 */
function parseLandings(root: YamlReader, reporter: SpecReporter): readonly AuthLandingDecl[] {
  const suggestion = 'landings は "- id / screen / (variant) / summary" のリストで書く';
  const items = root.requiredList('landings', suggestion) ?? [];
  const landings: AuthLandingDecl[] = [];
  const claims = new IdClaims();
  eachRecord(items, 'landings', reporter, suggestion, (item, index) => {
    const id = readSnakeId(item, `landings[${index}]`, '着地', reporter);
    if (id === null || !claims.claim(id, `landings[${index}].id`, '着地', reporter)) return;
    const screen = item.requiredString('screen', 'screen に着地する画面の screen_spec の id を書く');
    const summary = item.requiredString('summary', 'summary に「どういう結末か」を 1 行で書く');
    if (screen === null || summary === null) return;
    const variant = item.optionalString('variant', 'variant に画面の variants のキーを書く');
    landings.push({
      id,
      screen,
      ...(variant === undefined ? {} : { variant }),
      summary,
      location: reporter.location(`landings.${id}`),
    });
  });
  reporter.settleRows(items.length, landings.length, claims.duplicates);
  return landings;
}

/** `sign_in` を読む。行は決定表の 1 行であり、条件の組は一意でなければならない。 */
function parseBranches(
  root: YamlReader,
  axes: readonly AuthAxisDecl[],
  reporter: SpecReporter,
): readonly SignInBranchDecl[] {
  const suggestion = branchSuggestion(axes);
  const items = root.requiredList('sign_in', suggestion) ?? [];
  const branches: SignInBranchDecl[] = [];
  const claims = new IdClaims();
  const seenCondition = new Map<string, string>();
  eachRecord(items, 'sign_in', reporter, suggestion, (item, index) => {
    const id = readSnakeId(item, `sign_in[${index}]`, '分岐', reporter);
    if (id === null || !claims.claim(id, `sign_in[${index}].id`, '分岐', reporter)) return;
    const decl = buildBranch(item, id, axes, reporter);
    if (decl === null) return;
    const key = conditionKey(decl, axes);
    const earlier = seenCondition.get(key);
    if (earlier !== undefined) {
      reporter.error(
        `sign_in[${index}]`,
        `分岐 ${id} は ${earlier} と同じ条件(${key})です`,
        '決定表の行は条件の組で一意にする(同じ状況で結末が 2 つあると、どちらが起きるか宣言できていない)',
        { branch: id, earlier, condition: key },
      );
      return;
    }
    seenCondition.set(key, id);
    branches.push(decl);
  });
  reporter.settleRows(items.length, branches.length, claims.duplicates);
  return branches;
}

/** 行の書き方の案内(宣言された軸の名前を差し込む — 体系側は軸の名前を持たない)。 */
function branchSuggestion(axes: readonly AuthAxisDecl[]): string {
  const required = axes.filter((axis) => axis.when === undefined && axis.optional !== true).map((axis) => axis.id);
  const conditional = axes.filter((axis) => axis.when !== undefined || axis.optional === true).map((axis) => axis.id);
  const parts = [...required, ...(conditional.length === 0 ? [] : [`(${conditional.join('・')})`])];
  return `sign_in は "- id / ${parts.join(' / ')} / (runs) / lands / summary" のリストで書く`;
}

/** 行の骨格の欄(軸の値ではないもの)。ここと軸 ID 以外の鍵は綴り間違いとしてエラーにする。 */
const BRANCH_KEYS: readonly string[] = ['id', 'runs', 'lands', 'summary'];

/** 1 行分を読む。1 つでも読めなければ行ごと落とす。 */
function buildBranch(
  item: YamlReader,
  id: string,
  axes: readonly AuthAxisDecl[],
  reporter: SpecReporter,
): SignInBranchDecl | null {
  const lands = item.requiredString('lands', 'lands に landings の id を書く');
  const summary = item.requiredString('summary', 'summary に「何が起きるか」を 1 行で書く');
  if (lands === null || summary === null) return null;
  item.rejectUnknownKeys(
    [...BRANCH_KEYS, ...axes.map((axis) => axis.id)],
    '決定表の 1 行',
    '行に書ける鍵は骨格(id / runs / lands / summary)と axes で宣言した軸 ID だけである' +
      '(軸を足すなら axes に宣言する)',
  );
  const values = readAxisValues(item, id, axes, reporter);
  if (values === null) return null;
  const runs = item.optionalStringList('runs', 'runs にこの行で実行されるドメインイベント ID を並べる');
  return { id, values, runs, lands, summary, location: reporter.location(`sign_in.${id}`) };
}

/**
 * 宣言された軸ごとに、その行の値を読む。
 *
 * 必須(`when` / `optional` のどちらも宣言していない軸)は欠けていれば違反である。それ以外の
 * 軸は**あれば読む**だけで、「あってよい行か」の判定は H1(state_spec と照らして全域性まで
 * 見られる位置)が行う —— ここは 1 ファイルの中で閉じる形だけを見る。
 */
function readAxisValues(
  item: YamlReader,
  id: string,
  axes: readonly AuthAxisDecl[],
  reporter: SpecReporter,
): Record<string, string> | null {
  const values: Record<string, string> = {};
  for (const axis of axes) {
    const required = axis.when === undefined && axis.optional !== true;
    if (!item.has(axis.id)) {
      if (!required) continue;
      reporter.error(
        `sign_in.${id}.${axis.id}`,
        `分岐 ${id} に ${axis.id}(${axis.summary})がありません`,
        `${axis.id} に値を書く(この軸は when / optional を宣言していないので全行で必須)`,
        { branch: id, axis: axis.id },
      );
      return null;
    }
    const allowed = axis.kind === 'enum' ? (axis.values ?? []) : null;
    const raw =
      allowed === null
        ? item.requiredString(axis.id, `${axis.id} に主語の状態(または ${axis.absent ?? '行なし'})を書く`)
        : readEnum<string>(item, axis.id, allowed, reporter, true);
    if (raw === null || raw === undefined) return null;
    values[axis.id] = raw;
  }
  return values;
}

/** 条件の組(宣言された全軸の値)を 1 本の文字列にする。行の一意性の判定キー。 */
function conditionKey(decl: SignInBranchDecl, axes: readonly AuthAxisDecl[]): string {
  return axes.map((axis) => `${axis.id}=${decl.values[axis.id] ?? '-'}`).join(' ');
}

/** `gates` を読む。送り先の有無は `on_fail` と対応していなければならない。 */
function parseGates(root: YamlReader, reporter: SpecReporter): readonly AuthGateDecl[] {
  const suggestion = 'gates は "- id / guards / on_fail / (to) / implementation / summary" のリストで書く';
  const items = root.requiredList('gates', suggestion) ?? [];
  const gates: AuthGateDecl[] = [];
  const claims = new IdClaims();
  eachRecord(items, 'gates', reporter, suggestion, (item, index) => {
    const id = readSnakeId(item, `gates[${index}]`, '関門', reporter);
    if (id === null || !claims.claim(id, `gates[${index}].id`, '関門', reporter)) return;
    const decl = buildGate(item, id, reporter);
    if (decl !== null) gates.push(decl);
  });
  reporter.settleRows(items.length, gates.length, claims.duplicates);
  return gates;
}

/** 関門 1 件を読む。 */
function buildGate(item: YamlReader, id: string, reporter: SpecReporter): AuthGateDecl | null {
  const guards = readEnum<GateSubject>(item, 'guards', GATE_SUBJECTS, reporter, true);
  const onFail = readEnum<GateFailure>(item, 'on_fail', GATE_FAILURES, reporter, true);
  const implementation = item.requiredString(
    'implementation',
    'implementation に "パス::関数名" を書く(H2 が実在を見る)',
  );
  const summary = item.requiredString('summary', 'summary に「どういう関門か」を 1 行で書く');
  if (guards == null || onFail == null || implementation === null || summary === null) return null;
  const to = item.optionalString('to', 'to に送り先の画面 id を書く');
  if (onFail === 'redirect' && to === undefined) {
    reporter.error(`gates.${id}.to`, `関門 ${id} に送り先(to)がありません`, '送り返す関門は行き先を宣言する', { gate: id });
    return null;
  }
  if (onFail !== 'redirect' && to !== undefined) {
    reporter.error(
      `gates.${id}.to`,
      `関門 ${id} は送り返さないのに to を持っています`,
      'to を消すか、on_fail を redirect にする(送り先は redirect のときだけ意味を持つ)',
      { gate: id, on_fail: onFail },
    );
    return null;
  }
  const role = item.optionalString('role', 'role に画面仕様の for: [...] が見るロール ID を書く(roles.md 参照)');
  if (guards === 'role_gate' && role === undefined) {
    reporter.error(
      `gates.${id}.role`,
      `関門 ${id} は guards: role_gate なのに role がありません`,
      'role に画面仕様の for: [...] が見るロール ID を書く(例: role: staff)',
      { gate: id },
    );
    return null;
  }
  if (guards !== 'role_gate' && role !== undefined) {
    reporter.error(
      `gates.${id}.role`,
      `関門 ${id} は guards: ${guards} なのに role を持っています`,
      'role を消すか、guards を role_gate にする(role_gate 以外はロールを見ない関門)',
      { gate: id, guards },
    );
    return null;
  }
  return {
    id,
    guards,
    ...(role === undefined ? {} : { role }),
    onFail,
    ...(to === undefined ? {} : { to }),
    implementation,
    summary,
    location: reporter.location(`gates.${id}`),
  };
}

