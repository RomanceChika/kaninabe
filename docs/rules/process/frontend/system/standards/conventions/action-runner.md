---
doc_type: process
scope: frontend
norms: [PRIN-0001, PRIN-0002, PRIN-0006, PRIN-0007, ARCH-BE-0013]
---

# アクション実行器(Server Action の送信・pending・拒否・遷移)

Server Action を実行するクライアント部品が共通で持つべき「送信中の見せ方・拒否の表示・成功後にすること」の規約。`app/src/components/action-runner/` に実体があり、`src/app/**` のクライアント部品はこれを経由してしか Server Action を呼べない(下の§閉世界)。

## なぜ実行器が要ったか

移行前、Server Action を実行するクライアント部品は 30 本を超えていたが、どれも同じ手順を手で書いていた。

```tsx
const [pending, setPending] = useState(false);
const [error, setError] = useState<ActionError | null>(null);
async function handleSubmit() {
  setPending(true);
  const result = await someAction(input);
  setPending(false);
  if (!result.ok) { setError(result.error); return; }
  router.refresh(); // または router.push(いつも手書きの行き先)
}
```

この 4 行(`useState` 2 つ・pending の付け外し・成功後の遷移)は**部品ごとに独立して書かれる**ため、直し方が部品の数だけ揺れる(`router.refresh()` を書き忘れる・`setPending(false)` を失敗時にだけ書き忘れる、といった事故が起きても、他の部品まで見て回らないと全体像が分からない)。加えて成功後の遷移(`router.push('/librarian/items/xxx')`)は**呼び側が行き先を知っている前提**で書かれており、`screen_spec` の `navigations` の宣言と実装が別々に「行き先」を持つ二重管理になっていた。

実行器はこの手順を 1 箇所(`runner-core.ts`)に固定し、呼び側からは消す。

## 参照するもの

- **拒否の 4 分類の契約** — [ARCH-BE-0013](../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md) と `@kaninabe/runtime/result` の `ActionError`
- **成功後の遷移の宣言元** — [screen-spec-writing.md §navigations](../../../specification/standards/screen-spec-writing.md)。実行器はこの宣言を生成物(`app/src/domain/generated/screens.ts`)経由で読むだけで、呼び側は書かない
- **拒否の素朴な表示** — `app/src/components/action-error-view.tsx`(`ActionErrorView`)。実行器はこれをそのまま使う
- **確認ダイアログの共通部品** — `app/src/components/confirm-dialog.tsx`(`ConfirmDialog`)。元は `app/src/app/_components/` にあったが、実行器(`ActionButton`)から使うために `src/components` へ移した(層境界 B8: `src/components` は `src/app` を import できない)
- **確認の要否・見た目の導出元** — [action-spec-writing.md「方針の導出」](../../../../backend/specification/standards/action-spec-writing.md)。実行器はこの生成物(`app/src/domain/generated/action-attributes.ts`)から `confirm_required` / `variant` / 確認文言を引くだけで、呼び側は書かない
- **執行の一覧** — [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) の S4・S6

---

## 4 つの道具

### `useActionRunner(action, options)` — 土台のフック

```ts
const runner = useActionRunner(cancelItemAction, { event: 'item.cancel' });
// runner.run(input) / runner.phase / runner.error / runner.optimisticState / runner.reset / runner.reportError
```

