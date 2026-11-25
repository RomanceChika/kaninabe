---
doc_type: directory_guide
id: DG-0010
norms: []
scope: common
---

# プロジェクト横断の決定（common）

**この階層が持つのは、バックエンド・フロントエンドの両方に影響する決定と、開発プロセス全体に関わる決定である。** 片方の層にしか効かない決定は [backend](../backend/README.md) / [frontend](../frontend/README.md) に置く。

一覧は**時系列とカテゴリの 2 軸で維持する**。ADR を 1 件足したら、下の「全決定（時系列）」の表と「カテゴリ別」の節の**両方**に追記する。片方だけ書くと、その ADR はもう片方の読み方をしている人から見えなくなる。

## 全決定（時系列）

| ID | タイトル | Status | 日付 | 概要 |
|---|---|---|---|---|
| [ADR-0001](./ADR-0001-adopt-adr.md) | ADR の採用 | accepted | 2026-02-09 | 意思決定の記録に ADR を採用する |
| [ADR-0002](./ADR-0002-legal-structure-documentation.md) | 法律的階層構造によるドキュメント体系の再構築 | accepted | 2026-02-09 | 肥大化した規約群の問題を、法律的な階層構造で解く |
| [ADR-0003](./ADR-0003-constrained-spec-dsl.md) | 仕様DSLの表現力を意図的に制限し、列挙ベース検証を採用する | accepted | 2026-08-06 | 表現力を絞って決定可能性を買う取引。全検証を列挙ベースで実装する。`invariant` は v1 では執行点の宣言とテスト義務までに限定する |
| [ADR-0004](./ADR-0004-generated-transition-table-engine.md) | 遷移テーブル生成 + 汎用エンジン方式 | accepted | 2026-08-06 | 仕様と実装の乖離は突合ではなく構造で排除する。帰結として Server Action が定型化される |
| [ADR-0005](./ADR-0005-single-entry-point.md) | ディレクトリの入口を README.md ひとつに統一する（AI.md の廃止） | accepted | 2026-08-06 | 二重入口は腐る場所が 2 つあるということで、SoT 違反である。AI 向けナビは README 内の節へ統合する |
| [ADR-0006](./ADR-0006-commit-generated-artifacts.md) | 仕様からの生成物をリポジトリにコミットし、鮮度を CI で検証する | accepted | 2026-08-06 | 狙いはレビューでの差分可視性と、製品ビルドの生成器非依存化。対価は `generate:check` の CI 必須化 |
| [ADR-0007](./ADR-0007-vercel-centralized-compute.md) | 計算は Vercel に一元化し、他ランタイムは昇格条件付きで温存する | accepted | 2026-08-06 | ランタイムが分裂するとテスト戦略と仕様突合が分割される。既定方針として Edge Functions・Workers は使わない |
| [ADR-0008](./ADR-0008-snapshot-mapping-declaration.md) | スナップショットの写像を DSL に載せ、写像先の列の覆いを検査する | accepted | 2026-08-27 | 公開時Fix の代償（公開側に列を足しても鳴らない）を V12 で塞ぐ。書けるのは列の対応表だけで式は書けない |
| [ADR-0009](./ADR-0009-retire-audience-key.md) | フロントマターの `audience` キーを廃止する（ADR-0005 の追補） | accepted | 2026-09-04 | `audience` は検証器（M1）が一度も読まない死語彙だったため廃止する。ADR-0005 の単一入口の決定自体はそのまま継承する |
| [ADR-0010](./ADR-0010-pg-cron-vercel-trigger.md) | 10 分間隔のジョブは Supabase pg_cron + pg_net から Vercel の口を叩く（Vercel Cron は日次のみ） | accepted | 2026-09-06 | Vercel Hobby の Cron は 1 日 1 回までしか登録できない（実測）。job_spec に `runner` 軸を足し、頻度が要る 2 本だけ pg_cron + pg_net に逃がす。計算は Vercel のまま変えない |
| [ADR-0011](./ADR-0011-usecase-layer-two-origins.md) | 起点は 2 つ — 正しさはドメイン、手軽さはユースケース。衝突は 3 段で解く | accepted | 2026-09-08 | 人の認知が仕様に無かった。usecase_spec(操作を組み合わせるだけ)を足し、保存点 = 1 tx、衝突は「見せ方 → 粒度 → 制約(人)」の順 |
| [ADR-0012](./ADR-0012-db-as-authority.md) | DB を権威にする — 規則の執行点は RPC に生成し、TS の判定は同じ仕様から生成した先読みにする | accepted | 2026-09-11 | 複合 RPC の経路が operation の手書き部分を通らない継ぎ目を、検査で塞ぐのではなく無くす。④ operation の生成 → ⑤ RPC 本文の生成(ガード・ロール)→ 不変条件を DB へ → 一致の証明を生成 |
| [ADR-0013](./ADR-0013-framework-runtime-package.md) | 仕組みの実行時コードを workspace パッケージへ出す — 束ねるのは framework と product であって app と docs ではない | accepted | 2026-09-27 | 依存の向きは既に一方通行だったが、仕組みの実行時コードが製品の木に住んでいたため通し実行と検証器が実物を借りていた。`@kaninabe/runtime` / `@kaninabe/lint-config` に出し、土台の宣言に `root` の軸を足す。ARCH-BE-0001 の「app と docs を束ねない」を改める(docs は入れない) |
| [ADR-0014](./ADR-0014-composite-enforces.md) | `composite` の関数が「どの `writes` の規則の執行点か」を宣言する — `functions[].enforces` | accepted | 2026-10-02 | 一括の並べ替えなど `shape: update` に乗らない手書き RPC が守る `writes` の規則が宣言のどこにも無く、A18 の警告に人の取る道が無かった。`composite` の関数にだけ `enforces`(規則の名指し + 見張りテストの id)を足し、T18 が書き間違いを落とす。`composite` の本文の意味は突き合わせない(見張りテストが担う) |
| [ADR-0015](./ADR-0015-layout-component-kind.md) | `screen_spec` の `layout` の部品が「生成物か・どの操作を載せるか」を宣言する — `kind` / `action` | accepted | 2026-10-02 | 層 (b) の「どの部品がどの操作のフォームか」を書く場所が無く、生成物と手書きの境が部品名の綴りにしか無かった。部品に `kind: form` と `action`(載せる操作 1 つ)を足し、`kind` を書かない部品は手書きの既定のままにする(免除の語は作らない)。S17 が操作の実在・作成か編集か・1 部品 1 操作・重複を落とす |
| [ADR-0016](./ADR-0016-entity-display-field.md) | `entity_spec` が「行を人に名指す欄」を宣言する — `display_field` | accepted | 2026-10-03 | 確認文に行の名前を出す口が仕様に無く(束 4 で退行として受理)、名前の欄は集約ごとに綴りが違って規約から導けない。entity_spec に任意の `display_field`(`fields` に居る string / text の欄 1 つ)を足し、V22 が実在と型を・S18 が選択肢の読みの第 2 列との一致を見る。確認文は `「{名前}」{見出し}。{注意書き}` |
| [ADR-0017](./ADR-0017-http-entry-declarations.md) | HTTP の入口の宣言の置き場 — 認証の `callback` と外部連携の `endpoints` | accepted | 2026-10-08 | 手書きの Route Handler(OAuth の帰り道・AI の逐次配信の口)を宣言する置き場が無く、宣言の無い口を足しても検査が緑だった。auth_spec に任意の `callback`、送信の連携に任意の `endpoints`(URL だけ)を足し、J2 の続きが衝突と閉世界(全ての `route.ts` が宣言のどれかに当たる)を error で見る |
| [ADR-0018](./ADR-0018-role-claim-state-values.md) | 役の `claim` に state / enum の値の集合を書き、`implies` を述語にも効かせる | accepted | 2026-10-18 | 実行者の行の状態(有効メンバーか・カードが有効か)でロール全体を絞る書き方が無く、`when` の迂回は作成にしか効かなかった。`claim: {entity}.{field} == {値}` / `in [{値}, …]` を `kind: authenticated_default` との併記も含め許し(E1)、`claim` を持つロール(行の条件)を `implies` している側の述語を「自分の根拠 AND 含意の先の行の条件」にする(E2)。V11 が型・session・値域を見る。宣言しなければ生成物は不変 |
| [ADR-0019](./ADR-0019-platform-ops.md) | 認証基盤の操作を画面から叩く — auth_spec の `platform_ops` と画面の第 3 の露出口 | accepted | 2026-10-23 | 画面の操作は「ドメインイベントか予約 ID」に決め打ちで、セッションの一覧・終了のような認証基盤の操作を書けなかった(案 A のドメインの写しは宣言が実体を写さず却下)。auth_spec に閉じた一覧 `platform_ops`(`kind` read/do・`actor` 本人/ロール・`from: row` だけの識別子・`shapes` の閉じた欄・`confirm`・`binding`)を足し、画面は `usecases:` と並ぶ `platform_ops:` と部品 `platform_read` / `platform_actions` で参照する。H9・S20・S21 が見る。宣言しなければ不変 |

