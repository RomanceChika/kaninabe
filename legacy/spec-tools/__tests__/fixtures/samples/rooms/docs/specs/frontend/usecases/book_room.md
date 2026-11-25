---
doc_type: usecase_spec
scope: frontend
id: usecase-book-room

name: book_room
goal: 会議室を予約して確定する
actor: user
start: screen-booking-new
done: booking.state == confirmed

saves:
  - id: reserve
    label: 予約して確定する
    migration: 20260911000001_usecase_book_room_reserve.sql
    steps:
      - op: booking.create
        label: 予約の内容
      - op: booking.confirm
        label: 確定

test_cases:
  - id: TC-USECASE-BOOK_ROOM-001
    type: integration
    covers: [success]
    spec_ids: [usecase-book-room]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::book_room.reserve の複合 RPC が宣言どおりの署名で実在する
  - id: TC-USECASE-BOOK_ROOM-002
    type: integration
    covers: [success]
    spec_ids: [usecase-book-room]
    implementation: app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts::book_room.reserve の複合 RPC の本文が生成した SQL と一致する
  # 保存点の decide ⇔ 複合 RPC の一致の証明(束 ⑳-5a2)も生成物。注釈もここが生成する
  # AUTO-GENERATED:usecase-eq-tests
  # /AUTO-GENERATED:usecase-eq-tests
---

# 会議室を予約して確定する（book_room）

- 保存点を「仮押さえ」と「確定」に分けない — 分けると、確定を忘れた仮押さえが部屋を塞いだまま残る（部門管理者が代わりに確定する経路は個別の操作として別にある）。
- 空き時間の提案はこのユースケースに入れない（部屋を選ぶところまでは読み取りの仕事）。