- `run(input)` が pending → 結果 → 成功なら遷移判断 / 失敗なら拒否の反映、を行う。戻り値は成功したかどうか(`boolean`)—— 確認ダイアログを閉じるかどうかの判断にそのまま使える。
- `phase` は `'idle' | 'pending' | 'error'`。pending の見せ方(disabled にする・「送信中…」と出す)は呼び側が `phase` を見て描くが、**いつ pending になるか自体は実行器が決める**。
- `error` は直近の拒否(`ActionError | null`)。`ActionErrorView` にそのまま渡せる。
- `reportError(error)` は**サーバーに問い合わせずに**拒否を表示する。フォームの送信前検証(zod の口 `parseField` 等)が落ちたときに使う——送信前検証は関門ではない(UX のための事前チェックであり、`invalid_input` の見せ方はサーバー由来と区別しない)。
- 中身(`runAction`)は `拒否の4分類 + 一時的な失敗 + 成功` を**網羅的な switch** で扱う。`ActionError.kind` が増えたらここが型エラーで気づく(`coverActionErrorKinds` の `never` 断言)。
- **Action が投げたら `pending` のまま止めない**(点検 19 回目 B19-1)。`runAction` が例外を受けて楽観的な表示を消し、`phase` を `error` に、`error` を固定の `{ kind: 'temporarily_unavailable', commit: 'unknown' }` にする(例外の文言は運ばない。応答が届かなかったので書けたかは分からない)。例外はクリックの処理の Promise の拒否なので、エラー境界には届かない。生成した Server Action は、コミットの状態が分かる DB の失敗を例外にせず `commit`(`not_committed` / `unknown`)つきの値で返す(点検 20 回目 B20-1)。画面の文言は `commit` で分ける(`wording.ts` の `temporarilyUnavailableText`)。**`commit: 'unknown'` の失敗のときだけ `runAction` が `refresh()` を呼ぶ**(点検 23 回目 B23-1。書けていた行が画面に出て、読み取りから導いた入力(次の発表順など)が古いまま別の行の作成に使われない。入力欄の状態と冪等の鍵は保たれ、`not_committed` と拒否では読み直さない)。
- **送信の意図ごとに冪等キーを 1 つ持つ**(点検 20 回目 B20-1)。フックは最初の `run` で UUID を作り、Action の第 2 引数 `{ idempotencyKey }` で送る。**成功したときだけ**作り直す —— 失敗(書けたか分からない・拒否)の後の押し直しは同じ鍵を送るので、作成は 1 回目の行が返り、行は増えない。同じ鍵で内容を変えた作成は `resend_input_mismatch` で断られる(1 回目が書けていた合図。画面は読み込み直して確かめるよう案内する)。**意図は呼び手が名指す**(点検 21 回目 B21-2 → 22 回目 B22-1): フックの `intentOf`(`ActionForm` も同じ名の props で渡す)が返す字面が前回と違えば、フックは新しい鍵を作る。**既定は「いつも同じ意図」**で、成功で作り直すまで、押し直しは入力を直しても同じ鍵である。渡すのは、1 つの実行器を行をまたいで使う画面(行の識別子を名指す。行 A の応答を失った後の行 B の作成を別の意図として送る)と、画面の文脈の欄を持つフォーム(生成したフォームは器が `initial` で渡す欄 `SUPPLIED` を名指す)だけである。**利用者が入れる欄は名指さない** —— 欄の名前の字面からは推さない(21 回目は `_id` で終わる欄を全部数えたので、利用者が選ぶ参照の欄を直した押し直しが新しい鍵の 2 本目の作成として成功した)。名指しの本体は `runner-core.ts` の `intentOfFields`、鍵の持ち主は `createIntentKeeper`。Action を包む呼び側(手順を順に呼ぶ画面など)は、第 2 引数をそのまま Action へ渡す。

### `<ActionButton>` — 遷移・削除ボタン

```tsx
<ActionButton
  event="branch.delete"
  action={deleteBranchAction}
  input={{ id: branch.id }}
  label="削除する"
  testId={`${BAR}.delete`}
  confirmDialogTestId={dialogTestId}
  confirmBarTestId={confirmBarTestId}
/>
```

1 つの Server Action を 1 つのボタン(要れば確認ダイアログ付き)にする。**確認の要否・見た目(`danger` / `default`)・文言は呼び側が決めない** — 生成物 `@/domain/generated/action-attributes`(`action-spec-writing.md`「方針の導出」)から `event` で引く。`confirm` / `variant` という props は存在しない(`src/app/**` での手書きは lint〈S6〉が落とす)。呼び側が渡すのは、確認が要る操作にだけ screen_spec の overlay の testid(`confirmDialogTestId` / `confirmBarTestId`)を配線することだけであり、渡さなければ確認なしの即実行になる(導出が確認を要求していても overlay が無ければ同じく即実行に倒す——安全側の既定)。**トリガーと確認ダイアログが同じ部品の中に閉じている**場合の形であり、「行ごとのトリガー + 画面に 1 つの共有ダイアログ」のように起点とダイアログが別の部品に分かれる構成には使えない(その場合は `useActionRunner` を直に使う。§使い分け)。

