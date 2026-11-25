---
doc_type: process
scope: common
norms: [PRIN-0007]
---

# 依存の脆弱性の受け入れ表

`npm run deps:check` が**直さずに受け入れる**と決めた指摘を読む表である。表にあって見直しの期限内のものは赤にしない。**期限切れは赤**(重大度が低くても赤 = 見直しを強制する)。

## 目的・スコープ

- **目的:** 脆弱性の指摘のうち、到達できない・本番の構成で露出しない・修正版がまだ無い、などの理由で直さないものを、**理由と見直しの期限つき**で残す。黙って無視する穴を作らない。公開から日の浅い版(公開から 7 日未満)を、緊急の修正のために理由つきで通す例外もここに書く。
- **スコープ:** その製品の全 lockfile(ルート・ワークスペース外の道具・docs など)。検査の本体は `legacy/spec-tools/lib/deps/`、入口は `npm run deps:check`、設計の正は依存の脆弱性への対応の設計メモ。

## ルール

- **すべきこと:** 受け入れる指摘ごとに下の表へ 1 行足す。列は `種別 | 対象 | パッケージ | 版 | 前提 | 理由 | 見直しの期限`。
  - 種別 `advisory` … 対象は advisory の ID(GHSA・CVE。別名にも当たる)。パッケージは名前か `*`。**版は受け入れる版の全部**を、正確な版(`1.2.3` の形)のカンマ区切りで書く(例 `2.3.2, 4.0.7`)。**`*`・範囲(`^1.2.3`)・空は書けない**(書いた行は採らず赤)。同じ advisory でも**書いていない版の指摘は赤のまま**(受け入れの理由は「その版に届くか」を確かめた結果で、あとから入った別の版まで黙って覆わない)。版を言わない出どころ(`npm audit`)の指摘は、lockfile にあるその名前の版ごとに分けて当てる。
  - 種別 `cooldown` … 対象は **1 つの版**(`1.2.3` の形。プレリリースの `-rc.1` などは可)。パッケージは **名前 1 つ**(スコープつき可)。版の欄は**対象と同じ 1 つの版**を書く(違えば行を採らず赤)。**`*`・範囲(`^1.2.3`)・タグ(`latest`)は書けない**(書いた行は採らず赤。`* / *` の 1 行で全部の部品の待ちが外れ、出荷の関門の 7 日の待ちが恒久に効かなくなるため)。
    見直しの期限は**今日から数えて 7 日以内**(公開から 7 日の待ちと同じ日数。待ちを過ぎた版はもう指摘に出ないので、それより長い期限は要らない)。表に足した日の列は無いので、advisory と同じく `deps:check` を回す日から数える。超えた行は赤。
  - 前提 … その受け入れが**今の木で真のときだけ成り立つ条件**の名前。書ける名前は閉じた表(`legacy/spec-tools/lib/deps/types.ts` の `PREMISE_NAMES`)のものだけで、カンマで並べる。前提が無ければ `-` と書く。**知らない名前・空の欄の行は採らず赤**(受け入れは fail-closed)。`deps:check` が見るのは**名前だけ**で、条件そのものは開発用リポジトリの前提のテスト(accept-premises。pre-commit の `test:spec-tools`(docs の変更)と `test:dev-repo`(app の変更)、merge-check が回す)が、**その前提を持つ期限内の行があるときだけ**照らす。名前を閉じた表に足したら、同じコミットで照らし手も足す(照らし手の無い前提を持つ期限内の行は赤)。
    - `next-config-no-images` … 製品の next.config に、画像の照合のパターンの出どころ(`images` と `assetPrefix`)を書けない。持ち主は J2(next.config の既定の export の鍵を構文木で許可表 `NEXT_CONFIG_ALLOWED_KEYS` の中だけに閉じる。`legacy/spec-tools/lib/job/frame-config-keys.ts`・`lib/targets/nextjs/layout.ts`)で、照らし手は J2 を指すだけ: 許可表にどちらの鍵も無いこと、J2 が製品の next.config の全部を走査すること(製品の根の宣言と後段の選択から導く)、pre-commit と merge-check の両方でその next.config を変えたときに verify の段が回ること(コミットの段の表の条件を走り手と同じ評価に掛ける)。どれかが崩れれば赤。
  - 理由は具体的に(「到達不能: 該当の関数を呼ばない」など)。見直しの期限は `YYYY-MM-DD`(その日まで有効。日付は UTC で比べるので、日本時間では翌日の 09:00 まで)。
