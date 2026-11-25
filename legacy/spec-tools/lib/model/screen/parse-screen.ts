/**
 * screen_spec(`specs/frontend/screens/{group}/{name}.md`)のパーサー。
 *
 * スキーマの正: screen-spec-writing.md §スキーマ。S0(スキーマ適合)はここが担う。
 * 他の仕様との突合(S1〜S12)は検証器がモデルに対して行う。
 * ファイル I/O は行わない(I/O は lib/model/screen/loader.ts に集約する。規約: scripts-code-quality.md)。
 */

import {
  asArray,
  asRecord,
  checkDocType,
  SpecReporter,
  type ParseResult,
} from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import { missingLayout, parseLayout } from './parse-layout.js';
import {
  PLATFORM_OPS_SUGGESTION,
  parseNavigations,
  parseOverlays,
  parsePrecondition,
  parseRefList,
  parseRequiredStates,
} from './parse-screen-parts.js';
import { parseSmoke } from './parse-screen-smoke.js';
import { parseUx } from './parse-screen-ux.js';
import type { ScreenLayout, ScreenSpec, ScreenTestCase } from './types.js';
import type { ProductLayout } from '../product/layout.js';
import type { ProductRoots } from '../product/types.js';

/** 画面名(snake_case)。testid のスロットパスの先頭になる。 */
const NAME = /^[a-z][a-z0-9_]*$/;

const NAME_SUGGESTION =
  'name に画面名を snake_case で書く(例: workshop_detail)。testid は {name}.{スロット}.{部品} になる';

const FOR_SUGGESTION =
  'for にこの画面を見るロールを 1 つ以上並べる(roles.md に定義されたグローバルロール)';

/** 画面そのものの表示名(トップレベル label)の書き方。 */
export const SCREEN_LABEL_SUGGESTION =
  'label はこの画面の表示名(日本語名)を空でない文字列で書く。例: label: 催し詳細。' +
  '表示名を決めていないならキーごと消す(label は任意。testid にも route にも影響しない)';

const ROUTE_SUGGESTION =
  'route を URL の形で書く。動的セグメントは :param(例: /workshops/:id)';

const READS_SUGGESTION = 'reads にこの画面が読む query_spec の id を並べる(例: query-workshop-detail)';

const ACTIONS_SUGGESTION =
  'actions にこの画面が発火するドメインイベント ID を並べる(例: entry.create。予約 ID も可)';

const USECASES_SUGGESTION =
  'usecases にこの画面から起こせる保存点の鍵を並べる(例: entry_self.register)。' +
  '保存点は usecase_spec の saves[] であり、複数の操作を 1 トランザクションで実行する';

/**
 * 画面名から id を導く。`_` を `-` に置き換えて `screen-` を前置する。
 *
 * @param name 画面名(snake_case)
 * @returns 期待される id(例: workshop_detail → screen-workshop-detail)
 */
export function screenIdOf(name: string): string {
  return `screen-${name.split('_').join('-')}`;
}

/**
 * screen_spec のフロントマターを ScreenSpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @param relPath specs/frontend/screens からの相対パス(例: "workshop/workshop_detail.md")
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(smoke の置き場 = 役割 `e2e-root`)
 * @returns ScreenSpec と S0 違反。必須項目を読めない場合は value=null
 */
export function parseScreenSpec(
  data: unknown,
  file: string,
  relPath: string,
  roots: ProductRoots,
  layout: ProductLayout,
): ParseResult<ScreenSpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'screen_spec のフロントマターがマッピングではありません',
      'template.screen_spec.md をコピーし、doc_type: screen_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'screen_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  checkScope(root, reporter);

  const name = parseName(root, reporter);
  const id = parseId(root, name, reporter);
  const route = parseRoute(root);
  const forRoles = root.requiredStringList('for', FOR_SUGGESTION, false);
  const testCases = parseScreenTestCases(root, reporter);
  if (name !== null) checkPlacement(name, relPath, reporter);

  // 任意項目も**必ず**読む。必須項目が欠けたところで打ち切ると、同じファイルの
  // レイアウトや遷移の書き間違いが指摘されないまま消える(1 回の verify で全部見せるため)。
  const optional = parseOptional(root, reporter, roots, layout);

  if (id === null || name === null || route === null || forRoles === null || testCases === null) {
    return { value: null, findings: reporter.findings() };
  }
  return {
    value: { id, name, route, forRoles, testCases, ...optional, relPath, location: reporter.location() },
    findings: reporter.findings(),
  };
}