### `<ActionForm>` — 作成・編集フォーム

```tsx
<ActionForm
  action={createLoanAction}
  event="loan.create"
  errorTestId={`${FORM}.error`}
  resolve={() => {
    const input = loanCreateForm.parse({ ... });
    return input.ok ? { ok: true, value: input.value } : { ok: false, issues: input.error.issues };
  }}
>
  {({ phase }) => (
    <>
      <FieldControl ... />
      <button type="submit" disabled={phase === 'pending'}>{phase === 'pending' ? '送信中…' : '追加する'}</button>
    </>
  )}
</ActionForm>
```

`<form>` と送信・pending・拒否の表示を引き受け、**フィールドは子(children 関数)が描く**。`resolve` は送信時に呼ばれ、現在の入力欄の値を検証して「送る内容」か「指摘の一覧」を返す——`resolve` が `ok: false` を返したら Server Action は 1 度も呼ばれない。子に渡る `fieldIssues(field)` で欄ごとの指摘コードを取り出せる。

**`confirm`(任意)**: 渡すと、`resolve` を通ったあとに Server Action を呼ばず、既存部品 `ConfirmDialog` で確認を出し、「実行する」が押されてから呼ぶ(失敗したらダイアログを開いたまま理由を見せ、成功したら閉じる。確認を出しているあいだの拒否はフォーム側に重ねて出さない)。**確認の要否は `ActionForm` が決めない** — `kind: form` の生成物が、生成時に操作の属性(`confirmRequired`)を読んで、要るフォームにだけ `confirm`(`dialogTestId` と `confirmBarTestId` は**仕様の重ね表示**(`opened_by` がその部品・`actions` がその操作)の testid `overlay.{id}.body.center` / `.confirm_bar`(実行 / やめるはその子 `.confirm` / `.dismiss`)・文言は `{重ね表示の label}。{confirmNotes}`)を渡す。確認の器を重ね表示に統一した(S19 が宣言を要求する。ADR-0015 の改訂 2)。作成・編集は確認なしが多く(題材の製品は全数が確認なし)、渡さなければ従来どおり直接呼ぶ。

### `useRowActions({ testId, operations })` — 表の行・ボタン列の操作のボタン

`kind: table` の `actions` と `kind: actions` の生成物が使う共有フック(`components/action-runner/use-row-actions.tsx`)。**1 つの実行器を行をまたいで共有**し(送信中は他のボタンも押せない)、行ごとのボタン(`buttons(row)`)と、表の外側に 1 回だけ置く確認ダイアログ・拒否の表示(`footer`)を返す。生成物が渡すのは操作の配列(`op` / `leaf` / `label` / 行の状態 × 実行者のロールの交差を返す `available` / `run` / 確認の器の testid と見出し)だけで、**確認の要否・見た目(`variant`)・確認の注意書きは `ActionButton` と同じく生成物 `action-attributes` から引く**(呼び側は渡せない)。ボタンは `<tr>` の中に置かれるので `<form>` は使わない。遷移の交差の判定は純関数 `transitionAllows(遷移表, イベント, 状態, ロール)` が持つ(screenTest の期待 `declaredActionLeaves` と同じ表を同じ規則で引く)。 **判断を持つ部分は React に触れない純関数に切り出してある**(`row-actions-state.ts`: 確認を開く・やめる・成功で閉じる・失敗なら開いたまま理由を見せる状態の遷移 / どのボタンが出るか / 確認の文)— DOM を持たない環境(jsdom は採らない)ではフック本体を動かせないので、そこを単体テスト(`row-actions-state.test.ts`)で見る。フック本体に残るのは「状態を 1 つ持ち、出来事を通し、描く」だけである。

## 使い分け(`ActionButton` / `ActionForm` / 生の `useActionRunner`)