- **してはいけないこと:** 理由の空欄・実在しない日付・種別の綴り違いの行。読めない行は**採らず**、`deps:check` が赤で名指す(受け入れは fail-closed)。高い重大度を長い期限で受け入れない — 見直しの期限は**今日から数えて**[dependency-patch-policy.md](./dependency-patch-policy.md) の重大度ごとの期限を超えられず(critical 3 日・high 7 日・moderate 30 日・low 90 日)、超えた行は `deps:check` が赤にする。
- 表に当たる指摘が今回出なかった行は、`deps:check` が「不要なら消す」と注記する。

### 受け入れ表

| 種別 | 対象 | パッケージ | 版 | 前提 | 理由 | 見直しの期限 |
|---|---|---|---|---|---|---|
| advisory | GHSA-3g3m-2fjr-6pw4 | glob | 11.1.0 | - | 中断の信号を渡さず、パターンも外から届かないので到達不能: 非同期の走査を AbortSignal で止めても裏で読み続ける話(可用性)。対象は docs の glob 11.1.0 のみで、使うのは vitepress-sidebar だけ。呼び方は同期の `globSync('**', { cwd, maxDepth: 1, ignore })` で signal を渡さず、パターンは `**` と docs の設定の定数(`excludeByGlobPattern`)だけ。走るのは手元の `vitepress dev` / `build` の設定の読み込みのとき。2026-11-12 に確認 | 2026-12-12 |
| advisory | GHSA-g3hv-75wg-m249 | minimatch | 10.2.6 | - | パターンが外から届かないので到達不能: 細工したパターンで前処理が膨らむ話(`optimizationLevel` 2 以上のとき)。全 lockfile の minimatch 10.2.6 が対象: docs は glob(vitepress-sidebar)経由でパターンは `**` と設定の定数だけ。ルートと spec-tools は `@typescript-eslint/typescript-estree` 経由で、パターンは ESLint の設定の `allowDefaultProject`(リポジトリの定数)だけ、かつ `minimatch()` の既定の `optimizationLevel` は 1 で該当の処理に入らない。照らされる側はファイルのパスで、パターンにはならない。2026-11-12 に確認 | 2026-12-12 |
| advisory | GHSA-238p-pmpm-9mq7 | katex | 0.16.47 | - | low・前提が成り立たない: 既に prototype pollution がある画面で KaTeX が継いだ `trust` を読む話(攻撃者の数式と、出力を無害化せずに差し込むことが要る)。対象は docs の katex 0.16.47 のみ(mermaid 11.17.2 の依存。修正は mermaid 12 系)。数式を含む図はリポジトリの md だけで外の入力を描かず、mermaid は `securityLevel: 'strict'`。2026-11-12 に確認 | 2026-12-12 |

## 検証方法

```bash
npm run deps:check      # 表を当てた結果を 1 画面で出し、作業置き場の deps-check/latest.json に残す
npm run test:spec-tools # 表の読み取り・期限・当てはめは legacy/spec-tools/__tests__/unit/deps/ の表駆動テスト
```

合格条件は、赤が 0 件であること(期限内の受け入れは赤にならない)。表の中身の妥当性(理由が本当か)は機械で確かめられないので、見直しの期限の日にレビューで見る。

## 関連ドキュメント

- [dependency-patch-policy.md](./dependency-patch-policy.md) — 重大度ごとの直す期限と push の判断・SBOM
- [scripts-code-quality.md](./scripts-code-quality.md) — 検査コードの規約