## カテゴリ別

カテゴリの語彙は Documentation / Project Structure / Specification / Verification / Development Process / Tooling / Infrastructure である。**該当が無いカテゴリも節ごと残し、「（まだありません）」と書く。** 空であることが分かる状態を保つためで、節ごと消すと「まだ決めていない」と「決めたが書き漏らした」の区別が付かなくなる。

### Documentation

- **ADR-0001** — 論点は「なぜ ADR を使うか」と「どう運用するか」の 2 つ。
- **ADR-0002** — 規約群に生じていた 4 つの問題（肥大化 / 視認性の低下 / 整合性の崩れ / AI 参照の見落とし）に対し、10〜50 の法律的階層構造を採る。
- **ADR-0005** — 背景は、AI 導入初期の名残で README（人間向け）と AI.md（AI 向け）の二重入口が存在していたこと。AI.md を廃止し、AI 向けナビは README 内の節として存続させる。
- **ADR-0009** — ADR-0005 が「非入口文書では有効」と残した `audience` キーは、検証器も読み手も無い死語彙だったと判明したため廃止する。

### Project Structure

- **ADR-0002** — 文書体系そのものの再構築なので、Documentation と Project Structure の両方に載る。

### Specification / Verification

- **ADR-0003** — チューリング完全な記述を許さない方針。記述できるのは有限の状態・イベント・ロール・制限式だけに限る。効果は全検証の決定可能性の確保である。
- **ADR-0004** — 遷移ロジックを手書きする場所そのものを作らない設計。効果は仕様と実装の乖離を構造的に排除できることである。
- **ADR-0008** — ADR-0003 の適用範囲をわずかに広げる唯一の決定。買ったのは「公開側集約の列の覆いを検査できること」だけで、式は依然として書けない（決定可能性は無傷）。
- **ADR-0014** — data_table の `functions[]` に `enforces` を足す。書けるのは `kind: rpc` + `shape: composite` の関数だけで、`writes` の規則を `by` で名指し + 見張りテストの id を必須にする(`when` / `fields` は写さない)。A18 は名指された規則を執行点として数え、T18 が規則・見張りテストの実在と執行点の一意性を error で見る。代償は、`composite` の本文の意味を突き合わせないこと。
- **ADR-0015** — `screen_spec` の `layout` の部品に `kind`(閉じた値域。いまは `form` だけ)と `action`(載せる操作 1 つ。screen の `actions` に居る作成か編集)を足す。`kind` を書かない部品は手書き(既定。免除の語は作らない)。S17 が `action` の実在・形・1 部品 1 操作・重複を error で見る。代償は、実例が 1 製品の中の複数画面で手順 3 の数え方では 1 実例であること(層 (b) の設計決定が要求するため導入)。
- **ADR-0016** — entity_spec のトップレベルに任意の `display_field`(`fields` に居る string / text の欄 1 つ)を足す。V22 が実在・型を、S18 が選択肢の読みの第 2 列との一致を error で見る。生成の確認文が行の名前を引く(client 側で行から)。代償は、実例が 1 製品の中の 9 集約で手順 3 の数え方では 1 実例であること(退行を戻すため導入。2 つ目の製品で再点検)と、1 集約に名前の欄が 1 つしか持てないこと。同時に入れた `confirmNotes` / `emptyOptionLabel` / `.empty` は DSL を足さない層 (c) の口。
- **ADR-0017** — HTTP の入口の宣言の置き場を 2 つ足す: auth_spec の任意の `callback`(`endpoint` + `summary`)と、`direction: outbound` の外部連携の任意の `endpoints`(URL のリスト)。J2 の続きが衝突と閉世界(実装の木の全ての `route.ts` がジョブの `endpoint`・受信口・`callback`・`endpoints` のどれかに当たる)を error で見る。代償は、実例が同じ製品の中の 2 種類(認証と外部連携)であること(2 つ目の製品で再点検)と、宣言が見るのは口の分類までで口が連携を本当に呼んでいるかは見ないこと。
- **ADR-0018** — role_spec の `claim` に state / enum の値の集合(`== {値}` / `in [{値}, …]`)を許し、`kind: authenticated_default` との併記も許す(E1)。`implies` の先に `claim` があれば、元のロールの述語は「自分の根拠 AND 含意の先の行の条件」になる(E2。RPC は行の条件の EXISTS・RLS は補助関数の呼び出し)。V11 が欄の型・`session: true`・値域を error で見る。代償は、`implies` の読み方が条件を持つロールにだけ強まることと、実例が同じ doc_type の独立した 2 題材(別プロジェクトの再現ではない)であること。
- **ADR-0019** — auth_spec に任意の節 `platform_ops`(認証基盤の操作の閉じた一覧)を足し、画面は `platform_ops:`(第 3 の露出口)と部品 `platform_read` / `platform_actions` で参照する。識別子は `from: row` の欄だけ・返す欄は `shapes` の閉じた欄の集合。H9(宣言の閉世界)・S20(画面側)・S21(UI 到達の網羅)が error で見る。案 A(セッションをドメインの集約に見せる)は宣言が実体を写さないので却下。