| 形 | 使うとき | 実例 |
|---|---|---|
| `ActionButton` | 1 つのボタン(+要れば confirm)が 1 つの部品に閉じている | 単発のボタン |
| `useRowActions` | 表の行・1 行に対するボタン列の操作のボタンが、確認ダイアログと拒否の表示を共有する | `kind: table` の `actions` / `kind: actions` の**生成物**(`_screens/generated/{画面}.{部品}.tsx`。ADR-0015 の改訂 2) |
| `ActionForm` | `<form>` で送るフィールド群がある | `loan-create-form.tsx` / `loan-edit-form.tsx`(部分更新の dirty diff も `resolve` の中で行う)。単発の作成・編集のフォームは `kind: form` の部品なら**生成物**(`_screens/generated/{画面}.{部品}.tsx`。内部で `ActionForm` を使う。ADR-0015) |
| 生の `useActionRunner` | ①複数のボタン(または複数の操作種)で 1 つの pending 状態を共有したい、②`<table>` の `<tr>` を直接返すため `<form>` を挟めない、③トリガーと確認ダイアログが別の部品に分かれている、のいずれか | `transition-bar.tsx` / `publication-bar.tsx` / `purchase-request-table.tsx` / `patron-table.tsx` / `check-table.tsx` / `volume-table.tsx` / `hold-editor.tsx` / `hold-candidates.tsx` / `loan-tree.tsx` / `overdue-table.tsx` / `companion-row.tsx` / `loan-confirm-overlays.tsx` / `own-loan-card.tsx` / `invitation-window.tsx`(①)、`volume-row.tsx`(②)、`invitation-table.tsx` / `site-page-table.tsx`(③) |

**①の実例(`transition-bar.tsx`)** —— 状態機械の遷移はどれが押されるか実行時にしか決まらないので、`action` に「入力からディスパッチする関数」を渡す。

```ts
const runner = useActionRunner<{ event: ItemEvent; id: string }, { state: string }>(
  (input) => fireTransition(input.event, input.id),
  { event: (input) => `item.${input.event}`, optimistic: (input) => ({ machine: 'item', to: targetStateOf(input.event) }) },
);
```

`event` と `optimistic` は**入力の関数**でも渡せる(`ActionButton` は 1 ボタン 1 入力なので通常は固定値で足りる)。

## 閉世界 —— `src/app/**` は Server Action を直接呼ばない

`src/app/**` のクライアント部品は `@/app/_actions/**` から import した束縛を**呼び出す**ことができない(`layer/no-direct-action-call`。ESLint ローカルルール)。

```ts
import { cancelItemAction } from '@/app/_actions/item/cancel';

cancelItemAction({ id }); // ✗ 直接呼び出しは禁止(手書きの pending/error/refresh に戻る道)
<ActionButton action={cancelItemAction} ... />; // ✓ 実行器に渡すのは import であって呼び出しではない
```

**import して実行器に渡すことは禁じない。** 塞いでいるのは「呼ぶこと」であって「参照すること」ではない——`ActionButton` の `action=` prop も `transition-bar.tsx` の `ACTIONS` 表も、渡された先(`useActionRunner` の中)で初めて呼ばれる。この区別は `no-restricted-imports`(import 文そのものの禁止)では表現できない(渡すのも呼ぶのも同じ import 文からしか判定できない)ため、呼び出し式(`CallExpression`)を見るローカルルールにしてある。

**判定は識別子名でも import 文の形でもなく、型(TypeScript の Symbol 解決)。** `framework/lint-config/src/rules/no-direct-action-call.mjs` は `projectService` の型情報を使い、呼び出し式の callee を型チェッカーで解決し、alias(`export { x as y }` 等)・変数の初期化・オブジェクトのプロパティ代入を再帰的に辿って、**最終的にどこで宣言された関数を呼んでいるか**を見る。これにより、名前を変えて素通りさせる次の 2 形も同じ結論(違反)になる(2026-09 裁定で判明・修正。以前は識別子名の構文的な追跡だけだった)。

