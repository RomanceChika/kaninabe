/**
 * screen_spec の各節(参照リスト・遷移・重ね表示・入場条件・表示義務)のパーサー。
 *
 * 本体(parse-screen.ts)を「フロントマターの骨格を読む」役に保つため、節ごとの読み取りはここに置く。
 * `smoke:` の節は parse-screen-smoke.ts が読む(責務としてはここと同じ「1 節の読み取り」)。
 * ファイル I/O は行わない(規約: scripts-code-quality.md)。
 * ここが担うのは S0(スキーマ適合)だけで、参照先の実在は S2 / S5 が見る。
 */

import { asArray, asRecord, type SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseLayout } from './parse-layout.js';
import {
  isRequiredState,
  REQUIRED_STATES,
  type RequiredState,
  type ScreenNavigation,
  type ScreenOnFail,
  type ScreenOverlay,
  type ScreenPrecondition,
  type ScreenRef,
} from './types.js';

/** `redirect({screen id})` の形。行き先は screen_spec の id。 */
const ON_FAIL = /^redirect\(([a-z][a-z0-9-]*)\)$/;

/** 重ね表示の id(snake_case)。 */
const OVERLAY_ID = /^[a-z][a-z0-9_]*$/;

const ON_FAIL_SUGGESTION =
  'on_fail を "redirect({画面 id})"(例: redirect(screen-login))形式で書く。' +
  '入場条件が成立しない人をどこへ送るかは仕様の関心であり、実装の裁量に落とさない';

const NAVIGATIONS_SUGGESTION =
  'navigations に "- on: {きっかけ} / to: {画面 id}" を並べる' +
  '(on は "{イベント ID}.success" か UI 都合の自由語彙)';

/** 画面と重ね表示の `platform_ops` の書き方の案内。 */
export const PLATFORM_OPS_SUGGESTION =
  'platform_ops にこの画面が露出するプラットフォーム操作の id を並べる(例: session.end_mine)。' +
  'auth_spec の platform_ops に宣言した、ドメインイベントでない認証基盤の操作である(actions と並ぶ第 3 の口)';

const OVERLAYS_SUGGESTION =
  'overlays に "- id / layout" を持つ要素を並べる(opened_by / actions / closes_on は任意)';

/**
 * 参照 ID のリスト(`reads` / `actions`)を、要素ごとの位置つきで読む。
 *
 * 位置を要素まで持つのは、実在検査(S2)の指摘が「どの行を直すか」まで示せるようにするため。
 *
 * @param value 生の値(未記入なら undefined)
 * @param pointer この節の YAML パス(例: "reads" / "overlays[0].actions")
 * @param suggestion 形式違反のときの修正案
 * @param reporter 違反の記録先
 * @returns 読めた参照(未記入なら空配列)
 */
export function parseRefList(
  value: unknown,
  pointer: string,
  suggestion: string,
  reporter: SpecReporter,
): readonly ScreenRef[] {
  if (value === undefined || value === null) return [];
  const items = asArray(value);
  if (items === null) {
    reporter.error(pointer, `${pointer} はリストで書きます`, suggestion, { value: String(value) });
    return [];
  }
  const refs: ScreenRef[] = [];
  items.forEach((item, index) => {
    const at = `${pointer}[${index}]`;
    if (typeof item !== 'string') {
      reporter.error(at, `${at} は文字列で書きます`, suggestion, { value: String(item) });
      return;
    }
    refs.push({ id: item, location: reporter.location(at) });
  });
  return refs;
}

/**
 * `navigations` を読む。
 *
 * @param root フロントマター全体の読み取り器
 * @param reporter 違反の記録先
 * @param forbidDots `on` にドットを許さない(chrome_spec のときに true)。
 *   共有クロームは操作を持たないので、`{イベント ID}.success` を書けるのは画面だけである
 * @returns 読めた遷移(未記入なら空配列)
 */