/** 任意項目(必須項目の成否に関わらず読むもの)。 */
type OptionalParts = Omit<
  ScreenSpec,
  'id' | 'name' | 'route' | 'forRoles' | 'testCases' | 'relPath' | 'location'
>;

/** 任意項目をまとめて読む。 */
function parseOptional(root: YamlReader, reporter: SpecReporter, roots: ProductRoots, layout: ProductLayout): OptionalParts {
  const chrome = root.optionalString('chrome', 'chrome に継承する chrome_spec の id を書く(例: chrome-member)');
  const label = root.optionalLabel('label', SCREEN_LABEL_SUGGESTION);
  const subject = parseSubject(root, reporter);
  const { precondition, onFail } = parsePrecondition(root, subject !== null, reporter);
  return {
    ...(label === undefined ? {} : { label }),
    ...(chrome === undefined ? {} : { chrome: { id: chrome, location: reporter.location('chrome') } }),
    entryPoint: root.optionalBoolean('entry_point', 'entry_point に true / false を書く'),
    requiresAuth: root.optionalBoolean(
      'requires_auth',
      'requires_auth に true / false を書く(true はセッション必須。実装の requireSession() に対応する)',
    ),
    ...(subject === null ? {} : { subject }),
    ...(precondition === null ? {} : { precondition }),
    ...(onFail === null ? {} : { onFail }),
    reads: parseRefList(root.raw('reads'), 'reads', READS_SUGGESTION, reporter),
    actions: parseRefList(root.raw('actions'), 'actions', ACTIONS_SUGGESTION, reporter),
    usecases: parseRefList(root.raw('usecases'), 'usecases', USECASES_SUGGESTION, reporter),
    platformOps: parseRefList(root.raw('platform_ops'), 'platform_ops', PLATFORM_OPS_SUGGESTION, reporter),
    navigations: parseNavigations(root, reporter),
    overlays: parseOverlays(root, reporter),
    layout: parseScreenLayout(root, reporter),
    requiredStates: parseRequiredStates(root, reporter),
    smoke: parseSmoke(root, reporter, roots, layout),
    ux: parseUx(root, reporter),
  };
}

/**
 * `subject` を読む。
 *
 * `route` の動的セグメントが指すエンティティであり、`precondition` の式を解決する起点になる。
 * 実在(entity_spec があるか)は S5 が見る — ここでは名前の形だけを見る。
 */
function parseSubject(
  root: YamlReader,
  reporter: SpecReporter,
): { entity: string; location: ReturnType<SpecReporter['location']> } | null {
  const suggestion =
    'subject に、この画面が扱う対象のエンティティ名を snake_case で書く(例: workshop)。' +
    'precondition の式はこのエンティティを起点に解決される';
  const entity = root.optionalString('subject', suggestion);
  if (entity === undefined) return null;
  if (!NAME.test(entity)) {
    reporter.error('subject', `subject ${entity} がエンティティ名の形式ではありません`, suggestion, {
      subject: entity,
    });
    return null;
  }
  return { entity, location: reporter.location('subject') };
}

/**
 * `layout` を読む。未記入はエラー(「どこに何があるか」の宣言が無い画面は仕様になっていない)。
 * 読めない場合も空のレイアウトを返し、残りの指摘を消さない。
 *
 * 「キーが無い」と「書いたが空」は別の違反として分ける。前者はここ(S0)、
 * 後者は S6 が見る(1 つの書き忘れに 2 つのエラーを出さないため)。
 */
function parseScreenLayout(root: YamlReader, reporter: SpecReporter): ScreenLayout {
  if (!root.has('layout')) {
    reporter.error(
      'layout',
      'layout がありません',
      'layout に "body: { center: [...] }" のようにスロットと部品を書く(どのスロットを使うかは自由だが、宣言そのものは必須)',
    );
    return missingLayout('layout', reporter);
  }
  return parseLayout(root.raw('layout'), 'layout', reporter);
}