```ts
const shim = cancelItemAction;
shim(input); // ✗ 別名に代入してから呼んでも、宣言を辿れば同じ関数

const wrapper = { run: cancelItemAction };
wrapper.run(input); // ✗ オブジェクトのプロパティに入れてから呼んでも同じ
```

### 移行の状況

2026-09 時点で、Server Action を実行していたクライアント部品 33 本すべてを実行器へ移した。`layer/no-direct-action-call` は `src/app/**` の全体に**免除リストを持たずに**掛かっている。

免除の器(`app/eslint.config.mjs` の配列でファイルごと lint 対象から外す方式)は 2026-09 の裁定で採らないことにした——P5 の「既知の例外はコード側の `eslint-disable-next-line` で明示する」に揃える。今後どうしても実行器に寄せられない部品が出た場合は、lint 設定に戻すのではなく、当該ファイル内に**理由を書いたコメント**を残したうえで報告に列挙し、次の束で仕様側の宣言(`unhandled:` 相当)に格上げする対象として扱う。

移行の過程で見つかった、呼び出し式の書き方に関する注意点が 1 つある——**イベント/操作の種類ごとに Server Action を切り替える表(`ACTIONS = { update: updateXxxAction, delete: deleteXxxAction }` のような形)は、呼び出しを必ず「計算されたキー」経由にする。**

```ts
// ✓ 安全な形(companion-row.tsx の LINK_ACTIONS・purchase-request-table.tsx 等が使う)
const key: Operation = input.kind; // Operation は union 型。単一のリテラルに絞り込まれていない変数
const action = ACTIONS[key];
return action(input);

// ✗ 落ちる形 1: リテラルのまま添字にする(型チェッカーがどのプロパティか静的に決まってしまう)
return ACTIONS['update'](input);

// ✗ 落ちる形 2: メタ情報(文言・testid 等)と操作を同じオブジェクトに同居させ、
//    `.action` のような静的プロパティで触る(動的キーで引いた先でも、プロパティ名が
//    固定なら型チェッカーはそこから宣言まで辿れる)
return OVERLAYS[request.overlay].action(input);
```

`key` が実行時にどの値になるかではなく、**その式の型が単一のリテラルまで絞り込まれているかどうか**が分かれ目である(`ElementAccessExpression` は非リテラルの union 型の変数で引いたときだけ、型チェッカーの `getSymbolAtLocation` が解決に失敗する)。表に操作とメタ情報を同居させたい場合は、`loan-confirm-overlays.tsx` のように**操作だけを別の表(`ACTIONS`)に分け**、メタ情報の表(`OVERLAYS`)からは操作を触らない形にする。実例: `purchase-request-table.tsx` / `patron-table.tsx` / `site-page-table.tsx` / `check-table.tsx` / `volume-table.tsx` / `hold-editor.tsx` / `invitation-window.tsx` / `loan-confirm-overlays.tsx`。

## 成功後の遷移 —— 呼び側は行き先を書かない

**遷移の判断は `screens.ts` の `navigations` を見て、実行器(`navigation.ts` の `resolveSuccessNavigation`)が決める。**

1. いま表示しているパス(`usePathname()`)を `screenRoutes` の `route` に逆引きし、いまの画面を特定する。
2. その画面の `navigations` に `{event}.success` があれば、遷移先の画面の `route` を求める。無ければ `router.refresh()`。
3. 遷移先の `route` に動的セグメント(`:id`)があれば、**いまの画面の動的セグメントの値**(自己ループの場合)か**成功値**(例: 作成直後に新しい `id` へ入る)で埋める。どちらにも無ければ埋められないので `router.refresh()` に倒す(存在しないパスへ push するより安全)。
4. 埋まった行き先が**いまのパスと同じ**なら(自己ループの多くがこれに当たる)、`router.push` ではなく `router.refresh()` にする —— 同じ URL への `push` は Next.js 上で再取得を起こさないため、遷移ではなく読み直しが必要な自己ループでは `refresh` でなければならない。

