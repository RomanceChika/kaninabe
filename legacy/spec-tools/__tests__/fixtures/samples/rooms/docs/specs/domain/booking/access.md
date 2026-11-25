---
doc_type: access_spec
scope: common
id: booking-access
entity: booking
reads:
  - by: anonymous
    scope: none
  - by: user
    scope: none                   # 他人の予約の中身は見えない（空き状況は部屋側の経路で見る）
  - by: system
    scope: all
  - by: booking_owner
    scope: own                    # 自分が申し込んだ予約
  - by: department_admin
    scope: context(department)    # 自分が管理者である部門の部屋の予約
fields_hidden:
  - field: note                   # 管理者への連絡事項。申込者本人と管理者以外には出さない
    from: [user]
creates:
  - by: user                      # 社内アカウントがあれば誰でも仮押さえできる
    self_assign:
      - field: booking.user_id
        role: booking_owner
        by: [user]
        reason: 仮押さえした人がその予約の持ち主になる(booking.create の owner)。得るのは自分の予約の操作だけ
writes:
  - by: booking_owner
    fields: [title, purpose, note, starts_at, ends_at]
    when: state == draft          # 仮押さえのうちだけ内容を直せる
  - by: department_admin
    fields: [note]
    when: state in [draft, confirmed]
deletes:
  - by: booking_owner
    when: state == draft          # 仮押さえの取り消しは行ごと消す（履歴に残す価値が無い）
---

# 予約のアクセス権限

- 確定後の時間帯の変更は書けない（writes の when が draft のみ） — 時間を動かすのは実質「別の予約」であり、重複の検査をもう一度通す必要がある。
- 部門管理者に連絡事項の編集を許すのは、申込者に代わって折衝の結果を書き足す実務があるためで、件名や時間帯は触らせない。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