export function parseNavigations(
  root: YamlReader,
  reporter: SpecReporter,
  forbidDots = false,
): readonly ScreenNavigation[] {
  const items = root.optionalList('navigations', NAVIGATIONS_SUGGESTION);
  const navigations: ScreenNavigation[] = [];
  eachRecord(items, 'navigations', reporter, NAVIGATIONS_SUGGESTION, (reader, index) => {
    const at = `navigations[${index}]`;
    const on = reader.requiredString('on', NAVIGATIONS_SUGGESTION);
    const to = reader.requiredString('to', NAVIGATIONS_SUGGESTION);
    if (on === null || to === null) return;
    if (forbidDots && on.includes('.')) {
      reporter.error(
        `${at}.on`,
        `chrome_spec の on に "${on}" は書けません(操作の結果は書けない)`,
        'on はドットを含まない自由語彙(例: signed_out)にする。' +
          '"{イベント ID}.success" を書けるのは、その操作を actions に宣言している画面だけ',
        { on },
      );
      return;
    }
    navigations.push({ on, to, location: reporter.location(at) });
  });
  return navigations;
}

/**
 * `overlays` を読む。
 *
 * @param root フロントマター全体の読み取り器
 * @param reporter 違反の記録先
 * @returns 読めた重ね表示(未記入なら空配列)
 */
export function parseOverlays(root: YamlReader, reporter: SpecReporter): readonly ScreenOverlay[] {
  const items = root.optionalList('overlays', OVERLAYS_SUGGESTION);
  const overlays: ScreenOverlay[] = [];
  eachRecord(items, 'overlays', reporter, OVERLAYS_SUGGESTION, (reader, index) => {
    const overlay = readOverlay(reader, `overlays[${index}]`, reporter);
    if (overlay !== null) overlays.push(overlay);
  });
  return overlays;
}

/** overlays の 1 要素を読む。id が読めない要素は捨てる(位置を示せないため)。 */
function readOverlay(reader: YamlReader, at: string, reporter: SpecReporter): ScreenOverlay | null {
  const id = reader.requiredString('id', 'id に重ね表示の名前を snake_case で書く');
  if (id === null) return null;
  if (!OVERLAY_ID.test(id)) {
    reporter.error(
      `${at}.id`,
      `overlays の id ${id} が snake_case ではありません`,
      'id を report_dialog のように snake_case で書く',
      { id },
    );
    return null;
  }
  const openedBy = reader.optionalString('opened_by', 'opened_by に、これを開くコンポーネント名を書く');
  const label = reader.optionalString('label', 'label に確認の見出し(確認の文言と実行ボタンの文言)を書く');
  const actions = parseRefList(
    reader.raw('actions'),
    `${at}.actions`,
    'actions にこの重ね表示が発火するドメインイベント ID を並べる',
    reporter,
  );
  const platformOps = parseRefList(reader.raw('platform_ops'), `${at}.platform_ops`, PLATFORM_OPS_SUGGESTION, reporter);
  // 操作を発火する重ね表示には、それを開く口が必ず要る。開けない重ね表示の中のボタンは
  // 「UI 到達がある」と S10 に数えられながら、実際には誰も押せない —
  // 免除(unexposed)を書かずに網羅検査を黙らせる抜け道になる。
  // 表示だけの重ね表示(actions が空)は opened_by 無しでも意味を持つので、そちらは任意のまま。
  if (actions.length + platformOps.length > 0 && openedBy === undefined) {
    reporter.error(
      `${at}.opened_by`,
      `overlays の ${id} は操作を発火しますが opened_by がありません`,
      'これを開く部品の名前を opened_by に書く(実在は S2 が見る)。' +
        '開く口の無い重ね表示のボタンは、UI 到達として数えられるのに誰も押せない',
      { overlay: id, actions: [...actions, ...platformOps].map((action) => action.id).join(', ') },
    );
  }
  return {
    id,
    layout: parseLayout(reader.raw('layout'), `${at}.layout`, reporter),
    ...(openedBy === undefined ? {} : { openedBy }),
    ...(label === undefined ? {} : { label }),
    actions,
    platformOps,
    closesOn: reader.optionalStringList('closes_on', 'closes_on に閉じるきっかけを並べる'),
    location: reporter.location(at),
  };
}

