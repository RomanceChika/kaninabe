---
doc_type: process
scope: common
norms: [PRIN-0001, PRIN-0006, PRIN-0007]
---

# コード記述例集(docs/book/examples.html)の印の文法

独自記法(5 形の設定・query の写像・screen の testid・保証の見張りテスト・通知の 3 行 …)の
「書き方の例」を集めたハンドブックの章(`docs/book/examples.html`)が、実コード・実仕様から
抜粋を切り出すための規約。

## 目的・スコープ

- **目的:** 例は手で書き写した瞬間から腐り始める(実装が変わっても例は変わらない)。実コードに印を
  置き、生成のたびに機械的に切り出すことで、鮮度を `npm run generate:check` に守らせる
  (PRIN-0007 — 「書き方」の正はコード自身であり、章はその写しでしかない)。
- **スコープ:** `docs/book/examples.html` 1 章だけの規約。切り出し器の実体は
  [`code-examples.ts`](../../../../../../legacy/spec-tools/lib/generate/render/code-examples.ts)、章の組み立ては
  [`examples-page.ts`](../../../../../../legacy/spec-tools/lib/generate/render/book/examples-page.ts) 一式が正。
  他の章が標識を引用する仕組み(`signpostQuotes`)は
  [chapters.ts](../../../../../../legacy/spec-tools/lib/generate/render/book/chapters.ts) が正であり、対象外。

## ルール

- **すべきこと: TypeScript は `// #region example:{name}` 〜 `// #endregion`、SQL は
  `-- #region example:{name}` 〜 `-- #endregion` で印を置く。** `{name}` は英数字とハイフン・
  アンダースコアだけ(`[a-zA-Z0-9][a-zA-Z0-9_-]*`)。ファイルをまたいで一意である必要はない
  (章の側が「どのファイルの、どの名前か」の組で引く)。印はコメント行だけで構成し、
  **囲まれたコードの意味を変えてはならない**(足す・消すことがレビュー差分として無害であること)。
- **してはいけないこと: 印を入れ子にする。** 1 つの `#region` が閉じる前に次の `#region` を開かない。
- **すべきこと: 仕様 md(`docs/specs/**/*.md`)は印を持たず、`### ` 見出し(レベルは問わない)を
  アンカーにする。** 見出し行自身から、次に現れる**同じか浅いレベル**の見出しの直前まで(無ければ
  EOF まで)が 1 つの節になる。見出しテキストは完全一致で引く。見出しを持たない手書きの段落
  (標識)を引きたいときは、含む部分文字列で `prose.ts` の `collectSigns` の結果から探す。
  仕様 md も印の走査の対象に入れてあるので、うっかり置いた印は「未参照の印」として鳴る。
- **してはいけないこと: 1 例(印の中身・見出しの節・標識 1 段落)を 40 行より長くする。**
  超えたら `npm run generate` / `generate:check` がエラーで止まる(`MAX_EXAMPLE_LINES`)。
  長い例が要るなら印の置き場所を変えるか、例を分ける(定型の全体ではなく、判断が乗る核だけを
  抜き出す)。
- **すべきこと: 印は消してよいが、章のカタログも同時に直す。** コードを書き換えるときに印
  (`#region` / `#endregion` コメント)を消しても構わない。ただし印を消した瞬間その例は
  「実体が無いのに章が参照している」状態になり、`npm run generate` が**未解決の印**として
  エラーにする。直す方法は 2 つ —— 印を復元するか、章のカタログ(`examples-page-catalog*.ts`)
  からその例を削る。逆に、印を置いたのにどの例からも参照されていない場合も
  **未参照の印**としてエラーになる。サイレントに古い抜粋が残り続けることも、
  使われない印が増え続けることも無い。
- **してはいけないこと: 印を置いてよいファイルの一覧を、どこかに書く。**
  **索引は誰も持たない** —— 印が置かれている事実はファイルの側にあるので、`code-examples.ts` の
  `scanExampleSourceFiles()` が `app/src` / `supabase/migrations` / `docs/specs` の 3 つの木を
  走査して母集合を導く(束 ⑲-3)。**走査する拡張子は `.ts` / `.tsx` / `.sql` / `.md` の値域**であり、
  それ以外(`.css` / `.json` / `.mjs` 等)に置いた印は母集合に入らない(印を置ける場所はこの 4 種だけ)。一覧を人が書くと 2 つの形で壊れる —— 体系側(生成器)に置けば
  別のリポジトリのハンドブックにこちらのアプリのコードが載り(束 ⑱ の題材 B が実測: 953 行が
  丸ごと題材の製品だった)、この規約文書に置けば `docs/rules/` を持たないリポジトリがこの章を
  構造的に持てない(束 ⑲-1 の独立レビュー 4-A)。どちらも PRIN-0006「免除リストを持たない」に
  反する。**印が 1 つも無いリポジトリではこの章を生成しない**(欠落ではなく「まだ例を持って
  いない」である)。
- **してはいけないこと: 題材を集約ごとに増やす。** 走査が母集合を導くようになっても、
  「どのファイルのどこを、どの順で、どんな文で繋ぐか」を決めるのは章のカタログ
  (`examples-page-catalog*.ts`)である。現在の題材は 1 つの操作(`loan.check_out`)と 1 つの読み取り
  (`loan_own_list`)に絞ってある —— 複数の集約から少しずつ集めると、章が「このアプリの
  コードツアー」になり、独自記法の見本という目的から外れる。題材を増やす前に、既存の題材で
  表現できないか(定型の別の形が要るか)を先に検討する。
- **してはいけないこと: 走査の外(`app/src` / `supabase/migrations` / `docs/specs` の外)へ
  印を置く。** 置いても母集合に入らないので「未参照の印」に気づけない(章から参照すれば
  抜粋自体は出るが、印を消したときに誰も鳴らない)。走査する木を増やすのは、その木が層として
  実在すると分かったときだけである(現在の 3 つは実装の木・migration の置き場・仕様の木)。
- **すべきこと: 抜粋できない題材は、章の本文で正直に言う。** `app/src/app/**`(画面の実装)の
  ように、この章が印を持てない領域がある(他の作業単位との境界)。その場合は例を諦めるのではなく、
  カタログの `note` に「実装の抜粋はまだ無い・理由」を書き、章の本文に出す
  (プレースホルダを黙って空白にしない)。
- **例:**

```ts
// #region example:operation-transition
export const checkOutLoan: (...) => Promise<ActionResult<CheckOutLoanResult>> = transitionOperation({
  event: 'check_out',
  // …
});
// #endregion
```

例はこの節の中に畳み込む(別の節に出さない)。ルールとその実物が離れると、片方だけが更新される。

## 検証方法

```bash
npm run generate        # 章を再生成する。未解決の印・未参照の印・40 行超があればエラーで止まる
npm run generate:check  # 書き込まず、生成結果と現状の docs/book/examples.html の差分を見る(CI と同じ)
npm run test:spec-tools # code-examples.ts の切り出し(extractRegion / extractSection)のユニットテスト
```

**準拠を確認できない基準は基準ではない。** 印の文法・上限・未解決/未参照の判定はすべて
`npm run generate` が機械的に弾く。人が見るのは「どの題材を選ぶか」(既存の題材で表現できないか)
だけであり、それはレビューで指摘する。

## 関連ドキュメント

- [scripts-code-quality.md](./scripts-code-quality.md) — `legacy/spec-tools/` 配下のコード品質規約全般
- [PRIN-0007 単一の正](../../../../../rules/principles/common/PRIN-0007-single-source-of-truth.md)
- CLAUDE.md ルーティング表「書き方の例を見たい」