`push` / `refresh` の実体は安全な遷移の口 `useSafeNavigate()`(`@kaninabe/runtime/navigation/client`)であり、行き先は `safeReturnPath`(同じオリジンの相対パスだけ)を通る。部品がルーター(`useRouter`)を直に引くことは ESLint の `layer/require-safe-redirect` が止める(点検 9 回目 B9-1〜B9-6。route-handlers.md §ブラウザ側の守り)。クライアントの遷移と Server Action の転送は Route Handler の応答ではないので、Route Handler の出口の関所(`guardRoute`。点検 10 回目 B10-1)を通らない —— ここで行き先を確かめる実行時の 1 か所は `useSafeNavigate`(と Server Action の `safeRedirect`)自身で、生の口を使わせないのは lint である。画面のリンクとフォームの送り先(`<a href>`・`next/link` の `Link`・`<form action>`・`next/form` の `Form`・`formAction`)は ESLint の `layer/require-safe-link` が束縛で見る(送り先に置けるのは `safeHttpUrl`・生成した遷移先・Server Action の関数だけ。`screenPath` の第 1 引数は `screenRoutes.….route` だけ。点検 10 回目 B10-4・B10-5)。

`onSuccess` オプション(`useActionRunner` / `ActionForm` 共通)は**副作用の追加**(フォームの入力欄を空にする、等)であり、この遷移判断を置き換えない——呼び側は行き先を 1 行も書かない。

`onSuccess` は `(value, input)` で呼ばれ、**遷移判断(`refresh()` を含む)より前**である。編集のフォーム・行エディタの生成物は、この順序を使って**送った値を保存済みの値(`baseline`)として覚える** — 自分の保存の結果が `refresh()` で届いたとき、それを「他の人の変更」(競合)と読ませないため(`@kaninabe/runtime/form-refresh` の `acceptSaved`)。順序を入れ替える変更は、生成物のこの前提を壊す。

実例: `librarian_items` の `item.create.success → screen-item-manage`(`route: /librarian/items/:id`)。以前は `item-create-form.tsx` が `router.push(`/librarian/items/${result.value.id}`)` と手書きしていたが、いまは `resolveSuccessNavigation` が `screens.ts` の宣言と Server Action の成功値(`{ id }`)から同じ行き先を導く。

## 楽観的反映(遷移のみ)

`optimistic` を渡すと、pending 中だけ `optimisticState`(`{ machine, to }`)が立つ。**表示するかどうかは呼び側が決める**(実行器は値を渡すだけで、`StateBadge` 等をどこに置くかは知らない)。

```tsx
{runner.optimisticState !== null ? (
  <StateBadge machine="item" state={runner.optimisticState.to} />
) : null}
```

作成・編集は pending の有無(`phase === 'pending'`)だけを見せ、楽観的な**値**の先出しはしない——編集後の値は「送った値」であって「まだ確定していない値」を見せる意味が薄く、遷移(状態が離散的に切り替わる)ほど「次にどうなるか」を示す価値が無い。

## プレビュー専用 —— `initialPhase`

ハンドブックの SSR プレビュー(book-previews.md)は `renderToStaticMarkup` で描くため、クリックもストリーミングも実行できない。「送信中」や「拒否の4分類」の断片を作るには、**実行器の初期状態を外から差し込む口**が要る——それが `initialPhase` である。

```tsx
// __screens__/previews* からだけ渡せる(下記の lint 参照)
<ActionButton ... initialPhase={{ phase: 'pending' }} />
<ActionForm ... initialPhase={{ phase: 'error', error: { kind: 'invalid_input', issues: [...] } }} />
useActionRunner(action, { initialPhase: { phase: 'pending' } });
```