/**
 * `precondition` と `on_fail` を読む。
 *
 * 3 つを同時に見る:
 * - 入場条件を書いたのに行き先が無い(成立しない人がどうなるか未定義)
 * - 行き先だけを書いた(意味を持たない宣言)
 * - **`subject` が無いのに入場条件を書いた**(式のパスを解決する起点が無い)
 *
 * 式の文法・パスの接地・行き先の実在は S5 が見る。
 *
 * @param root フロントマター全体の読み取り器
 * @param hasSubject `subject` が宣言されているか
 * @param reporter 違反の記録先
 * @returns 入場条件と行き先。どちらも未記入なら両方 null
 */
export function parsePrecondition(
  root: YamlReader,
  hasSubject: boolean,
  reporter: SpecReporter,
): { precondition: ScreenPrecondition | null; onFail: ScreenOnFail | null } {
  const source = root.optionalString(
    'precondition',
    '入場条件をガード式の文法で書く(例: workshop.state == closed)',
  );
  const rawOnFail = root.optionalString('on_fail', ON_FAIL_SUGGESTION);
  if (source === undefined) {
    if (rawOnFail !== undefined) {
      reporter.error(
        'on_fail',
        'precondition が無いのに on_fail があります',
        'precondition を書くか、on_fail を消す(行き先だけの宣言は意味を持たない)',
      );
    }
    return { precondition: null, onFail: null };
  }

  if (!hasSubject) {
    reporter.error(
      'precondition',
      'subject が無い画面に precondition は書けません',
      'route の動的セグメントが指すエンティティを subject に書く(例: subject: workshop)。' +
        'ログインの要否を表したいだけなら requires_auth: true を使う' +
        '(セッションの有無はドメインのパスでは表せない)',
      { precondition: source },
    );
  }

  const precondition: ScreenPrecondition = { source, location: reporter.location('precondition') };
  return { precondition, onFail: readOnFail(rawOnFail, reporter) };
}

/** `on_fail` を `redirect({画面 id})` として読む。 */
function readOnFail(raw: string | undefined, reporter: SpecReporter): ScreenOnFail | null {
  if (raw === undefined) {
    reporter.error('on_fail', 'precondition があるのに on_fail がありません', ON_FAIL_SUGGESTION);
    return null;
  }
  const screen = ON_FAIL.exec(raw)?.[1];
  if (screen === undefined) {
    reporter.error(
      'on_fail',
      `on_fail ${raw} が "redirect({画面 id})" の形式ではありません`,
      ON_FAIL_SUGGESTION,
      { on_fail: raw },
    );
    return null;
  }
  return { raw, screen, location: reporter.location('on_fail') };
}

/**
 * `states.requires`(表示義務)を値域として読む。
 *
 * @param root フロントマター全体の読み取り器
 * @param reporter 違反の記録先
 * @returns 読めた表示義務(未記入なら空配列)
 */
export function parseRequiredStates(
  root: YamlReader,
  reporter: SpecReporter,
): readonly RequiredState[] {
  const suggestion = `states.requires に ${REQUIRED_STATES.join(' / ')} から必要なものを並べる`;
  const raw = root.raw('states');
  if (raw === undefined || raw === null) return [];
  const record = asRecord(raw);
  if (record === null) {
    reporter.error('states', 'states はマッピングで書きます', suggestion, { value: String(raw) });
    return [];
  }

  const reader = new YamlReader(record, 'states', reporter);
  const found: RequiredState[] = [];
  for (const value of reader.optionalStringList('requires', suggestion)) {
    if (isRequiredState(value)) {
      found.push(value);
      continue;
    }
    reporter.error(
      'states.requires',
      `states.requires の ${value} は表示義務の語彙ではありません`,
      suggestion,
      { actual: value, allowed: REQUIRED_STATES.join(', ') },
    );
  }
  return found;
}
