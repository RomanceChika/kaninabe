---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0008, ARCH-SP-BE-0001, ARCH-BE-0014, ARCH-BE-0015]
decisions: [ADR-0003]
---

# 通知仕様（notification_spec）の書き方

`docs/specs/backend/notifications.md` に置く `notification_spec`（通知カタログ）の YAML スキーマと、検証器が実行するチェック（N0・N1・N2）を定義する。

## 目的

- **暗黙の挙動を無くす。** 通知は「形式検証しにくい」という理由で `effects` の ID 1 本だけを残して実装へ落ちていた。その結果「どの操作で誰に何が飛ぶか」がどの仕様書にも書かれていない状態が生まれた。カタログはその穴を塞ぐ（PRIN-0001 の本来の意味：**形式化できないことは、形式化しないまま仕様に書く**）。
- 通知は一度間違えると**見えてはいけない人に届く**。可視性（access_spec）と同じ重さの宣言として、全数を 1 か所に集めて人間がレビューできる形にする（PRIN-0006）。
- 仕様・生成物・実装のハンドラを**双方向の閉世界**で結び、片方だけ増えた状態を機械が落とす（PRIN-0008）。

## 参照するもの

- **配置**: [ARCH-SP-BE-0001](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) §通知仕様
- **発火元の正**: [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) §state_spec の `effects`
- **送信の実体**: [ARCH-BE-0014](../../../../architecture/system/backend/ARCH-BE-0014-external-integration.md)（外部連携）/ [ARCH-BE-0015](../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)（ジョブ実行）
- **テンプレート**: `docs/specs/backend/template.notification_spec.md`

## ルール・基準

### 語彙をどちらが持つか（フレームワークとアプリの線）

**機械が分岐に使う軸だけをフレームワークが固定し、それ以外の語彙は仕様が宣言する。**

| 軸 | 語彙の持ち主 | 理由 |
|---|---|---|
| `trigger`（`auto` / `manual` / `schedule`） | **フレームワーク固定** | N1 がこの値で分岐する（`auto` だけが `effects` と閉じ、`schedule` だけが走査の `emits` と閉じる） |
| `medium` / `audience` / `mention` | **カタログの `vocabulary`** | 「#circulation」「運営スタッフのチャンネル」はこのアプリの事情であり、体系の一部ではない |
| `audience` の `recipient.kind`（`self` / `role` / `channel`） | **フレームワーク固定** | 実装（`handlers.ts`）が INV-PATRON-005 の判定にこの値で分岐する |
| `mention` の語の `mentions_person` / `audience` の語の `allows_person_mention`（本人を名指す語・名指せる宛先であることの宣言） | **フレームワーク固定の宣言**（語の綴りはカタログ） | N0 / N2 がこの宣言で分岐する（語を選んだ行は `person_from` を持つ）。綴りは比べない |
| `recipient.role` / `recipient.subjectKey` | **カタログの `vocabulary.audience[].recipient`** | 「どのロールか」「payload のどのキーか」はこのアプリの事情 |

これは doc_types.md の「**検証器がコード分岐に使う区別だけが専用の型を持つ**」打ち切り規則と同じ線である。語彙をパーサや検査器に書き込むと、別のアプリでこの体系を使うときに体系のコードを直すことになる。

### 宛先種別（`vocabulary.audience[].recipient`）

`audience` の語 1 つごとに、「誰に届くか」を機械が判定できる形で `recipient` を添える。**この宣言が無いと N0 が落ちる**（audience の語は必ず recipient を持つ）。

```yaml
vocabulary:
  audience:
    - id: librarian_dm
      label: 担当司書への DM
      recipient: { kind: role, role: librarian }   # そのロールの担当者
    - id: public_channel
      label: サーバの公開チャンネル
      recipient: { kind: channel }                  # 経路だけ（誰か 1 人という単位を持たない）
```

- `kind: self` … payload の `subject_key` が指す利用者本人。**INV-PATRON-005（無効化された利用者には送らない）の判定対象はこれだけ**。`subject_key` にジョブ payload から利用者 ID を取り出すキー名を書く（例: `patron_id`）。
- `kind: role` … 特定の役割の担当者。`role` に roles.md のロール ID を書く（実在は検証しない）。宛先の生存は問わない。
- `kind: channel` … 経路だけ。

実装（`app/src/operation/jobs/handlers.ts`）はこの宣言から生成された `AUDIENCE_RECIPIENT`（`app/src/domain/generated/notifications.ts`）を読むだけで、宛先種別を手で持たない。

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識 2 種（否定・線引き）のみで、各 1〜3 行。
- カタログは **1 プロジェクト 1 ファイル**（`docs/specs/backend/notifications.md`）で、`id` は `notification-catalog` 固定である（導出元となる名前が無いため。`design_token_spec` と同じ）。
- 通知 ID は **`notify_` で始まるスネークケース**とする。この接頭辞は「`effects[].do` のどれが通知か」を機械が判別する唯一の手がかりであり、命名の好みではない。

