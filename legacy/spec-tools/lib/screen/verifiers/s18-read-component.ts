/**
 * S18 **読みを載せる部品の宣言**(`kind: table` / `detail` の `reads` / `shows`、`kind: form` の `reads`)の検査。
 *
 * ADR-0015(束 画面 3a の改訂)の要求: `layout` の部品に `kind: table`(読むだけの表。`returns: many` の読み)・
 * `kind: detail`(詳細。`returns: one` の読み)を `reads` / `shows` と書くと、その部品は生成物になる。
 * `kind: form` の `reads` は、参照の欄の選択肢の出どころ(`[id, 表示名]` の 2 欄の読み)である。書いてよいのは次の形だけ。
 *   (a) `reads` の読みが種類に合う: table は `returns: many`・detail は `one`・form は `many` で projection が
 *       `[id, 表示名の 1 欄]`(選択肢の形)
 *   (b) `reads` がその画面の `reads` の要素である(画面が読むと宣言した経路だけを部品が出せる)
 *   (c) `shows` の欄が、読みの projection か 1 件に決まる併読の欄に実在し、ref の欄でない
 *   (d) `kind: form` の `reads` の source が、載せる操作の入力に居る ref の欄の参照先と一致する
 *       (一致する欄が無ければ error・2 欄以上なら曖昧で error)
 *   (e) 同じ読みを複数の table / detail 部品が出すのは可(`shows` が違う — 検査しない)
 *   (e2) `kind: form` の `reads` の表示名(第 2 列)は、source の集約が `display_field` を宣言していればその欄である
 *       (宣言が無い集約は従来どおり第 2 列を問わない)
 *   (f) `kind: table` を持つ画面は `states.requires` に `empty` を宣言する(生成の表は空の葉を必ず出す)
 * 加えて chrome の table / detail 部品には書けない(chrome は読みを持たない外枠)。
 *
 * `reads` / `shows` の**形**(組になっているか・その kind に書ける属性か)はパーサー(S0)が見る。実在しない読みは
 * S2 の領分なのでここでは黙る(1 つの書き間違いに 2 つの指摘を出さない)。(f) の向きについて: 手書きの表が
 * 空状態を自前で持つ画面が `empty` を宣言するのは正当なので、「`empty` があるなら生成の表が要る」(逆向き)は
 * 見ない — 生成の表が出す空の葉を宣言が覆うことだけを要求する。判定の文面は `lib/messages/messages-screen-read.ts`。
 */

import { readComponentProblemWords } from '../../messages/messages-screen-read.js';
import type { ReadComponentProblem } from '../../messages/messages-screen-read.js';
import type { QuerySpec } from '../../model/query/types.js';
import { findField } from '../../semantics/domain-index.js';
import { findDisplayField } from '../../semantics/entity-display.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import { isRefField, showCandidates } from '../read-shows.js';
import type { LayoutComponent, ScreenInput, ScreenLayout, ScreenSpec } from '../../model/screen/types.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { foreignBlocked, screenFinding } from '../verifier.js';

/** S18 の実装。 */
export const readComponentVerifier: ScreenVerifier = {
  id: 'S18',
  title: '読みを載せる部品 — kind: table / detail の reads と shows、kind: form の参照欄の選択肢の読みが、画面の reads と仕様に接地する',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const findings: Finding[] = [];
    for (const chrome of input.screens.chromes) {
      for (const component of components(chrome.layout)) {
        if (component.kind !== 'table' && component.kind !== 'detail') continue;
        findings.push(
          finding(
            { kind: 'in_chrome', chrome: chrome.name, component: component.name, part: component.kind },
            component.location,
          ),
        );
      }
    }
    if (!input.queries.available || foreignBlocked(ctx, 'queries')) return findings; // query_spec が阻害なら読みの形の突合は言わない(行は呼び手が言う)
    for (const screen of input.screens.screens) findings.push(...checkScreen(screen, input, ctx));
    return findings;
  },
};

/** レイアウトの部品(入れ子を含む。宣言順)。 */
function components(layout: ScreenLayout): readonly LayoutComponent[] {
  return layout.slots.flatMap((slot) => slot.components);
}

/** 画面 1 枚の読みを載せる部品を、宣言順(画面の layout → 重ね表示)に見る。 */
function checkScreen(screen: ScreenSpec, input: ScreenInput, ctx: ScreenContext): Finding[] {
  const findings: Finding[] = [];
  const all = [screen.layout, ...screen.overlays.map((overlay) => overlay.layout)].flatMap(components);
  for (const component of all) {
    if (component.readRef === undefined) continue;
    findings.push(...checkComponent(screen, component, input, ctx));
  }
  const tables = all.filter((component) => component.kind === 'table').map((component) => component.name);
  if (tables.length > 0 && !screen.requiredStates.includes('empty')) {
    findings.push(finding({ kind: 'empty_undeclared', screen: screen.name, tables }, screen.location));
  }
  return findings;
}

