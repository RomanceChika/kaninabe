---
doc_type: process
scope: frontend
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0009, ARCH-BE-0016]
---

# 遷移(ナビゲーションのリンク)の表示条件

「画面に出る遷移(ヘッダのリンク・行リンクなど)を、いつ表示してよいか」の規約。`app/src/components/nav-link.tsx` に実体(`NavLink`)があり、行き先が入場条件(`requires_auth` / `for` / `precondition`)を持つ遷移はこれを経由する。

## なぜ NavLink が要ったか

screen-spec-writing.md の§先読みの線引きは「画面に出る**操作**(ボタン)は宣言 ∩ 状態機械の遷移から導き、権限の無い人には出さない」を定めているが、この線引きは**遷移(リンク)には及んでいなかった**。実測: 共有ヘッダ(`chrome-library`)の司書用リンク 5 本(利用者管理・招待管理・分館管理・蔵書点検表・購入希望)が、行き先の画面がどれも `for: [librarian]` を宣言しているにもかかわらず、利用者なら誰にでも描画されていた。押すと `requireLibrarian()` で not found になるため安全上の穴ではないが、「画面に出るものは宣言から導く」という仕組みの原則が遷移には効いていなかった。

新しい宣言は足さない。**遷移(リンク)の表示条件 = 行き先の画面の入場条件**であり、入場条件は screen_spec が既に持っている(`requires_auth` / `for` が auth_spec の `gates[].role` を含むか / `precondition`)。これを画面 id 引きの生成物へ写し、`NavLink` がそれと券(`SessionProfile`)を掛け合わせて表示可否を決めるだけである。

## 参照するもの

- **入場条件の宣言元** — [screen-spec-writing.md §for / requires_auth](../../../specification/standards/screen-spec-writing.md)。「この画面はどの関門(gate)に掛かるか」を画面が新しく宣言することはしない、という既存の原則をそのまま流用する
- **関門の導出規則** — [auth-spec-writing.md §画面の関門は宣言から導く](../../../../backend/specification/standards/auth-spec-writing.md)。`requiredGuardsOf`(H4 と同じ関数)が screen_spec ⇔ auth_spec の対応を機械的に導く。**この規則を 2 か所に書かない** —— 生成物 `navigation-visibility.ts` もこの関数をそのまま呼ぶ
- **券(SessionProfile)** — [auth-spec-writing.md §session 属性](../../../../backend/specification/standards/auth-spec-writing.md)。`entity_spec` の `session: true` から生成される。券は最大 1 時間古いことがある(JWT の更新頻度に依る)
- **執行の一覧** — [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) の U10

---

## 生成物 `navigation-visibility.ts`

`legacy/spec-tools/lib/generate/render/code-navigation-visibility.ts` が、screen_spec の全画面から画面 id 引きの入場条件表を出す(閉世界。画面が増えれば自動で 1 件増える)。

```ts
export interface NavigationEntryCondition {
  readonly requiresAuth: boolean;
  readonly gate?: { readonly role: string };
  readonly precondition?: GuardExprData;
}

export const NAVIGATION_VISIBILITY: Readonly<Record<string, NavigationEntryCondition>>;
```

- `requiresAuth` は screen_spec の `requires_auth` の写し。
- `gate` は `for` が auth_spec の `gates[].role` の値を含むときだけ付く(このアプリでは `librarian` の 1 本)。
- `precondition` は screen_spec の `precondition` の AST(`screens.ts` と同じ形)。**`NavLink` はこれを評価しない** —— 評価に要る対象の事実(`subject`)を `NavLink` は持たないため(下の§まだできないこと)。

`screens.ts`(画面**名**引き。screenTest の突合表)とは別に画面**id**引きの薄い表を持つのは、`NavLink` の `to`(呼び出し元が書く画面 id。例: `screen-desk`)からそのまま引けるようにするためである。

## `<NavLink>` の使い方