- `{ phase: 'pending' }` は「押した直後」、`{ phase: 'error', error }` は「拒否の4分類のどれか」を初期状態として見せる。`useActionRunner` の `phase` / `error` の `useState` 初期値をこれで差し替えるだけであり、`runAction` の判断ロジックには 1 行も影響しない。
- `ActionButton` は確認ダイアログを描ける状態(`confirm_required` が true かつ overlay の testid が配線されている)で `initialPhase` もあるとき、確認ダイアログを**開いた状態**から始める——閉じたダイアログの中に pending / error の断片を作る手段が無いためである。
- **本番の呼び側は渡さない。** `initialPhase` を渡せるのは `app/src/app/__screens__/previews*` だけで、それ以外の `src/app/**` から渡すと `no-restricted-syntax`(`PREVIEW_ONLY_RESTRICTED_SYNTAX`。JSX 属性とオブジェクトのプロパティの両方を見る)が落とす。渡せてしまうと、実際には起きていない pending や拒否を画面が最初から見せられる状態になる。
- 実際に各画面のどのボタン/フォームへ `initialPhase` を通すか(コンポーネントの props をどう伸ばすか)は、プレビューを実装する束(⑩b 第2段)の仕事である。ここが持つのは「差し込む口がある」ところまでで、`TransitionBar` 等の個々の部品が `initialPhase` を上から受けて転送するかどうかはその部品を触る側の判断になる。

## 確認の要否・見た目は導出する —— `variant` / `confirm` は書けない

`ActionButton` は `confirm_required` / `variant`(`default` | `danger`)を props として受け取らない。
両方とも生成物 `@/domain/generated/action-attributes`(`actionAttributesFor(event)`)から引く——
正は [action-spec-writing.md「方針の導出」](../../../../backend/specification/standards/action-spec-writing.md)
であり、事実 9 属性(`irreversible` / `destructive` / … )と `state_spec` の `tone` / `settles` から
`confirm_required = (tone: negative への遷移) ∨ destructive ∨ (irreversible ∧ affects_others) ∨ settles`
が機械的に決まる。確認文言も `「{label}。」`(`label` は state_spec の `events[].label` = 動詞の辞書形。「中止する」に「します」を続けると二重活用になるため句点だけ続ける)+ 属性ごとの定型文(`confirmNotes`)を生成物が持つ。

呼び側が渡すのは、確認ダイアログを描く screen_spec 側の overlay testid
(`confirmDialogTestId` / `confirmBarTestId`)だけである。渡さない、または導出結果が
`confirm_required: false` なら即実行になる。**`confirm_required` が true なのに overlay の
testid を渡していない場合も即実行に倒す**(安全側の既定 —— 導出が確認を求めていても
screen_spec に対応する overlay がまだ無いことがあるため。その場合は
action_spec の `ux: { confirm: none, reason: … }` で明示的に上書きするか、overlay を足す)。

`src/app/**` に `variant=` / `confirm=` の JSX 属性の手書きは無い(S6。ESLint
`no-restricted-syntax` が落とす。`variant` はオブジェクトのプロパティも見るが、`confirm` は
見ない —— `loan.confirm` のような実在するドメインイベント ID がオブジェクトのキーとして
正当に使われるため)。行のボタン・ボタン列の
共有フック `useRowActions` や、`ActionButton` を使わず `useActionRunner` を直に使う部品(§使い分け)も、
確認の要否と見た目は同じ生成物から引く(`use-row-actions.tsx` の `needsConfirm` / `row-actions-state.ts` の `confirmMessageOf`)。

## テスト

