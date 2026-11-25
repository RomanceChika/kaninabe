/**
 * S1 ルートの一意性と形式のチェック。
 *
 * screen-spec-writing.md の S1:「`route` が URL の形(動的セグメントは `:param`)であり、`route` と `name` が
 * 全 screen_spec を通じて重複しない」。
 *
 * `route` が重複すると「この URL はどの画面か」が決まらず、遷移先の宣言も screenTest の
 * 経路特定も一意にならない。`name` の重複はスロットパス(testid の先頭)の衝突であり、
 * 「どの画面の body.center か」が区別できなくなる。
 *
 * **実ルート(app/src/app/)との突合は v1 では行わない**(既知の穴)。ファイルシステム上の
 * ルート表現を読む器が要り、それは screenTest 側の経路特定と同じ道具になるため、
 * Phase C-2 でまとめて設計する。
 */

import type { Finding, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import { DYNAMIC_SEGMENT, STATIC_SEGMENT } from '../../model/screen/route-syntax.js';
import type { ScreenSpec } from '../../model/screen/types.js';

/** 旧い記法(角括弧)を含むセグメント。 */
const BRACKET_SEGMENT = /[[\]]/;

const ROUTE_SUGGESTION =
  'route を URL の形で書く(例: / , /workshops , /workshops/:id)。' +
  '動的セグメントは :param の形でセグメント全体にし(/x/pre:id や /x/:id-:other は不可)、同じ route の中で名前を重ねず、末尾にスラッシュを付けない';

const BRACKET_SUGGESTION =
  'route の動的セグメントは :param で書く(例: /workshops/[id] は /workshops/:id に書き直す)。' +
  '角括弧の記法はファイルの置き場の表記で、仕様には書かない(置き場への写像は後段が持つ)。キャッチオール([...x] / [[...x]])は文法に無い';

/** S1: route の形式と、route / name の一意性を検証する。 */
export const routeVerifier: ScreenVerifier = {
  id: 'S1',
  title: 'ルート — 表記が URL の形(動的セグメントは :param)で、route と name が全画面を通じて重複しない',

  verify(input): Finding[] {
    const screens = input.screens.screens;
    return [
      ...screens.flatMap(checkFormat),
      ...checkKey(screens, 'route', (screen) => screen.route),
      ...checkKey(screens, 'name', (screen) => screen.name),
    ];
  },
};

/** route が URL の形かを見る。 */
function checkFormat(screen: ScreenSpec): Finding[] {
  const problem = routeProblem(screen.route);
  if (problem === null) return [];
  return [
    screenFinding('S1', {
      message: `route ${screen.route} が URL の形ではありません(${problem.reason})`,
      location: { file: screen.location.file, pointer: 'route' },
      suggestion: problem.legacy ? BRACKET_SUGGESTION : ROUTE_SUGGESTION,
      counterexample: { screen: screen.name, route: screen.route },
    }),
  ];
}

/** route の形の問題(無ければ null)。`legacy` は旧い角括弧の記法を含むことを表す。 */
function routeProblem(route: string): { readonly reason: string; readonly legacy: boolean } | null {
  if (route === '/') return null;
  if (!route.startsWith('/') || route.endsWith('/')) return { reason: '先頭は / で、末尾に / を付けない', legacy: false };
  const segments = route.slice(1).split('/');
  const brackets = segments.filter((segment) => BRACKET_SEGMENT.test(segment));
  if (brackets.length > 0) {
    const mixed = segments.some((segment) => DYNAMIC_SEGMENT.test(segment));
    return { reason: mixed ? '`:param` と角括弧の記法が混在している' : '角括弧の記法は仕様に書かない。:param に書き直す', legacy: true };
  }
  const names = new Set<string>();
  for (const segment of segments) {
    if (STATIC_SEGMENT.test(segment)) continue;
    if (segment === ':') return { reason: '動的セグメントの名前が空', legacy: false };
    const name = DYNAMIC_SEGMENT.exec(segment)?.[1];
    if (name === undefined) return { reason: `セグメント ${segment || '(空)'} は静的(小文字・数字・- ・_)でも :param でもない`, legacy: false };
    if (names.has(name)) return { reason: `動的セグメントの名前 :${name} が重複している`, legacy: false };
    names.add(name);
  }
  return null;
}

/**
 * 1 つのキーについて重複を検出する。
 *
 * @param screens 全 screen_spec
 * @param key キー名(メッセージ用)
 * @param keyOf そのキーの値を取り出す関数
 */
function checkKey(
  screens: readonly ScreenSpec[],
  key: string,
  keyOf: (screen: ScreenSpec) => string,
): Finding[] {
  const seen = new Map<string, ScreenSpec>();
  const findings: Finding[] = [];
  for (const screen of screens) {
    const value = keyOf(screen);
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, screen);
      continue;
    }
    findings.push(duplicateFinding(screen, first, key, value));
  }
  return findings;
}

/** 同じ route / name を持つ screen_spec が 2 つ以上ある。 */
function duplicateFinding(
  screen: ScreenSpec,
  first: ScreenSpec,
  key: string,
  value: string,
): Finding {
  return screenFinding('S1', {
    message: `${key} ${value} が複数の screen_spec で使われています`,
    location: { file: screen.location.file, pointer: key },
    suggestion:
      key === 'route'
        ? `1 つの URL に 2 つの画面は置けない。どちらかの route を変えるか、2 つを 1 画面にまとめる(先行: ${first.location.file})`
        : `name はスロットパス(testid)の先頭になるので重複できない。どちらかの name と id を変える(先行: ${first.location.file})`,
    counterexample: { [key]: value, first: first.location.file, duplicate: screen.location.file },
  });
}
