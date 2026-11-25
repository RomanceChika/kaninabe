/**
 * S5 入場条件のチェック。
 *
 * screen-spec-writing.md の S5:「`subject` が entity_spec に実在し、`precondition` が
 * ガード式として妥当で、**式のパスが subject を起点に接地し**、`on_fail` の行き先が
 * 実在する画面である(自分自身へ・互いに送り返す閉路を作らない)」。
 *
 * 入場条件はロールでは説明できないアクセス制御(「編成中の催しでだけ並べ替え画面に入れる」
 * 「開始 10 分前から会場に入れる」)を表す。ドメインのガードと**同じ文法・同じパーサー・
 * 同じ解決規則**を使うのは、表現力を 1 つに保つためである(ADR-0003)。
 *
 * パスの接地を要求するのが v1 の要である。文法だけを見ると、ドメインのどこにも存在しない
 * パス(`actor.role` のような)を書いた仕様が検証を通り抜け、「評価器が評価できない条件」が
 * 仕様に住みついてしまう。セッションの有無は `requires_auth` が表すので、
 * 入場条件がドメインのパスだけを見ればよくなり、接地を必須にできる。
 * `actor` の後ろに書けるのが `id` と **`session: true` を宣言した欄**だけであることも
 * 同じ解決規則(lib/model/path-resolve.ts)が見る ── ここに同じ判定を重ねると、
 * 1 つの綴り違いに 2 つのエラーが並ぶ。
 */

import type { SpecModel } from '../../model/types.js';
import { placementHint } from '../../guard/placement.js';
import { resolveEntityPath } from '../../model/path-resolve.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import type { ScreenInput, ScreenSpec } from '../../model/screen/types.js';
import { indexScreens } from '../../model/screen/lookup.js';

/** S5: subject の実在・precondition の文法と接地・on_fail の行き先を検証する。 */
export const preconditionVerifier: ScreenVerifier = {
  id: 'S5',
  title: '入場条件 — subject に接地したガード式で、on_fail の行き先が実在する',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const screens = indexScreens(input.screens);
    const findings = input.screens.screens.flatMap((screen) => [
      ...checkSubject(screen, input.domain),
      ...checkPrecondition(screen, input.domain, ctx),
      ...checkOnFail(screen, screens),
    ]);
    return [...findings, ...checkCycles(input.screens.screens, screens)];
  },
};

/** subject が entity_spec に実在するか。 */
function checkSubject(screen: ScreenSpec, domain: SpecModel): Finding[] {
  const subject = screen.subject;
  if (subject === undefined || findEntitySpec(domain, subject.entity) !== null) return [];
  return [
    screenFinding('S5', {
      message: `subject の ${subject.entity} に対応する entity_spec がありません`,
      location: subject.location,
      suggestion:
        `specs/domain/${subject.entity}/entity.md を作るか、実在するエンティティ名に直す` +
        '(subject は precondition の式を解決する起点なので、実在しないと条件が何も指さない)',
      counterexample: { screen: screen.name, subject: subject.entity },
    }),
  ];
}

/** precondition がガード式としてパースでき、パスが subject に接地するか。 */
function checkPrecondition(
  screen: ScreenSpec,
  domain: SpecModel,
  ctx: ScreenContext,
): Finding[] {
  const precondition = screen.precondition;
  if (precondition === undefined) return [];
  const parsed = ctx.guards.parse(precondition.source);
  if (!parsed.ok) {
    return [
      screenFinding('S5', {
        message: `precondition の式を解析できません: ${parsed.error.message}`,
        location: precondition.location,
        suggestion:
          'ガード式の文法(比較 / in / contains を and・or・not でつなぐ形)に直す。' +
          '括弧・算術・関数呼び出しは書けない(domain-spec-writing.md §ガード式の文法)' +
          placementHint(parsed.error),
        counterexample: {
          screen: screen.name,
          precondition: precondition.source,
          offset: String(parsed.error.offset),
        },
      }),
    ];
  }

  // subject が無い場合は S0 がエラーにしているので、ここでは接地を問わない。
  const subject = screen.subject;
  if (subject === undefined) return [];
  const paths = ctx.guards.collectPaths(parsed.expr);
  return [
    ...paths
      .map((path) => ({ path, resolved: resolveEntityPath(domain, subject.entity, path, 'subject') }))
      .filter((entry) => entry.resolved.kind === 'error')
      .map((entry) =>
      screenFinding('S5', {
        message:
          `precondition の ${entry.path.segments.join('.')} を解決できません: ` +
          (entry.resolved.kind === 'error' ? entry.resolved.reason : ''),
        location: precondition.location,
        suggestion:
          `subject(${subject.entity})のフィールドか、その entity_spec の context で辿れるパス、` +
          'または予約語 actor / now の範囲で書く。' +
          'ログインの要否を表したいなら requires_auth: true を使う(セッションはドメインのパスではない)',
        counterexample: {
          screen: screen.name,
          precondition: precondition.source,
          path: entry.path.segments.join('.'),
        },
      }),
    ),
  ];
}

/** on_fail の行き先が実在する画面か。 */
function checkOnFail(screen: ScreenSpec, screens: ReadonlyMap<string, ScreenSpec>): Finding[] {
  const onFail = screen.onFail;
  if (onFail === undefined || screens.has(onFail.screen)) return [];
  return [
    screenFinding('S5', {
      message: `on_fail の行き先 ${onFail.screen} に対応する画面がありません`,
      location: onFail.location,
      suggestion:
        `specs/frontend/screens/{group}/{name}.md を作って id: ${onFail.screen} を宣言するか、実在する画面 id に直す`,
      counterexample: { screen: screen.name, on_fail: onFail.raw },
    }),
  ];
}

/**
 * `on_fail` を辿った閉路を検出する。
 *
 * 自分自身へ送り返すのは長さ 1 の閉路であり、2 画面が互いに送り返すのも同じ事故
 * (入場条件に弾かれた人が永久に往復する)である。片方だけを見ると、
 * 「1 枚挟めば通る」という抜け道が残るので、閉路として一般化して見る。
 */
function checkCycles(
  screens: readonly ScreenSpec[],
  byId: ReadonlyMap<string, ScreenSpec>,
): Finding[] {
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (const start of screens) {
    const path: string[] = [];
    let current: ScreenSpec | undefined = start;
    while (current !== undefined) {
      if (path.includes(current.id)) break;
      path.push(current.id);
      const next: string | undefined = current.onFail?.screen;
      if (next === undefined) break;
      if (next === start.id) {
        if (!reported.has(start.id)) {
          for (const id of path) reported.add(id);
          findings.push(cycleFinding(start, path));
        }
        break;
      }
      current = byId.get(next);
    }
  }
  return findings;
}

/** 閉路の指摘(経路を反例に載せる)。 */
function cycleFinding(screen: ScreenSpec, path: readonly string[]): Finding {
  const route = [...path, screen.id].join(' → ');
  return screenFinding('S5', {
    message:
      path.length === 1
        ? 'on_fail の行き先が自分自身です'
        : `on_fail の行き先が閉路になっています(${route})`,
    location: screen.onFail?.location ?? screen.location,
    suggestion:
      '入場条件に弾かれた人が永久に往復する。閉路のどこかを、' +
      '入場条件を持たない画面(またはその人が必ず入れる画面)へ向ける',
    counterexample: { screen: screen.name, route },
  });
}
