---
doc_type: directory_guide
id: DG-FE-0011
norms: []
scope: frontend
---

# process / frontend / system / standards / conventions

フロントエンドのコードを書くうえでの**共通規約**の置き場。

**規約は要素ごとに 1 文書へ分割する。** テストとスタイルと命名は変わる速さも読む場面も違い、1 枚に混ぜると片方の更新でもう片方を読み直させることになる。

**例外は E2E スモークの規約である。独立した文書にせず、[screen-test.md](./screen-test.md) の「E2E スモーク」の節に置く。** 理由は 2 つで、スモークは 1 本しか無いこと、そして判断の中身が「screenTest では何が見られないか」の裏返しであることによる。離すと、読む順序(何を screenTest で確かめ、残りをどこで拾うか)が壊れる。

## 配下の文書

| 文書 | 何を定めるか |
|------|------------|
| [screen-test.md](./screen-test.md) | 画面テスト(screenTest)。ブラウザも jsdom も使わず **RSC を関数として直接呼び出す**方式。**E2E スモーク(1 本)の規約もこの文書の「E2E スモーク」の節にある** |
| [action-runner.md](./action-runner.md) | Server Action を実行するクライアント部品の共通実行器(`useActionRunner` / `ActionButton` / `ActionForm`)。送信・pending・拒否の表示・成功後の遷移を 1 箇所に固定し、`src/app/**` から Server Action を直接呼ぶことを禁じる(S4) |
| [navigation.md](./navigation.md) | 遷移(ナビゲーションのリンク)の表示条件 = 行き先の画面の入場条件。共通部品 `NavLink`(`@/components/nav-link`)が生成物 `navigation-visibility.ts` と券(`SessionProfile`)を掛け合わせて出し分け、`href` の文字列リテラル直書きを禁じる(U10) |
| [styling.md](./styling.md) | スタイル。デザイントークン(`design_token_spec`)と CSS Modules。生値の直書き禁止(G1)/ トークン名の実在(G2)/ コントラスト(G3)/ `style` 属性の禁止(G4) |
| [book-previews.md](./book-previews.md) | ハンドブックに載る「実物」= 実装を偽データで描いた **SSR プレビュー**の書き出しと**鮮度**(C11)。画面の見た目に関わるものを触ったら 2 コマンドで書き直す。免除は無い |
| [wording.md](./wording.md) | 拒否(`ActionError`)の文言と「いまできること」(`NextActions`)。文言の出どころは3つ(`otherwise_forbidden` / ロールの `label` / 欄の `label` / `statement`)だけで、見出し・本文に機械の分類名を書くことを禁じる(U11) |
| [template.md](./template.md) | このディレクトリに新しい規約を足すときの型紙 |

## UI テストの先送り（解消済み）

UI のテスト規約は長く先送りされていたが、いまは**二層**で確定している。どちらも実物と併走して設計した——先に規約を書いて後から画面を合わせるのではなく、動く画面を見ながら「機械に何が言えるか」を決めた。

### 一層目: screenTest（Phase C-3。実物 4 画面と併走して設計）

手法は **RSC を関数として直接呼び出す**こと。確かめるのは 4 点である。

1. 宣言した部品が実際に描かれているか
2. 排他表示(同時に出てはいけないものが出ていないか)
3. 入場の関門(入れるべき人だけが入れるか)
4. 遷移先(宣言したリンク先を指しているか)

### 二層目: ブラウザ実行層（Phase C-6）

screenTest が**原理的に見られない 4 種**だけを、貫通シナリオ 1 本の E2E スモークで回収する。**これ以外を E2E に持ち込まない。**

1. 実フォーム送信
2. 押した結果の遷移
3. 重ね表示の開いた状態
4. クライアント操作後の状態

実行は `cd app && npm run test:e2e`。

### スタイル（視覚層 V1。実物 9 画面と併走して設計）

スタイル規約も整備済みである(styling.md)。論理層で守っている「状態名を手書きしない」を、視覚層では「色と px を手書きしない」として再演する。トークンの実値の正は [docs/specs/frontend/design/tokens.md](../../../../../../specs/frontend/design/tokens.md) にあり、実装が引くのは生成された写像だけである。

### まだ書いていない規約

**フォーム・データ取得の規約は未整備である。実物が出た時点で書き起こす。** これは怠慢ではなく方針で、実物の無い規約は最初の実装で必ず書き直しになる。エラー表示(拒否の文言)は wording.md で書き起こし済み(2026-09-08。ADR-0011 ⑯d)。

移植元には **test-style / form-handling / file-organization / data-fetching / error-handling / styling / naming / i18n の 8 規約**があったが、参考リポジトリ固有の実装(styled-components、独自の screenTest ライブラリ、`domain/cmpNavigatorApi/` など)に強く依存していたため移植していない。**製品の Next.js 構成に合わせて書き起こすこと。** この 8 本のうち styling / error-handling(wording.md 相当)は書き起こし済みで、test-style は screen-test.md が相当する。

## 参照するもの

- **画面仕様の YAML 構造** — [screen-spec-writing.md](../../../specification/standards/screen-spec-writing.md)。`screen_spec` / `chrome_spec` のスキーマと検査 S0〜S10 の正はここ
- **UX の機械検査** — [ux-lint.md](../../../specification/standards/ux-lint.md)(U 群。すべて warning)
- **仕様 ↔ テストの対応(`@spec` / `@tc`)** — [action-spec-writing.md](../../../../backend/specification/standards/action-spec-writing.md) の test_cases の節。frontend 側には置いていない
- **画面仕様の実体** — `docs/specs/frontend/screens/`(雛形は [template.screen_spec.md](../../../../../../specs/frontend/screens/template.screen_spec.md))
- **テスト戦略の判断背景** — [decisions/frontend/](../../../../../decisions/frontend/README.md) の ADR-FE-0001。**未整備であり、E2E の線引きの判断はいまのところ本 README と screen-test.md に書かれたままである**