### Development Process

（まだありません）

実運用では、ビルダー×レビュアー体制（設計凍結 → 実装 → 独立レビュー → 裁定）、3 台帳の分業（`NOTES.md` / `BACKLOG.md` / `review-queue.md`）、「わざと壊す確認」による検査自体の検査、`.claude/skills/` の 3 スキル（add-operation / add-query / add-screen）といったプロセス上の決定が確立しているが、ADR にはなっていない。ここは記録漏れである。

### Tooling

- **ADR-0006** — ADR-0004 が残した未決事項の確定にあたる。レビューでの差分可視性と、生成器に依存しないビルドを両取りする選択で、担保手段は `generate:check` の CI 必須化による鮮度確認である。

### Infrastructure

- **ADR-0007** — 対象は Supabase Edge Functions と Cloudflare Workers。既定方針は不使用。理由はランタイムの分裂がテスト戦略と仕様突合の分割を招くこと。昇格条件を明示した上で温存する。
- **ADR-0010** — ADR-0007 の既定方針(計算は Vercel に一元化)は変えず、Vercel Hobby の Cron 頻度制約(1 日 1 回まで)だけを Supabase pg_cron + pg_net(HTTP を叩くだけのトリガ)で吸収する。job_spec に `runner` 軸を追加し、J2〜J4 で機械検査する。
- **ADR-0011** — ドメイン(正しさ)の上にユースケース(手軽さ)の層を置く。ユースケースは操作を組み合わせるだけで定義し直せない。保存点 = 生成した複合 RPC 1 tx。衝突は見せ方 → 粒度 → 制約(人)の 3 段。
- **ADR-0012** — 規則の執行点を RPC の本文に生成し(ガード・ロールの束縛・不変条件のコミット時評価)、DB を権威にする。TS の engine は同じ仕様から生成した先読み。operation も生成し(④)、手書きは宣言された例外(hooks)だけに。2 つの評価器の一致は仕様から生成したテストで証明する。順序は ④ → ⑤ → 不変条件の DB 化 → 一致の証明。`composition` は `composition` に改名。
- **ADR-0013** — 仕組みの実行時コード(評価器・実行計画の型)と lint 規則を workspace パッケージ(`@kaninabe/runtime` / `@kaninabe/lint-config`)へ出す。束ねるのは framework と product で、`docs` は入れない(製品のビルドに検査器のツールチェーンを混ぜない = ARCH-BE-0001 が守っていたもの)。`.ts` をそのまま配り `"type": "module"` は書かない(移動の差分を移動だけに保つ)。土台の宣言に `root: product | framework` の軸。仕様を読まない生成器(`plan-types`)はパッケージの手書きへ。

## 新しい ADR の追加方法

1. 次の番号を確認する。

   ```bash
   ls docs/rules/decisions/common/ADR-*.md | tail -1
   # → ADR-0007-vercel-centralized-compute.md なので、次は ADR-0008
   ```

2. テンプレートをコピーする。

   ```bash
   cp docs/rules/decisions/common/template.md \
      docs/rules/decisions/common/ADR-0008-my-decision.md
   ```

3. このファイルを更新する。「全決定（時系列）」の表に 1 行足し、「カテゴリ別」の該当する節にも足す。**両方に書くのが一覧の維持義務である。**

## 関連リンク

- [../README.md](../README.md) — ADR の書き方ガイド（ID・Status・参照方法の正）
- [template.md](./template.md) — ADR テンプレート
