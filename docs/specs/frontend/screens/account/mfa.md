---
doc_type: screen_spec
scope: frontend
id: screen-mfa
name: mfa
label: 2 段階認証
route: /mfa
chrome: chrome-library
for: [patron]
entry_point: true
requires_auth: true

navigations:
  - on: mfa_verified                   # 要素の確認が済んだら、多要素認証を求める画面へ戻る
    to: screen-desk

layout:
  header:
    - page_title:
        label: 2 段階認証
  body:
    center:
      - mfa_form                       # 要素の登録(初回)か確認(2 回目以降)。どちらかは認証基盤の状態で決まる

test_cases:
  - id: TC-SCREEN-MFA-001
    type: unit
    covers: [success]
    spec_ids: [screen-mfa]
    implementation: app/src/app/__screens__/mfa.test.tsx::宣言したスロット部品がすべて描画される
  - id: TC-SCREEN-MFA-002
    type: unit
    covers: [forbidden]
    spec_ids: [screen-mfa]
    implementation: app/src/app/__screens__/mfa.test.tsx::未ログインは目録へ送られる
---

# 2 段階認証(mfa)

- 多要素認証を済ませていない司書が、カウンターの画面へ入る前に送られてくる画面である(認証フロー仕様の `mfa.to`)。利用者の画面(`for: [patron]`)なので、この画面そのものは多要素認証を求めない。

<!-- AUTO-GENERATED:screen-body -->
### 入場と読み取り

| 項目 | 値 |
| --- | --- |
| route | `/mfa` |
| chrome | chrome-library |
| 閲覧ロール（for） | patron |
| entry_point | ✓ |
| requires_auth | ✓ |
| subject | — |
| precondition | — |
| on_fail | — |
| reads（query_spec） | — |
| 表示義務（states.requires） | — |

### 骨格

凡例: `[排他{n} {​状態}]` は同時には出ない部品(どの状態でどちらが出るかは実装の自由)。**同じ番号の中から 1 つだけ**が描かれ、番号が違うグループは互いに独立している(番号が 2 つあれば、各グループから 1 つずつ = 同時に 2 つ描かれる)。`└` は部品の内側の入れ子スロット。`—` は宣言の無いスロット。chrome の枠は外枠で、画面の枠はその内側に入る。

```text
+-- chrome: library
|   header : app_header
+-- screen: mfa
|   header      : page_title
|   body.left   : —
|   body.center : mfa_form
|   body.right  : —
|   footer      : —
```

### 操作（actions）

この画面から発火できる操作はない（読むだけの画面）。

### 遷移（navigations）

| きっかけ（on） | 遷移先（to） | 宣言元 |
| --- | --- | --- |
| mfa_verified | screen-desk | 画面 |
| catalog_link | screen-item-list | chrome-library |
| my_library_link | screen-my-library | chrome-library |
| desk_link | screen-desk | chrome-library |

### テストケース

| ID | type | covers | by_role | spec_ids | implementation |
| --- | --- | --- | --- | --- | --- |
| TC-SCREEN-MFA-001 | unit | success | — | screen-mfa | `app/src/app/__screens__/mfa.test.tsx::宣言したスロット部品がすべて描画される` |
| TC-SCREEN-MFA-002 | unit | forbidden | — | screen-mfa | `app/src/app/__screens__/mfa.test.tsx::未ログインは目録へ送られる` |
<!-- /AUTO-GENERATED:screen-body -->
