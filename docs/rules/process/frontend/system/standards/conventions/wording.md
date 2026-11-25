---
doc_type: process
scope: frontend
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0008, ARCH-BE-0013]
---

# エラーの文言(拒否・「いまできること」を人の言葉にする)

「拒否(`ActionError`)をどう見せるか」「状態を見せる画面に何を添えるか」の規約。`app/src/components/wording.ts`(出どころが決まった純関数)・`app/src/components/action-error-view.tsx`(`ActionErrorView`)・`app/src/components/next-actions.tsx`(`NextActions`)に実体がある。

## なぜこの規約が要ったか

`ActionErrorView` は ARCH-BE-0013 のエラー4分類をそのまま見出しに出していた: `guard_unsatisfied（この操作は今は許されていません）`。分類名は仕組みの語彙であり、人が読んで次に何をすればいいか分かる文ではない(docs/design/cognitive-load.md §2 ⑧「言葉」)。一方で仕様には既に人向けの理由が存在していた——`otherwise_forbidden`(state_spec の遷移が持つ、その状態からその遷移が起こせない理由の散文)。**文言を新しく発明する必要は無く、仕様にある値を画面まで運んでいなかっただけ**である。

同じ発端で、状態を見せる画面(状態バッジ)に「次に何をすればいいか」が無いことも指摘された(§2 ⑩「現在地と次」)。こちらも遷移表(`from` / `by`)から導ける情報であり、新しい宣言は要らない。

ADR-0011「起点は2つ」の§3 段1(見せ方で吸収)がこの束(⑯d)の位置づけである——ドメインは変えず、見せ方だけで解く。

## 参照するもの

- **エラー3分類の契約** — [ARCH-BE-0013](../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)。`kind` は `invalid_input` / `guard_unsatisfied` / `forbidden` / `invariant_violated` の4語(値域)
- **`ActionError` の形** — `@kaninabe/runtime/result`。`guard_unsatisfied` は `event` / `blockedBy` / `reason` を、`forbidden` は `event` / `role` を、`invariant_violated` は `invariant` を運ぶ
- **`otherwise_forbidden` の宣言元** — [domain-spec-writing.md](../../../../common/specification/standards/domain-spec-writing.md)(state_spec の `events[].otherwise_forbidden`)。生成物は `@/domain/generated/{machine}.transitions.ts` の各遷移の `otherwiseForbidden`
- **ロールの `label`** — [domain-spec-writing.md](../../../../common/specification/standards/domain-spec-writing.md)(role_spec の `roles[].label`)。生成物は `@/domain/generated/roles.ts` の `ROLE_LABELS`(label 未宣言のロールはキーを持たない)
- **欄の `label`** — `entity_spec` の `fields[].label`。生成物は `@/domain/generated/{aggregate}.labels.ts` の `{aggregate}FieldLabels`(`writes` の有無に依らず entity_spec を持つ全集約に出る)
- **状態機械の索引** — `legacy/spec-tools/lib/generate/render/code-state-machines-index.ts` が全機械ぶん束ねる `@/domain/generated/state-machines.ts` の `STATE_MACHINES`(機械名 → 遷移テーブル)と `EVENT_LABELS`(機械名 → イベントの表示名の表)
- **既存の「ボタンの一覧」の導出** — `use-row-actions.tsx` の `transitionAllows`(行の状態 × 実行者のロールの交差。宣言した操作との交差は生成の表・ボタン列が操作の配列に持つ)。`NextActions` はこれと似た形だが、**宣言した操作への絞り込みは行わない**(下記§NextActions)
- **執行の一覧** — [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) の U11

---

## 文言の出どころは3つしかない(`wording.ts`)

`ActionErrorView` は文言を組み立てない。すべて `wording.ts` の純関数へ委譲する。

| 分類(`kind`) | 出どころ | 関数 |
|---|---|---|
| `guard_unsatisfied` | 該当遷移の `otherwise_forbidden`。無ければエンジンの診断文字列(`reason`)へフォールバック | `otherwiseForbiddenFor(eventId)` |
| `forbidden` | 実行できるロールの `label`。「この操作は{ロール名}だけができます」 | `roleLabel(roleId)` |
| `invalid_input` | 呼び側が渡す欄名の表示名(`{aggregate}FieldLabels`)。渡さなければ欄名(フィールド ID) | `fieldIssueMessage(field, code, fieldLabels?)` |
| `invariant_violated` | `invariant_spec` の `statement`(既存の `invariantStatement()`) | (`@/domain/generated/invariants`) |