/** 読みを持つ部品 1 つの書き間違い(最初に当たった段の分だけ返す)。 */
function checkComponent(
  screen: ScreenSpec,
  component: LayoutComponent,
  input: ScreenInput,
  ctx: ScreenContext,
): Finding[] {
  const part = component.kind;
  const ref = component.readRef;
  // `kind: actions` の読み(画面の reads の要素か・returns: one か)は S19 が見る。プラットフォーム操作の部品は query_spec を読まない(S20)。
  if (part === undefined || part === 'actions' || part === 'platform_read' || part === 'platform_actions' || ref === undefined) return [];
  const base = { screen: screen.name, component: component.name };
  const declared = screen.reads.map((read) => read.id);
  if (!declared.includes(ref.id)) {
    return [finding({ kind: 'not_in_reads', ...base, part, read: ref.id, declared }, ref.location)];
  }
  const query = input.queries.queries.find((candidate) => candidate.id === ref.id);
  // 実在しない読みは S2 の領分。
  if (query === undefined) return [];
  const expected = part === 'detail' ? 'one' : 'many';
  if (query.returns !== expected) {
    return [finding({ kind: 'wrong_returns', ...base, part, read: ref.id, returns: query.returns }, ref.location)];
  }
  if (part === 'form') return checkOptions(screen, component, query, input, ctx);
  return checkShows(screen, component, query, input);
}

/** `kind: form` の `reads`(選択肢の読み)を見る: 選択肢の形・操作の入力の ref の欄との一致。 */
function checkOptions(
  screen: ScreenSpec,
  component: LayoutComponent,
  query: QuerySpec,
  input: ScreenInput,
  ctx: ScreenContext,
): Finding[] {
  const base = { screen: screen.name, component: component.name, read: query.id };
  const names = query.projection.map((field) => field.name);
  if (names.length !== 2 || names[0] !== 'id') {
    return [finding({ kind: 'not_options', ...base, projection: names }, component.readRef?.location ?? component.location)];
  }
  const displayField = findDisplayField(input.domain, query.source);
  const label = names[1];
  if (displayField !== undefined && label !== undefined && label !== displayField) {
    return [
      finding(
        { kind: 'options_label', ...base, source: query.source, label, displayField },
        component.readRef?.location ?? component.location,
      ),
    ];
  }
  const id = component.actionRefs?.[0]?.id;
  if (id === undefined) return [];
  const action = canonicalActionId(input.domain, id) ?? id;
  const inputs = ctx.operationInputs.get(action) ?? ctx.operationInputs.get(id);
  // action_spec を読めない操作の入力は分からない(S2 / A 群の領分)。
  if (inputs === undefined) return [];
  const fields = inputs
    .filter((item) => {
      const type = findField(input.domain, item.entity, item.field)?.type;
      return type?.kind === 'ref' && type.entity === query.source;
    })
    .map((item) => item.field);
  const problem: ReadComponentProblem | null =
    fields.length === 0
      ? { kind: 'no_ref', ...base, action, source: query.source }
      : fields.length > 1
        ? { kind: 'ambiguous_ref', ...base, action, source: query.source, fields }
        : null;
  return problem === null ? [] : [finding(problem, component.readRef?.location ?? component.location)];
}

/** `kind: table` / `detail` の `shows` を見る: 欄の実在と ref でないこと。 */
function checkShows(
  screen: ScreenSpec,
  component: LayoutComponent,
  query: QuerySpec,
  input: ScreenInput,
): Finding[] {
  const candidates = showCandidates(query, input.domain);
  const findings: Finding[] = [];
  for (const show of component.showRefs ?? []) {
    const found = candidates.find((candidate) => candidate.path === show.id);
    const base = { screen: screen.name, component: component.name, read: query.id, show: show.id };
    if (found === undefined) {
      findings.push(
        finding({ kind: 'unknown_show', ...base, candidates: candidates.map((item) => item.path) }, show.location),
      );
    } else if (isRefField(input.domain, found)) {
      findings.push(finding({ kind: 'ref_show', ...base }, show.location));
    }
  }
  return findings;
}

/** 書き間違い 1 つを指摘にする(反例は事実そのもの。一覧は読点でつなぐ)。 */
function finding(problem: ReadComponentProblem, location: Finding['location']): Finding {
  const words = readComponentProblemWords(problem);
  const facts = Object.entries(problem)
    .filter(([key]) => key !== 'kind')
    .map(([key, value]): [string, string] => [key, Array.isArray(value) ? value.join(', ') : String(value)]);
  return screenFinding('S18', {
    message: words.message,
    location,
    suggestion: words.suggestion,
    counterexample: Object.fromEntries(facts),
  });
}
