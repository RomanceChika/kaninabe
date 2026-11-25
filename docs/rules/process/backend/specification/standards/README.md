---
doc_type: directory_guide
id: DG-BE-0007
norms: []
scope: backend
---

# process/backend/specification/standards — 仕様の書き方・基準

バックエンド仕様の **standards**——仕様書の書き方・基準・テンプレート——を置く箱。architecture の specification に対応する箱であり、あちらが「どこに置くか」を、ここが「どう書くか」を持つ。

## 配下の文書

| 文書 | 内容 |
|---|---|
| [action-spec-writing.md](./action-spec-writing.md) | Server Action 仕様(`action_spec`)の書き方。YAML スキーマ(`handles` / `input` / `errors` / `test_cases`)、仕様を薄く保つ基準、検証(A 群 A0〜A12)、テストとの双方向突合(`@tc`) |
| [query-spec-writing.md](./query-spec-writing.md) | 読み取りクエリ仕様(`query_spec`)の書き方。YAML スキーマ、「**絞り込みは UX 側が担当、可視性は RLS 側が担当**」という線引き、検証(Q 群 Q0〜Q7) |
| [notification-spec-writing.md](./notification-spec-writing.md) | 通知仕様(`notification_spec`)の書き方。通知の全数(宛先・メンション・経路・発火)、**語彙をどちらが持つか**のフレームワーク/アプリの線、検証(N 群 N0〜N2)と実装側の閉世界 |
| [config-spec-writing.md](./config-spec-writing.md) | 設定仕様(`config_spec`)の書き方。要る設定の全数・**無いとどうなるか**・連携カタログを兼ねる `used_by`、検証(K 群 K0・K1・K2)と実装の `process.env` 参照・雛形(`app/.env.example`)との閉世界 |
| [auth-spec-writing.md](./auth-spec-writing.md) | 認証フロー仕様(`auth_spec`)の書き方。サインインの**決定表**(状況 → 着地・実行する操作)、なぜ手順の列にしないか、画面の出し分けとの双方向、検証(H 群 H0〜H3)と生成物を回す実装側の突合 |
| [job-spec-writing.md](./job-spec-writing.md) | ジョブ仕様(`job_spec`)の書き方。人手なしで動くものの全数(イベントで積まれる outbox / 時刻で起きる schedule)、**発火時刻の供給元**の宣言、検証(J 群 J0・J1・J2)と Cron の登録・実装との閉世界 |

## 参照するもの

| 知りたいこと | 正の場所 |
|---|---|
| 仕様書の配置・構成 | [ARCH-SP-BE-0001](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) |
| 作成・更新の手順 | [specification/playbooks/](../playbooks/README.md) と [process/common/](../../../common/README.md)(特に [domain-spec-change.md](../../../common/specification/playbooks/domain-spec-change.md)) |
| 実装のきまり | [system/standards/](../../system/standards/README.md)(`conventions/` と `layers/`) |

**どこに何を置くか(`actions/` / `queries/`、および必要になったときに足す種別)は ARCH-SP-BE-0001 に従う。ここでは再定義しない。** 同じ配置規則が 2 か所にあると、片方だけ直された時点でどちらが正か分からなくなる。

## 整備方針

**必要になった文書から追加する。先回りして箱だけ作らない。** 仕様種別ごとの書き方(api / data / domain など)も、その種別の仕様を実際に書く必要が生じた時点で足す。空の基準文書は、読む側に「ここに何かあるはずだ」という誤った期待だけを残す。

**`layers`(`domain` / `operation` / `composition` / `infrastructure` / `presentation`)はこの箱に置かない。** 層は実装の話であり、置き場所は [system/standards/layers/](../../system/standards/layers/README.md) である。この排除規範がこの箱の境界そのものであり、これが緩むと specification と system の線が消える。
