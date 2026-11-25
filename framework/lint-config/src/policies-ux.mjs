/**
 * 禁止する構文パターンのうち、**画面の見え方と文言**にかかるもの。
 *
 * `policies-syntax.mjs` が持つ構文の禁止のうち、こちらは画面の見え方と文言にかかる分である。
 * 入口は `policies.mjs`。
 */

/**
 * 実行器（`useActionRunner` / `ActionButton` / `ActionForm`）の `initialPhase` は
 * **プレビュー専用**（action-runner.md の `InitialPhase` の JSDoc）。ハンドブックの SSR
 * プレビュー（book-previews.md）が「送信中」「拒否の4分類」の断片を出すためだけの注入点で、
 * 本番の呼び側（`app/src/app/__screens__/previews*` 以外）が渡すと、実際には起きていない
 * pending / 拒否を初期状態として見せられる状態になってしまう。
 *
 * 対象は `src/app/**` の JSX 属性(`<ActionButton initialPhase={...}>`)とオブジェクトの
 * プロパティ(`useActionRunner(action, { initialPhase: ... })`)の両方。
 */
export const PREVIEW_ONLY_RESTRICTED_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='initialPhase']",
    message:
      "initialPhase はプレビュー専用（action-runner.md）。本番の呼び側では渡せない——渡せるのは app/src/app/__screens__/previews* だけ。",
  },
  {
    selector: "Property[key.name='initialPhase']",
    message:
      "initialPhase はプレビュー専用（action-runner.md）。本番の呼び側では渡せない——渡せるのは app/src/app/__screens__/previews* だけ。",
  },
];

/**
 * 確認の要否・見た目（確認のキーと `variant`）は導出する ―― `src/app/**` に手書きさせない（S6）。
 *
 * `ActionButton` はこの 2 つを props に持たない（生成物 `@/domain/generated/action-attributes`
 * から `confirmRequired` / `variant` を引く。action-spec-writing.md「方針の導出」）ため、
 * TypeScript 自体が余分な prop を落とすが、それだけでは「別の部品が同じ名前の prop を
 * 独自に発明する」「設定オブジェクトに同じ 2 つのキーを持たせる」という
 * 回り道を防げない。口ごと塞ぐことで、視覚的な強さ（danger）と確認の要否が
 * 常に導出結果と一致することを保つ（G4 の `style` 属性禁止と同じ考え方）。
 *
 * 対象は主に JSX 属性(例: `<ActionButton variant="danger" confirm={{...}}>` の形)。
 * `confirmDialogTestId` / `confirmBarTestId`(screen_spec の overlay testid の配線)は
 * 対象外 —— 塞ぐのは「確認するかどうか・どう見せるか」の判断であって、testid の配線ではない。
 *
 * オブジェクトのプロパティは `variant` だけを見る(例: `Property[key.name='confirm']` は
 * 足さない —— 確認のキーはこの製品の実在するドメインイベント ID
 * (例: `entry.confirm`。その集約の状態機械の遷移)でもあり、画面の部品の
 * 例: `ACTIONS = { confirm: null, ... }` のような**発火表のキー**として正当に使われている。
 * そこまで塞ぐと実在する語彙を書けなくなるため、JSX 属性の禁止だけに絞る)。
 */
export const ACTION_POLICY_RESTRICTED_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='variant']",
    message:
      "variant は書けない（action-spec-writing.md「方針の導出」）。ActionButton は生成物 action-attributes から見た目（danger / default）を引く。",
  },
  {
    selector: "JSXAttribute[name.name='confirm']",
    message:
      "confirm は書けない（action-spec-writing.md「方針の導出」）。ActionButton は生成物 action-attributes から確認の要否・文言を引く。testid の配線は confirmDialogTestId / confirmBarTestId を使う。",
  },
  {
    selector: "Property[key.name='variant']",
    message:
      "variant は書けない（action-spec-writing.md「方針の導出」）。見た目は生成物 action-attributes から引く。",
  },
];

/**
 * 遷移先の href（`src/app/**`）の文字列リテラル直書きを禁止する。
 *
 * 発端: ヘッダの特権ユーザ向けリンク 6 本が `href="/admin/{表}"` のように手書きされており、
 * 行き先の画面が `for: [{ロール}]` を宣言していても誰にでも見えていた（押すと `requireStaff()` で
 * not found になるので安全上の穴ではないが、「遷移の表示条件 = 行き先の入場条件」という
 * 原則がリンクには効いていなかった。docs/rules/.../conventions/navigation.md）。
 *
 * 口を塞ぐことで、遷移先は必ず生成物 `@/domain/generated/screens` の `screenRoutes` 経由
 * （`NavLink`(`@/components/nav-link`)か、`href={screenRoutes.x.route}` / `screenPath(...)`）
 * になる。前者は行き先の入場条件（`NAVIGATION_VISIBILITY`）まで見て出し分けるが、
 * 後者（関門の無い画面への遷移）はリンク切れ防止だけが目的で出し分けはしない——
 * どちらも「route の文字列を手で書かない」という 1 点で揃っている。
 *
 * testid の直書き禁止（`TESTID_RESTRICTED_SYNTAX`）と同じ理由・同じ形（骨格を仕様の生成物
 * からしか作れないようにする）。`href` に限るのは、外部 URL（`{集約}.{欄}` 等）や
 * ページ内アンカーは変数経由で渡るため Literal を書かず、この禁止の対象にならないため。
 */
