---
doc_type: auth_spec
scope: backend
id: auth-flow

subject: staff_member.account          # 決定表の主語。状態機械ではなく enum の欄(kind: field)

providers: [google]

sessions:                              # セッションの寿命(必須。H5 がプラットフォームの設定と突き合わせる)
  inactivity: 8h
  absolute: 24h
  reason: 絶対の寿命は NIST SP 800-63B-4 §2.2.3 の AAL2 の上限(24 時間)に合わせる。無操作の時間切れは認証基盤が最後の更新から測るので、アクセストークンの寿命(1 時間)より長い 8 時間にする
  concurrent:
    unbounded: 認証基盤の既定のまま上限を置かない(社内の仕組みで、従業員は複数の端末から使う)

idp_session:                            # IdP とアプリのセッションの関係(必須)
  logout: keeps_idp
  idp_ends: app_continues
  lifetime: independent
  reason: IdP(google)はサインイン時の身元の確認にだけ使い、サインイン後の権限の正はアプリ側の状態にある。ログアウトで IdP のセッションまで終えると、IdP を使っている途中の人を巻き込む

mfa:                                   # 多要素認証(既定 = 全員に要求する)。認証基盤のセッションが多要素認証を済ませていない人は送り先へ
  to: screen-mfa
  implementation: app/src/composition/auth.ts::requireMfa
  summary: 社外に開いた入口を持たない社内の仕組みなので、従業員の全員に 2 段階認証を求める

axes:
  - id: account                        # 主語の軸。名前はこのシステムの語である
    kind: field
    of: staff_member.account
    absent: none                       # 従業員の行が無いことを表す値
    summary: 社内アカウントの状態
    labels:
      none: 従業員の行が無い
      active: アカウントが使える
      locked: アカウントが停止されている
  - id: directory                      # 人事台帳への引き当て(従業員の行が無い人だけが通る)
    kind: enum
    summary: 人事台帳への引き当て
    when: { account: none }
    values: [unknown, pending]
    labels:
      unknown: 人事台帳に見つからない
      pending: 台帳にはあるが従業員の行がまだ作られていない

landings:
  - id: work
    screen: screen-store-list
    summary: 従業員として店舗一覧へ(自分の会社の店舗だけが見える)
  - id: refused
    screen: screen-store-list
    summary: 入れない(見えるものが 1 つも無い状態で着く。復帰は人事と情シスの手続き)

sign_in:
  - id: no_staff_unknown
    account: none
    directory: unknown
    lands: refused
    summary: 人事台帳に無いアカウントは従業員の行を作らない
  - id: no_staff_pending
    account: none
    directory: pending
    lands: refused
    summary: 台帳にはあるが従業員の行がまだ無い(登録は人事側の仕事であり、この仕組みは作らない)
  - id: active
    account: active
    lands: work
    summary: 使えるアカウントを持つ従業員は通常の入口へ
  - id: locked
    account: locked
    lands: refused
    summary: 停止されたアカウントは入り直しても自動では戻らない

gates:
  - id: session
    guards: requires_auth
    on_fail: not_found
    implementation: app/src/composition/auth.ts::requireSession
    summary: ログインが要る画面に未ログインで来た人には 404 を返す(社外に開いた入口を 1 枚も持たないため、送り返す先が無い)

test_cases:
  - id: TC-AUTH-SIGNIN-001
    type: unit
    covers: [other]
    spec_ids: [auth-flow]
    implementation: app/src/operation/__tests__/shared/sign-in-sync.test.ts::宣言した分岐のすべてで着地先が仕様どおりになる
---

# 認証フロー — サインインしたあとどこへ着くか

- **公開の画面を 1 枚も持たない。** 全画面が `requires_auth: true` なので、未ログインの関門は
  送り返す先(`to`)を持たず `not_found` に倒す —— 送り先の無いリダイレクトを宣言するより、
  「社外からは存在しない」ことを選ぶ(PRIN-0009 の既定を閉じる側に倒す線)。
- **画面の排他表示(`can_create` / `read_only`)は着地ではない。** 店舗一覧の出し分けは
  ロールで決まるレイアウトの話であり、サインインの結末とは無関係である。着地が `variant` を
  宣言しない画面の排他表示は認証の関心の外にある(H2)。
- **アカウントの停止と退職は別である。** ここが見るのは社内 SSO のアカウントが使えるかどうかで、
  在籍そのものは人事側の台帳が正である(従業員の行に状態機械を持たせない理由と同じ)。

<!-- AUTO-GENERATED:auth-body -->
<!-- /AUTO-GENERATED:auth-body -->