### 本人を名指すメンション(`mentions_person` / `person_from`)

**いつ使うか。** 「特定の 1 人が動いてくれないと困る」通知で、連絡用チャンネルに投げたうえでその人を `<@ユーザー ID>` で呼びたいとき。使う場面は少ない(多くの通知はチャンネルの全員が読めば足りる)ので、**語は仕組みに入れてあるが、選ぶ通知はカタログの判断で足す**。

```yaml
vocabulary:
  mention:
    - id: person                 # 綴りはアプリが決める(体系は比べない)
      label: 本人
      mentions_person: true      # この語を選んだ行は person_from を持つ

  audience:
    - id: contact_channel
      recipient: { kind: channel }
      allows_person_mention: true  # 本人を名指すメンションと組める宛先(チャンネル宛の語だけが宣言できる)

notifications:
  - id: notify_patron_example
    audience: contact_channel    # allows_person_mention: true を宣言した宛先の語だけが選べる
    mention: person
    person_from: loan.patron_id  # {集約}.{欄} — 通知を起こした集約が持つ利用者への参照の欄
```

- **機械が読むのは `mentions_person` の宣言**で、語の綴りは比べない(`job-spec-writing.md` の `in_transaction` と同じ形 — 語を選べば宣言が付いてくる)。語の綴りを体系に固定しないのは、語彙 id と同じ綴りの文字列リテラルを仕組み側に置くと W1 が落とすためである。
- **本人を名指せる宛先は、宛先の語が `allows_person_mention: true` を宣言したものだけ**である(宣言できるのはチャンネル宛の語だけ。ロール宛・本人宛では名指す相手が二重になる)。**どの宛先に個人を名指してよいかはアプリの判断**で、たとえば公開のチャンネルには宣言しない —— 宣言の無い宛先の行が本人を名指す語を選べば N0 が落とす(語の綴りは体系が比べない)。
- **`person_from`** は本人の利用者 ID の出どころである。行が宣言した集約の欄から**1 段だけ**辿る(例: `loan.patron_id` / `loan_companion.patron_id`)。欄は**利用者(実行者の集約 = `session: true`)への参照**で、**通知を起こした集約自身の欄**でなければならない —— 配送は積まれたジョブの payload(その集約の行の ID。`{集約}_id`)から欄を辿るからである。**`trigger: manual` の行は本人を名指せない**(N0 が落とす) —— 人が下書きを見て送る通知は、通知を起こした集約の行から本人を機械が引く経路に乗らないので、書いても黙って名指さずに送ってしまう。
- **消去済みの人は名指さない。** 配送は利用者行の `example_idp_user_id` が**本物の外部 ID(例では数字だけの形)で、消去済みの置換値(`{id}` = 利用者の UUID)でもない**ときだけ `<@ID>` を付ける。決まらなければ**誰も名指さずに**送る(**ロールにも落とさない**。消去した人を呼ばない・別の誰かを呼ばない)。判定は(例の)宛先の ID が名指せる形かを見る純関数(置換値の形は生成物 `personalColumns` が正)。
- **DM にはしない。** 宛先は常にチャンネルで、その中で名指すだけである(個人宛の DM をやめた 7-d の決定のまま)。送る情報に外部の利用者 ID が加わるので、外部連携の宣言(`external.md` の `sends.fields`)に載せる。**監査ログ・構造化ログには書かない**(personal)。
- **読みの席。** 本人の利用者 ID を引く口は集約ごとの型付きの読みで、実装の木の `PERSON_SOURCES` に 1 行足す(足し忘れたまま配送されれば失敗して dead letter に見える。**カタログの `person_from` の鍵と `PERSON_SOURCES` の鍵が同じ集合であること**は単体テスト `person-mention.reader.unit.test.ts` が CI で見る)。

### 1 行が宣言すること

| キー | 必須 | 意味 |
|---|---|---|
| `id` | ○ | 通知 ID。`state_spec` の `effects[].do` と同じ語彙 |
| `medium` | ○ | 送信経路。`vocabulary.medium` の語 |
| `audience` | ○ | 宛先。`vocabulary.audience` の語 |
| `mention` | ○ | メンション。`vocabulary.mention` の語 |
| `trigger` | ○ | `auto`（`effects` から自動）/ `manual`（下書きを作って人が送る）/ `schedule`（時刻で起きる走査が `emits` で積む） |
| `person_from` | △ | 本人を名指す語(`mentions_person`)を選んだ行だけが**必ず**書く。それ以外の行は書けない(`trigger: manual` の行は語そのものを選べない) |
| `summary` | ○ | 何を知らせるかを 1 行で |

