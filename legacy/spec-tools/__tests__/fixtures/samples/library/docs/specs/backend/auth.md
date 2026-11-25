---
doc_type: auth_spec
scope: backend
id: auth-flow

subject: patron.card                  # 決定表の主語。状態機械ではなく enum の欄(kind: field)

providers: [email]

sessions:                              # セッションの寿命(必須。H5 がプラットフォームの設定と突き合わせる)
  inactivity: 8h
  absolute: 24h
  reason: 絶対の寿命は NIST SP 800-63B-4 §2.2.3 の AAL2 の上限(24 時間)に合わせる。無操作の時間切れは認証基盤が最後の更新から測るので、アクセストークンの寿命(1 時間)より長い 8 時間にする
  concurrent:
    unbounded: 認証基盤の既定のまま上限を置かない(利用者は複数の端末から使う)

idp_session:                            # IdP とアプリのセッションの関係(必須)
  logout: keeps_idp
  idp_ends: app_continues
  lifetime: independent
  reason: 外部の IdP を使わない(メールのサインイン)ので、IdP のセッションは無い。IdP を足す日はこの宣言を見直す。ログアウトはこの端末のアプリのセッションだけを閉じる

mfa:                                   # 多要素認証。カウンターの操作(貸出・返却・紛失)ができる司書だけに求める
  require: { roles: [librarian] }
  to: screen-mfa
  implementation: app/src/composition/auth.ts::requireMfa
  summary: 司書の画面に入る前に 2 段階認証を求める(利用者の画面は求めない)

axes:
  - id: card                          # 主語の軸。名前はこのシステムの語である
    kind: field
    of: patron.card
    absent: none                      # 利用者の行が無いことを表す値
    summary: 利用者カードの状態
    labels:
      none: 利用者の行が無い
      valid: カードが有効
      expired: カードが期限切れ
      revoked: カードが停止されている
  - id: desk                          # 窓口での手続き(利用者の行が無い人だけが通る)
    kind: enum
    summary: 窓口での本人確認
    when: { card: none }
    values: [not_done, done]
    labels:
      not_done: 窓口の手続きが済んでいない
      done: 窓口の手続きが済んでいる

landings:
  - id: catalog
    screen: screen-item-list
    summary: 蔵書目録へ(貸出も予約もできる通常の入口)
  - id: guest
    screen: screen-item-list
    summary: 蔵書目録は見えるが、貸出と予約はできない(カードの手続きが要る)

sign_in:
  - id: no_patron_without_desk
    card: none
    desk: not_done
    lands: guest
    summary: 利用者の行が無く窓口の手続きも済んでいない人は、目録を見るだけ
  - id: no_patron_after_desk
    card: none
    desk: done
    lands: guest
    summary: 窓口の手続きは済んでいるが行がまだ無い(反映は窓口の登録が正)ので目録だけ
  - id: card_valid
    card: valid
    lands: catalog
    summary: 有効なカードを持つ利用者は通常の入口へ
  - id: card_expired
    card: expired
    lands: guest
    summary: 期限切れのカードでは借りられない(更新は窓口の手続き)
  - id: card_revoked
    card: revoked
    lands: guest
    summary: 停止されたカードは入り直しても自動で戻らない

gates:
  - id: session
    guards: requires_auth
    on_fail: redirect
    to: screen-item-list
    implementation: app/src/composition/auth.ts::requireSession
    summary: ログインが要る画面に未ログインで来た人を目録へ送る
  - id: librarian
    guards: role_gate
    role: librarian
    on_fail: not_found
    implementation: app/src/composition/auth.ts::requireLibrarian
    summary: カウンターの画面に司書以外が来たら、中身を無いものとして扱う

test_cases:
  - id: TC-AUTH-SIGNIN-001
    type: unit
    covers: [other]
    spec_ids: [auth-flow]
    implementation: app/src/operation/__tests__/shared/sign-in-sync.test.ts::宣言した分岐のすべてで着地先が仕様どおりになる
---

# 認証フロー — サインインすると何が起きるか

- **主語は状態機械ではない。** 利用者の在籍を状態機械で持たないシステム(この館では利用者の行そのものは窓口の台帳が正)なので、主語の軸は `kind: field` で `patron.card` を指す。値の全体は entity_spec の `enum` が正であり、カードの状態を 1 つ足したら着地の宣言が要る(H1)。
- **軸の名前は `card` / `desk` である。** 決定表の軸の名前は仕様の側の語であり、仕組みが特定の軸名を要求することは無い(束 ⑲-2a でここが開いた)。
- **サインインで操作を実行しない。** どの行も `runs` を持たない —— 利用者の行を作るのは窓口の登録であって、ログインではない。

<!-- AUTO-GENERATED:auth-body -->
<!-- /AUTO-GENERATED:auth-body -->