**新しい宣言は増やさない。** 仕様に理由文が無い場合(`otherwise_forbidden` 未宣言の遷移、作成・削除・編集のように「状態で弾かれる」経路が無い拒否)は、ARCH-BE-0013 の `reason` に既にあるエンジンの診断文字列へ安全側に倒す——**画面が代わりに文を発明することはしない**。

`fieldIssueMessage` の zod 指摘コード → 定型文の対応表は `wording.ts` の `FIELD_ISSUE_TEMPLATES`(値域。13 語)に**1 か所だけ**持つ。`FieldIssue` は `field` と `code` しか運ばない(zod の `minimum` / `maximum` のようなしきい値を運ばない)ため、「N 文字まで」のような具体的な数は出せない——これは `FieldIssue` の形の限界であり、この規約では埋めない(BACKLOG)。

## `ActionErrorView`

```tsx
<ActionErrorView
  error={runner.error}
  testId={`${FORM}.error`}
  fieldLabels={loanFieldLabels}       // invalid_input の欄名表示名(任意)
  currentState={loan.state}           // guard_unsatisfied の「いまできること」に使う(actorRoles と対)
  actorRoles={['loan_owner']}         // 同上
/>
```

- **見出しは分類名を含まない人向けの一言**(`GENERIC_HEADING`。例: 「いまはこの操作ができません」)。本文が `wording.ts` の出どころから組み立てた文言を並べる。
- **分類名と追跡用 ID(`event` / `invariant` / `role` / `blockedBy`)は `<details>` に折りたたむ。** これがこの部品**だけ**が持ってよい唯一の例外である(U11)。`data-error-kind` 属性(screenTest が読む)は変わらず外側の `<div>` に残す。
- `fieldLabels` / `currentState` / `actorRoles` は**任意**。渡さなくても理由文(`otherwise_forbidden` かそのフォールバック)までは出る——段階的な改善であり、既存の呼び側を壊さない。

## `NextActions`(「いまできること」)

```tsx
<NextActions
  machine="item"
  state={item.state}
  actor={['librarian']}
  testId={`${TABLE_TESTID}.next_actions`}
/>
```

生成物(`STATE_MACHINES` × `EVENT_LABELS`)から、現在状態でこの実行者(のロールの集合)が起こせる遷移の `label` を宣言順に並べる。**ボタンでは無く案内である**——起こす口は持たない。

- **押せるボタンの一覧(`transition-bar.tsx` のような部品)がある画面には置かない。** そちらは同じ情報をボタンとして直接見せているので、案内をもう1つ並べると二重表示になる。置くのは**状態バッジは出すがボタンは持たない画面(一覧・詳細の閲覧側)**である。
- **画面が発火すると宣言した操作(`screenRoutes.*.actions`)への絞り込みは行わない。** `availableEvents`(ボタンの一覧の導出)との違いはここで、案内はその画面がまだ口を持たない遷移も含めてよい(押せないだけで、案内として見せることそのものは害が無い)。
- 起こせる遷移が0件なら**何も描かない**。一覧の行ごとに出ることが多い部品なので、空を毎回文章で埋めると行数の多い一覧ほど雑音になる。

## `ActionErrorView` の中の「いまできること」

`guard_unsatisfied` のとき、`currentState` / `actorRoles` を渡すと `NextActions` が添えられる(`${testId}.next_actions`)。「押せるボタンの一覧がある画面には置かない」という `NextActions` 単体の原則は、ここには当てはまらない——ボタンの一覧は**攻撃前**の状態を示すのに対し、こちらは**拒否された直後**に「では今は何ができるか」を答える文脈であり、別の役目である。

## U11(拒否の見出し・本文に機械の分類名を書かない)

`src/app/**` と `src/components/**` に、`ActionError.kind` の4語を**他の文字と混ぜた文字列**として書けない(ESLint `ERROR_KIND_RESTRICTED_SYNTAX`)。分類名の**完全一致リテラル**(`{ kind: 'invalid_input', ... }` の構築・`switch`/`case` の分岐・テストの期待値・`it`/`describe` の説明文)は対象外——塞ぐと `ActionError` そのものを組み立てられなくなる。詳細は [enforcement-matrix.md](../../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) の U11。

**既知の穴**: `TemplateLiteral` の中身や `{error.kind}` を JSX にそのまま出す形は `Literal` ノードではないため検出しない。読み取り側(`QueryError`)の `invalid_input` 表示(`item-detail.tsx` 等の `QueryIssues` 相当)がまさにこの形だが、`ActionError` だけを対象にしたこの規約では対応していない(found hole。BACKLOG)。