/**
 * `test_cases` を読む。
 *
 * 未記入と空リストを許すのは v1 だけの措置である(screenTest は Phase C-3。
 * 対応するテストの形が決まっていない時点で宣言を要求すると、書けない注釈が並ぶ)。
 * 1 件でも書かれていれば、形式は action_spec / query_spec と同じ規則で検査する。
 */
function parseScreenTestCases(
  root: YamlReader,
  reporter: SpecReporter,
): readonly ScreenTestCase[] | null {
  const raw = root.raw('test_cases');
  if (raw === undefined || raw === null) return [];
  const list = asArray(raw);
  if (list !== null && list.length === 0) return [];
  return parseTestCases(root, reporter);
}

/** scope は frontend 固定(screen_spec はフロントエンド仕様)。 */
function checkScope(root: YamlReader, reporter: SpecReporter): void {
  const scope = root.optionalString('scope', 'scope: frontend と書く');
  if (scope === undefined) {
    reporter.error('scope', 'scope がありません', 'フロントマターに scope: frontend を書く');
    return;
  }
  if (scope === 'frontend') return;
  reporter.error(
    'scope',
    'screen_spec の scope は frontend でなければなりません',
    'scope: frontend に直す(specs/frontend 配下の仕様はすべて frontend)',
    { actual: scope },
  );
}

/** name を読む。snake_case 以外はエラー(testid のスロットパスの導出が壊れるため)。 */
function parseName(root: YamlReader, reporter: SpecReporter): string | null {
  const name = root.requiredString('name', NAME_SUGGESTION);
  if (name === null) return null;
  if (NAME.test(name)) return name;
  reporter.error('name', `name ${name} が snake_case ではありません`, NAME_SUGGESTION, { name });
  return null;
}

/** id を読み、name から導かれる `screen-{name}` と一致するかを見る。 */
function parseId(root: YamlReader, name: string | null, reporter: SpecReporter): string | null {
  const suggestion = 'id を "screen-{name をハイフン区切りにしたもの}"(例: screen-workshop-detail)形式で書く';
  const id = root.requiredString('id', suggestion);
  if (id === null || name === null) return id;
  const expected = screenIdOf(name);
  if (id === expected) return id;
  reporter.error(
    'id',
    `id が name(${name})から導かれる ID と一致しません`,
    `id: ${expected} に直す(id は name と 1 対 1 に対応する)`,
    { expected, actual: id },
  );
  return id;
}

/**
 * route を読む。
 *
 * ここでは「書かれていること」だけを見る。表記が URL の形かどうかは S1 が見る
 * (形式違反で仕様全体を捨てると、同じファイルの他の指摘まで消えるため)。
 */
function parseRoute(root: YamlReader): string | null {
  return root.requiredString('route', ROUTE_SUGGESTION);
}

/**
 * 置き場が `screens/{group}/{name}.md` になっているかを見る。
 *
 * ファイル名と `name` を一致させるのは、testid のスロットパス(`{name}.body.center.…`)から
 * 仕様ファイルを引けるようにするためである。グループ名は画面の束ね方(業務のまとまり)であり、
 * 集約名とは一致しなくてよい(1 画面が複数の集約を読むため)。
 */
function checkPlacement(name: string, relPath: string, reporter: SpecReporter): void {
  const segments = relPath.split('/');
  if (segments.length !== 2) {
    reporter.error(
      'name',
      `screen_spec の置き場(${relPath})が screens/{group}/{name}.md ではありません`,
      `ファイルを {group}/${name}.md に移す(ディレクトリは 1 段。グループの中をさらに分けない)`,
      { expected: `{group}/${name}.md`, actual: relPath },
    );
    return;
  }
  const base = segments[1] ?? '';
  if (base === `${name}.md`) return;
  reporter.error(
    'name',
    `ファイル名 ${base} が name(${name})と一致しません`,
    `ファイルを ${segments[0] ?? ''}/${name}.md にリネームするか、name を ${base.replace(/\.md$/, '')} に直す`,
    { expected: `${name}.md`, actual: base },
  );
}