- **`runner-core.ts` / `navigation.ts` はフレームワーク非依存の純粋ロジック**なので、`useActionRunner`(React フック)を経由せず直接テストする(`runner-core.test.ts` / `navigation.test.ts`)。screen-test.md が jsdom を採らない判断をそのまま継いでおり、DOM もフックの再レンダリングも要らない。
- 注釈(`@tc`)は**ファイルにつき代表 1 件**だけに付ける。実行器のテストは「1 関数の分岐網羅」であって screen_spec の `test_cases`(1 画面 1 テストケースの粒度)には馴染まないため、残りは無印のままにする——無印のテストは A6 の orphan 判定にも A7 の網羅にも母集合として現れない(不在として扱われ、違反にはならない)。代表 1 件は関係する screen_spec(`librarian_items` の動的遷移・`item_manage` の共有実行器)の `test_cases` に登録し、`implementation` は `app/src/components/action-runner/*.test.ts` を指す——`screen_spec` の書き方の規約は「screenTest を指す」ことを想定しているが、S8 の機械検査そのものは実装ファイルの実在と `@tc` の一致だけを見るため、実行器という「画面をまたぐ共有部品」のテストをここに登録することは検査上は成立する。
- `ActionButton` / `ActionForm` そのもの(JSX を返すコンポーネント)は、実行時の相互作用(クリック・非同期の状態遷移)を確かめる専用のテストを持たない——このリポジトリは jsdom も `@testing-library/react` も採っておらず(screen-test.md と同じ判断)、追加は新しい依存を持ち込むことになるため見送った。**実際の統合は移行先の画面の screenTest と E2E スモークが検証する**(移行した 33 部品すべてで既存の screenTest・統合テスト・E2E スモークが緑であることを確認済み)。`initialPhase` の `useState` 初期値の差し替えも同じ理由でフック単体のテストは無い(型検査までで担保している)。
- **`layer/no-direct-action-call` 自体の単体テスト**は `app/src/app/_actions/__tests__/no-direct-action-call.test.ts` にある。フィクスチャを実ファイルとして `src/app/__canary_no_direct_action_call__/` に書き出し、実際に使われている ESLint 設定(型情報つき `projectService`)へ `eslint.lintFiles()` で掛ける(`route-handler-boundary.test.ts` と同じ形)。直接呼び出し・別名経由・プロパティ経由の 3 形が検出されること、値として渡すだけ(呼ばない)は許可されることを確かめる。この 1 ファイルは `app` 型でも Node 組み込み(`node:fs` / `node:path`)を import してよい特例(`eslint.config.mjs` の `boundaries/files` カテゴリ `eslint-rule-test`)が要る——screen-static-scan や `infrastructure/__tests__/guarantees` と同じ理由(型検査を伴う ESLint は解決に実在のファイルを要求するため、`lintText` ではなく実ファイルの書き出しが要る)。仕様の `test_cases` には登録していない(ドメイン仕様の見張りテストではなく、ESLint ルールというツール自体の単体テストであるため——A6 の orphan 判定は `@tc` の無いテストを母集合に含めないので、無印のままで違反にはならない)。

## 既知の穴

- **`TransitionBar` / `PublicationBar` / `PurchaseRequestTable` など一部の部品(と、表の行・ボタン列の生成物が使う `useRowActions`)は `ActionButton` を使っていない。** これらは「1 つの pending 状態を複数ボタン(または複数の操作種)で共有する」「`<tr>` を直接返すので `<form>` を挟めない」「トリガーと確認ダイアログが別の部品」のいずれかに当たり、`ActionButton` の形(1 部品にトリガーとダイアログが閉じている)に合わないため、生の `useActionRunner` を直に使っている(§使い分け)。**元の実装と比べて挙動が変わった箇所が 1 つある** —— `VolumeTable` / `VolumeRow` の組は、移行前は行の保存(`item_volume.update`)の拒否を握りつぶしていた(`if (issues.length > 0) return;` で終わり、`result.ok` も見ていなかった)。実行器を表全体で共有したことで、行の保存の拒否も表のエラー表示に出るようになった(既存の穴を 1 つ塞いだ、という副作用)。
- **フィールド単位の指摘表示(`fieldIssues`)はまだどの移行済みフォームも使っていない。** 全フォームが従来どおり `ActionErrorView` の一括表示のままで、`resolve` が返す `issues` を欄ごとに出し分ける実例はまだ無い。
- **`initialPhase` を個々の部品まで通す配線はまだ無い。** `useActionRunner` / `ActionButton` / `ActionForm` は受け取れるが、`TransitionBar` のように内部で `useActionRunner` を直に使う部品は `initialPhase` を外から受け取る props を持っていない。ハンドブックのプレビューで特定のボタンを pending 表示にするには、その部品に `initialPhase` を通す props を足す作業が要る(束 ⑩b 第2段の仕事)。

## 関連ドキュメント

- [screen-test.md](./screen-test.md) — pending の見せ方は実行器が持つ(screen_spec の「実装の自由」の裏返し)
- [server-actions.md](../../../../backend/system/standards/conventions/server-actions.md) — Server Action 本体(ARCH-BE-0013 の 4 手順)の実装規約
- [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) — S4(このルールの執行)