export const LINK_RESTRICTED_SYNTAX = [
  {
    selector: "JSXAttribute[name.name='href'] > Literal[value=/^\\//]",
    message:
      "href に「/」で始まる文字列を直書きするのは禁止。遷移先は screen_spec の route が正であり、生成物 @/domain/generated/screens の screenRoutes 経由（NavLink か screenPath(screenRoutes.x.route, …)）で組み立てる（docs/rules/process/frontend/system/standards/conventions/navigation.md）。",
  },
  {
    selector:
      "JSXAttribute[name.name='href'] > JSXExpressionContainer > TemplateLiteral[quasis.0.value.raw=/^\\//]",
    message:
      "href のテンプレート literal を「/」で始まる手書きの文字列にするのは禁止（式で包んでも同じ）。骨格は生成物 screenRoutes から取り、動的セグメントは screenPath(screenRoutes.x.route, …) で埋める。",
  },
];

/**
 * 拒否（`ActionError`）の分類名(`invalid_input` / `guard_unsatisfied` / `forbidden` /
 * `invariant_violated`)を、機械の言葉のまま見出し・本文に出すのを禁止する(U11)。
 *
 * 正は wording.md。文言の出どころは 3 つ(`otherwise_forbidden` / ロールの `label` /
 * `entity_spec` の欄の `label` / `statement`)しか無く、分類名そのものは追跡用の ID であって
 * 人向けの文言ではない(cognitive-load.md §2 ⑧「言葉」——旧: `guard_unsatisfied（この操作は
 * 今は許されていません）` のように、機械の分類名が人向けの文の頭に居座っていた)。
 *
 * **狙うのは「分類名が長い文の中に埋め込まれている」形だけである。** 分類名と完全に一致する
 * リテラル(`{ kind: 'invalid_input', ... }` のような構築・`error.kind` での分岐 { case
 * 'guard_unsatisfied': ... }` のような分岐・テストの期待値の直書き)は正当な用途であり、
 * 塞ぐと `ActionError` そのものを組み立てられなくなる。`:not()` で完全一致を除外し、
 * 「分類名を含むがそれだけではない文字列」だけを禁止する。
 *
 * **除外がもう 2 つ要る**(どちらもユーザーに見せる文言ではなく、開発者向けの文字列):
 *   - `throw new Error('… invalid_input は起こり得ません …')` のような、「起こりえないはずの
 *     分岐に来た」ことを名指しでエラーにする診断メッセージ(`_screens/*.tsx` に多数実例がある。
 *     params を持たないクエリが `invalid_input` を返すのは配線が壊れているときだけ、という主旨)
 *     ——`new Error(...)` の引数リテラルを除外する。
 *   - `it('guard_unsatisfied: …', () => {})` / `describe(...)` のテスト説明文——分類名を
 *     テストの名前に使うのは(この束の `action-error-view.test.tsx` 自身がそうしているように)
 *     「どの分類のテストか」を書く正当な用途であり、UI の見出し・本文ではない。
 *
 *
 * **既知の穴**: `TemplateLiteral` の中(`` `${x}: invalid_input です` ``)や、`{error.kind}` を
 * JSX にそのまま出す形・JSX の地の文(`JSXText`。例: `<p>invalid_input: {...}</p>`)は
 * `Literal` ノードではないため検出しない(U4 と同じ限界。読み取り側の `QueryError` の
 * `invalid_input` 表示——`{集約}-detail.tsx` 等の `QueryIssues` 相当——がまさにこの JSXText の
 * 形で、この束(ADR-0011 ⑯d)は `ActionError` だけを対象にしているため未対応のまま残る)。
 * `data-error-kind` 属性の値は `{error.kind}`(式)であり、そもそも `Literal` に当たらないため
 * 対象外——ここが「唯一の例外」として仕様が認めている値である。
 */
const ERROR_KIND_WORDS = "invalid_input|guard_unsatisfied|forbidden|invariant_violated|temporarily_unavailable";
export const ERROR_KIND_RESTRICTED_SYNTAX = [
  {
    selector: `Literal[value=/${ERROR_KIND_WORDS}/]:not([value=/^(${ERROR_KIND_WORDS})$/]):not(NewExpression[callee.name='Error'] > Literal):not(CallExpression[callee.name=/^(it|test|describe)$/] > Literal:first-child)`,
    message:
      "ActionError.kind の分類名(invalid_input / guard_unsatisfied / forbidden / invariant_violated / temporarily_unavailable)を、他の文字と混ぜた文字列で書くのは禁止(U11)。見出し・本文は wording.ts が組み立てる人向けの文言(otherwise_forbidden / ロールの label / 欄の label / statement)を使うこと。分類名そのもの(完全一致)は ActionError の構築・分岐・テストの期待値として引き続き書ける。診断用の `throw new Error(...)` は対象外。",
  },
];