```tsx
import { NavLink } from '@/components/nav-link';

<NavLink
  to="screen-desk"       // 遷移先の画面 id(screen_spec の id)
  isLoggedIn={true}              // 呼び出し元が requireSession() を通っていれば true 固定でよい
  profile={profile}              // SessionProfile | null(券)
  testId={`${HEADER_TESTID}.desk_link`}
  className={ui.headerLink}
>
  窓口
</NavLink>
```

- `to` は画面 id。href は `NavLink` が生成物 `screenRoutes` から引く(呼び出し元は route 文字列を持たない)。**動的セグメント(`:id`)を持つ画面は対象外** —— いまの呼び出し元(共有ヘッダ)に実例が無いため。要るようになったら `screenPath`(`@/components/screen-path`)を受け取れる形へ拡張する。
- `isLoggedIn` は呼び出し元が既に確立している事実として渡す。`NavLink` の中でセッションの有無を非同期に確かめない —— 確かめようとすると、`requires_auth` 向けのリンクまで読み込み中は消える一過性のちらつきを生む。
- `profile` が `null`(未読み込み・未ログイン)の間、role_gate の掛かるリンクは**表示しない**(fail closed)。role_gate の掛からないリンクは券に関わらず表示する。
- **見た目だけの出し分けである。** サーバー側の関門(`requireSession()` / `requireLibrarian()`)は変わらず効く。券は最大 1 時間古いことがあるため、`NavLink` が「出してよい」と判断しても、押した先で `requireLibrarian()` に断られることはありうる(逆に、券が古く「出さない」と判断していても、実際にはまだ資格が有効な場合がある —— どちらも見た目のズレでしかなく、安全性には影響しない)。

## 遷移先を手で書かない(U10)

`src/app/**` では `<Link href="/...">` のような文字列リテラルの href を書けない(ESLint `LINK_RESTRICTED_SYNTAX`)。行き先が入場条件を持たない画面(役割の無い一般的な遷移)への遷移は、`NavLink` を使わず生成物から直接組み立ててよい。

```tsx
import { screenRoutes } from '@/domain/generated/screens';
import { screenPath } from '@/components/screen-path';

<Link href={screenRoutes.item_list.route}>蔵書一覧</Link>
<Link href={screenPath(screenRoutes.item_detail.route, item.id)}>{item.title}</Link>
```

`screenPath(route, ...params)` は `screen_spec` の `route`(`/items/:id` のような表記)の動的セグメントを、出現順に渡した値で埋める(`@/components/screen-path`)。

## まだできないこと(既知の穴)

| 穴 | なぜ塞がっていないか |
|----|---------------------|
| `precondition` を持つ画面への遷移の出し分け | `NavLink` が持つのは券(`SessionProfile`)だけで、`precondition` の評価に要る対象(`subject`)の事実を持たない。評価できない条件は**隠す方向に倒さない**(サーバー側の `on_fail` が別に効いている)。いまのところ role_gate の掛かる画面に `precondition` を重ねた実例が無いため実害は無い |
| 券が古いままの一過性のズレ | `SessionProfile` は最大 1 時間古い(JWT の更新頻度)。任免直後の一瞬、出し分けが実際の資格と食い違いうるが、サーバー側の関門は別に効くため安全性には影響しない |
| 動的セグメントを持つ画面への `NavLink` | いまの呼び出し元(共有ヘッダ)に実例が無い。要るようになったら `to` と一緒に `params` を受け取れる形へ拡張する(2 実例目が出てから — dsl-extension-triage.md) |

## 関連ドキュメント

- [screen-spec-writing.md §for / requires_auth](../../../specification/standards/screen-spec-writing.md) — 入場の関門の宣言そのもの
- [auth-spec-writing.md §画面の関門は宣言から導く](../../../../backend/specification/standards/auth-spec-writing.md) — `requiredGuardsOf` の正
- [action-runner.md](./action-runner.md) — 同じ「呼び側に書かせず生成物から決める」設計の先行実物(操作の実行版)