### 発火元は 3 つ — `trigger` が「どれを持つか」を宣言する

通知を起こすものは 3 種類あり、`trigger` はそのどれが発火元かの宣言である。**どの通知も、宣言した発火元を持たなければ N1 が落とす**（誰にも起こされない宣言を残さない）。

| `trigger` | 発火元 | 発火元の正 | 例 |
|---|---|---|---|
| `auto` | 遷移・編集の副作用 | state_spec の `effects` / access_spec の `writes[].effects` | 返却期限の到来で司書に知らせる |
| `manual` | 人が押す | ジョブカタログの `source: manual`（下書きは `app/src/domain/announcement/`） | 対外告知 |
| `schedule` | 時刻で起きる走査 | ジョブカタログの `source: schedule` の行の **`emits`**（その走査が outbox に積む通知の ID の一覧） | 返却期限の前日に同伴の利用者へ知らせる |

- **`schedule` の通知は `effects` に現れない。** 現れたら `auto` との取り違えで N1 が落とす。遷移の通知を時刻で**積み直す**（返却期限の催促のように、遷移が積む通知を走査がもう一度積む）のは `auto` のままでよい —— 通知は `effects` から積まれ続け、走査の `emits` が積み直しを名指す（N1 はこの併載を許す）。
- **`emits` は受信 Webhook の `emits` と同じ語**である（あちらは外から届いてドメインイベントを起こし、こちらは時刻で起きて通知を積む。どちらも「何を起こすか」を名指す宣言）。
- **走査が積む行はジョブカタログにも `source: outbox` の行を持つ**（積まれたものをワーカーが実行する。J1 は「積む元が `effects` か `emits` のどちらか」で見る）。
- **同じ蔵書に 2 度送らない**ための記録（送った印）は仕様の語彙ではない。走査の実装が outbox の冪等キー（`jobs.idempotency_key`）で止めるのが既定である（列を足さない）。

### ここに書かないもの（正が割れる）

- **Webhook の URL・メンションの文字列・文面** — 運用設定（env）と文面テンプレートが持つ。原則は「**何を保証するかは仕様（固定）・値は設定（可変）**」であり、カタログが宣言するのは保証の側だけである。
- **どの遷移で飛ぶか** — `state_spec` の `effects` が正。カタログに書き写すと二重の正になる（生成物の表には N1 と同じ規則で `effects` から引いて併記される）。
- **宛先が無効化されていたら送らない等の規則** — `invariant_spec`（INV-PATRON-005）が正。

### 検証（N 群）

| ID | 何を見るか | 実行場所 |
|---|---|---|
| **N0** | スキーマ適合。`id` の固定値・`notify_` 接頭辞・通知 ID の重複・**行の 4 軸が宣言された語彙に閉じていること**・`trigger` の値域（`auto` / `manual` / `schedule`）・**`mentions_person` の語と `person_from` の対**(語を選んだ行は必ず書く・選ばない行は書けない・`{集約}.{欄}` の形・宛先の語が `allows_person_mention` を宣言している・`trigger: manual` の行は本人を名指す語を選べない) | ローダー（`lib/model/notification/loader.ts`） |
| **N1** | `effects` の `notify_*` ⇔ カタログの `trigger: auto` の**双方向**閉世界。`manual` の行が `effects` に現れないこと | `lib/notification/verifiers/n1-effect-parity.ts` |
| **N2** | `person_from` の接地。集約・欄が entity_spec に実在し、欄が利用者(実行者の集約)への参照で、通知を起こした集約(`effects` の集約 / 走査の `due_from` の集約)の欄であること | `lib/notification/verifiers/n2-person-mention.ts` |

**実装側の閉世界はテストが持つ。** 生成物 `app/src/domain/generated/notifications.ts`（カタログの機械的な写し）と、登録済みハンドラ一覧（`app/src/operation/jobs/handlers.ts` の `NOTIFICATION_HANDLERS`）を app 側のユニットテストが双方向に突き合わせる。ここまでで **仕様 → 生成物 → 実装 → 仕様** の輪が閉じ、「仕様に無い通知を送る」「仕様にある通知のハンドラが無い」「仕様と違う宛先へ送る」の 3 つがすべて機械の検出対象になる。

### 検証方法

- `npm run verify`（N0・N1・N2 が走る）
- `npm run generate`（カタログのマトリクス・ハンドブックの章・実装側の期待表を再生成）
- `cd app && npm run test`（ハンドラ ⇔ カタログの突合）

## 関連ドキュメント

- [action-spec-writing.md](./action-spec-writing.md) — 書き込み側の対になる仕様（`test_cases` の書式はこちらが正）
- [ARCH-BE-0015](../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md) — `effects` からジョブが積まれ、ハンドラが呼ばれるまでの機構
