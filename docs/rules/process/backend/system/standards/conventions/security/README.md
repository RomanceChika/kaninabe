---
id: DG-BE-0026
doc_type: directory_guide
scope: backend
norms: [PRIN-0009, PRIN-0010]
---

# process/backend/system/standards/conventions/security — セキュリティ規約

バックエンドのセキュリティ関連の規約をまとめる箱である。**現状は骨格のみで、実規約文書は 1 件も無い。** ここに文書を足すときの決まりと、いま実際にセキュリティの正がどこにあるかを示す。

配下に置く文書は要素ごとに 1 規約 1 ファイルに分け、**すべて [PRIN-0009](../../../../../../principles/common/PRIN-0009-secure-by-default.md)(Secure by Default)と [PRIN-0010](../../../../../../principles/common/PRIN-0010-least-privilege.md)(Least Privilege)を規範とする**。安全側が既定であること、権限は必要最小限であることが、この箱のすべての文書の前提である。

## 配下の文書

**(未整備)** —— 実規約文書はまだ無い。当面のあいだ、セキュリティの規範は次の場所に分散している。

| 守るもの | 正の所在 |
|---|---|
| 行の可視性(誰がどの行を読めるか) | [../queries.md](../queries.md) と、ドメイン仕様の `docs/specs/domain/{集約}/access.md`。可視性の判断は RLS が執行し、アプリ側には書かない |
| DB 側の防壁(権限・RLS・CHECK・トリガー・書き込み RPC) | [../enforcement/database-guards.md](../enforcement/database-guards.md)。コードにバグがあっても守られる層と、その既知の限界 |
| サーバー専用コードのクライアント混入防止 | [../enforcement/server-client-separation.md](../enforcement/server-client-separation.md) |
| 人間のセッションを持たない呼び出し元の認可 | [../route-handlers.md](../route-handlers.md)(共有秘密による認可) |
| 業務上の記録(監査ログ) | [../logging.md](../logging.md) と、書き込み RPC が残す `domain_events` |
| 権限の最小化 | [PRIN-0010](../../../../../../principles/common/PRIN-0010-least-privilege.md) |
| 初期値の向き(安全側を既定にする) | [PRIN-0009](../../../../../../principles/common/PRIN-0009-secure-by-default.md) |

移植元には次の 7 つの規約があったが、いずれも Go + Echo 前提の内容だったため持ち込んでいない —— SQL インジェクション対策 / エラー文言のサニタイズ / ファイルアップロード / 秘密情報の管理 / 認証 / CORS / 監査ログ。**スタックが Supabase(RLS・Auth)+ Vercel + Cloudflare に変わり、守るべき境界そのものが別物になった**ため、書き起こしが別途必要である。このうち監査ログに相当するものは上表のとおり実装済みであり、認証・認可に相当するものは Supabase Auth と RLS として architecture 側に定義がある。残りは未着手の在庫として残っている。

## テンプレートと拡張

- **すべきこと:** セキュリティ規約を足すときは、親の [conventions/template.md](../template.md) に従って `xx.md` を 1 ファイル追加し、**同時にこの README の一覧も更新する**。この箱には専用のテンプレートを置かない(扱う内容が他の規約と変わらないため)。
- **一覧の維持は義務である。** 骨格しか無い箱では、README が唯一の在庫表になる。

**norms についての記録:** 移植元の norms には `ARCH-BE-0012` が挙がっていたが、architecture 側にその実体が無く(実在するのは ARCH-BE-0001 / 0013 / 0014 / 0015 / 0016)、何を指していたのか裏取りできなかったため norms から外した。代わりに ARCH-BE-0001(層構成)を置くことはしていない —— **層の構成はセキュリティ規約の規範ではない**からである。裏取りできない参照は残さず外す、というのがこのときの判断である。セキュリティ関連の architecture 文書を新規に起こした時点で、その id をここに追加すること。
