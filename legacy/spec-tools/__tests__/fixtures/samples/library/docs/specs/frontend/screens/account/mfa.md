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
<!-- /AUTO-GENERATED:screen-body -->
