# AGENTS.md — AI エージェント向けの入口

仕様を正にして、検証・文書・実装の部品・テストを仕様から導く仕組み(フレームワーク)です。版は安定していません([README.md](README.md) を先に読むこと)。

**作業の前に、[CLAUDE.md](CLAUDE.md) を読んでください。** 「やること」ごとに読む文書を引くルーティング表と、コマンドと、作業の流れがあります(同じ表をここに写しません。正は CLAUDE.md の 1 か所です)。

## 守ること

- **仕様が正です**(`docs/specs/`)。実装・テスト・文書は仕様から導かれるもので、実装を先に変えて仕様を後追いさせません。
- 生成物(`<!-- AUTO-GENERATED -->` のブロックと、`generate` が書き出したファイル)を手で編集しません。仕様を直して `generate` します。
- 変更を確定させる前に、`npm run verify -- --fail-on-unclassified` と `npm run test:unit` と `npm run test:spec-tools` を通します(この木のデモ製品は実装の木を持たないので、`generate:check` はまだ回しません。docs/known-gaps.md の 1)。エラーを黙らせるための雑な定義を書きません。
- 仕組み自身のコード(`framework/` と `legacy/spec-tools/`)を変えたら、`npm run test:spec-tools` / `typecheck:spec-tools` / `lint:spec-tools` / `typecheck:framework` / `lint:framework` を通します。
- 検査の無効化コメント(`eslint-disable` など)で警告を黙らせません。
- PR は、Opus のレビュー(こちらの結論を見せずに頼む)と Codex のレビュー(`@codex` と `@dot` を付けて頼む)の**両方が「これ以上直すところは無い」と答えるまでマージしません**。指摘を直したら、直した差分をもう一度両方に見てもらい、これを繰り返します。片方だけで進めることはしません(Codex が答えないあいだは待ちます)。両方がそう答えた commit を、PR 本文の `## Review` に書きます(`- opus: <commit の完全な sha>` と `- codex: <同じく>`)。
- マージしてよいのは、**その PR を名指すいちばん新しい pr-gate の run が success で終わっていて、そのログの最後の `pr-gate: passed …` の行が、マージする head の sha と、いまの base(dev)の先頭の sha と、マージに渡すタイトルと本文の hash を示しているとき**だけです(run が無い・行が無いのは合格ではありません。base が進んでいたら、検査やルールが変わっているかもしれないので、本文を編集し直して新しい run を待ちます)。run を head の sha で探すことはできません(pull_request_target の run の sha は base のものです)。pr-gate の run を新しい順に開き、ログの中で番号の入った `pr-gate: pr <番号>` の行(行の頭が `pr-gate: pr` で始まるもの。その前に出る `Run echo …` の行は step の見出しです)で、その PR の run かを見分けます。いちばん新しい run が取り消し(cancelled)なら、本文を編集し直して新しい run を待ちます。合格の run より新しい pr-gate の run のうち、ログが無いなどでどの PR の run か見分けられないものが 1 本でもあれば、その PR の run かもしれないので、合格とはしません。hash の作り方は pr-gate.yml の冒頭にあります。時刻では比べません(古い run を re-run すると、その run の古い本文のまま success になるからです)。pr-gate は base の側の workflow で動くので、PR の中から止められません。fork からの PR は pr-gate が止めます。dev には pr-gate を必須にする設定(required check)がまだ無いので、マージを止めるのはこの決まりです。記録はマージする側が書くので、この検査が防げるのは「記録が古い・無い」ことまでです。レビューを受けずに記録を書くことは、検査ではなく決まりで禁じます。
- マージは squash で、確かめた head の sha を渡し(それより新しい push があれば失敗させる)、commit のタイトルと本文には、マージの直前に読み直した PR のタイトルと本文をそのまま渡します。
- `## Review` は本文の最後の節にし、記録の 2 行のほかに何も書きません。本文には HTML のタグもコメントも書きません(読む人に見えるものと検査が数えるものを一致させるため。書くと pr-gate が落ちます。`<` の後ろに英字・`!`・`?`・`/` が続く書き方は、コードの中でも落ちます)。

## push の前の関門(public)

**対応する環境**: `scripts/setup-dev-env.sh` が入れる道具(gitleaks と actionlint の固定版)は **linux x64 だけ**です。git は **2.40 以上**が要ります(走査が tree の属性を読まないために `--attr-source` を使います。古い git では走査が止まります)。ほかの OS・CPU では、setup は止まります。**最初の push の前に**、固定の版の gitleaks と actionlint を手で入れ、`core.hooksPath` を `.githooks` にします。

このリポジトリは public で、push した瞬間に公開されます。予防は手元にしか置けないので、作業の**最初**に次を確かめます(決まり。関門は hook が呼ばれて初めて効きます)。

```sh
sh scripts/setup-dev-env.sh                      # hook の経路・gitleaks・actionlint を入れる(版と checksum は script に固定)
git config --get core.hooksPath                  # .githooks と出ること
```

- 語の一覧はリポジトリの外に置きます。`SCAN_WORDS_FILE` か、`git config kaninabe.scanWords <path>`(setup に `--words <path>` で渡せます)で hook に教えます。一覧が無い・空・読めないときは、hook は通さずに止まります。owner は `SCAN_OWNER` か `kaninabe.scanOwner`(`--owner <name>`)です。
- push の前に、push する差分を Opus が読み、「公開してよいか」に答えます。**読む commit は、`sh scripts/push-range.sh <remote 名か URL>` が出す commit の一覧そのものです**(hook が関門に渡す範囲と同じ 1 か所の計算です。push 先に**いま問い合わせて**、push 先が持っていると答えた commit だけを引きます。remote-tracking の ref は手元の状態にすぎないので、証拠にしません。push 先に問い合わせられない・履歴を最後まで読めない(shallow clone・欠けた object)ときは、少なく走査せずに止まります)。読む手順は次のとおりです。(1) `sh scripts/push-range.sh <remote 名か URL>` を実行し、標準出力の commit を全部読みます。(2) 同じ実行が標準エラーに出す次の行の**値をそのまま**記録します: `git config kaninabe.contentReviewed "<head の sha> <範囲 id>"`(コマンドごと出力に書いてあります。値は 1 つで、空白で区切った 2 語です)。範囲 id は、push 先の URL・head の sha・走査する commit の順序つき一覧の sha256 です。pre-push は push 時に範囲 id を計算し直し、記録と違えば止めます(push 先の branch が消えた・動いた、別の URL へ push する、commit を足した、のどれでも範囲が変わるので、**新しい範囲で読み直して**記録し直します。止めるときは新しい commit の数だけを出し、中身は出しません)。commit の sha だけの古い形の記録は、指示つきで断ります。push 先の URL を複数持つ remote は、URL ごとに範囲 id が違うので、記録は 1 つの URL にしか合いません(ほかの URL への push は読み直しを求められます)。記録は作り手が書けるので、防げるのは読み忘れまでです。読んでいないものを読んだことにしません(決まり)。
- 関門は `scripts/push-gate.sh` の 1 本です(gitleaks=履歴・各 commit の生の object 全体(header の `mergetag` / `gpgsig` なども、message の NUL 以降も。NUL は改行に直す。64 KiB 以下の束にして走査)・HEAD の木(合成した root commit として、履歴と同じ commit ごとの経路で読む。`gitleaks dir` は使わない)、語の一覧の走査、NUL を含む file や UTF-8 でない file(走査が読めないので、名指ししない限り赤)の検査、workflow の検査)。走査から外すものは `scripts/scan-exclusions.tsv` の 1 本だけで、file を 1 つずつ(path と blob id、または文字列の sha256)・理由つきで書きます。hook は必ず `--mode words` で呼びます。手で `--mode` を変えたり、`--no-verify` で飛ばしたりしません(決まり)。
- hook は、いま checkout している commit のほかの push を断ります(比べるのは、push する object そのもの(包みを剥がさない)と HEAD の commit です。注釈付き tag の object は commit ではないので、id を指定して branch や notes に push しても断ります)。**push してよい先は `refs/heads/*` だけです**(branch の削除は通ります)。**tag の push は、削除も含めて断ります**(tag は tag の workflow だけが作り、消します)。`refs/tags/*` のほか `refs/notes/*`・`refs/remotes/*`・pull request の ref などに送る push も断ります。理由は、tag の message、notes、その他の ref が運ぶ object は走査していないので、branch 以外の ref は、走査していない object を push 先の object 置き場に入れる口になるからです(ref の更新が断られても object は先に着きます)。`--follow-tags` や `push.followTags` で一緒に送られる tag、`--mirror`、`remote.<名前>.push` の refspec も、hook に渡る ref の行として同じ規則に当たります。hook は、hook が動いているリポジトリ(`GIT_DIR` / `--git-dir` と `--work-tree` が指す方)を、呼び出した側の環境で 1 回だけ決めて関門に渡します。囲んでいる別のリポジトリは走査しません。
- 語の一覧に、コメントと空行しか無い(効く行が 0 本の)ときは、走査が走らないので止まります。
- 関門の出力は、step の名前・件数・commit の短い id・path と行だけです(CI では件数だけで、ツールが返した名前や path は一切出しません。詳細が要るときは手元で gitleaks を直接実行して見ます)。当たった語は出ません。履歴の走査は `gitleaks git` を commit ごとに 1 回ずつ回し、各 commit について「追加された文字の行があるか(git の numstat)」と「gitleaks が走査した commit の数」が合うことを確かめます(合わなければ止まります)。作業を別の model に任せるときは、公開される文を書かせる指示に、同じ走査を通すことを含めます。

## 最小の確認

```sh
npm ci
npm --prefix legacy/spec-tools ci
npm run verify
npm run generate
```

Node.js 24 以上が要ります。

## Review guidelines

このリポジトリでは、Codex は **書き込まないレビュアー** です。実装は別のエージェントが行います。この節より上は実装するエージェント向けの決まりで、Codex はこの節に従います(上の決まりは、レビューで照らす基準として使います)。

### やること

- PR のコメントで頼まれたことに、日本語で答える。頼まれた観点を優先し、ほかに穴を見つけたらそれも書く。観点を頼まれていなければ、下の観点で差分全体を見る。
- 細かいところまで指摘してよい(命名・言い回し・読みにくさも歓迎)。とくに見てほしいのは: 仕様と実装・生成物の食い違い、検査がすり抜ける入力、権限・RLS・SQL の穴、secret の漏れ、テストが実際には何も確かめていない箇所、壊れる場合分け。
- 指摘ごとに先頭に重さを付ける: 【重大】(マージ前に直すべき)/【普通】/【細かい】。
- 再レビューを頼まれたら、前の指摘が本当に直っているかと、直した差分が新しい穴を作っていないかを見る。指摘が残っていなければ「指摘なし」と書く(記録はこの答えを見て書かれる)。
- 指摘には、根拠のファイルと行(リポジトリの中の相対パスで書く)、壊れる具体的な入力か手順を付ける。確信が無いものは「推測」と書く。
- 仕様が正である(`docs/specs/`)ことを前提に見る。実装に合わせて仕様を直す提案はしない。

### やらないこと

- commit・push・PR の作成・ブランチの作成をしない。直し方の提案はコメントの中のコード片までにする。
- 承認・マージ・スレッドの resolve をしない。
- 生成物(`<!-- AUTO-GENERATED -->` のブロック、`generate` が書き出したファイル)の手での修正を勧めない。仕様か生成器を直す提案にする。
- 検査の無効化(`eslint-disable` など)や、テストを外して緑にする提案をしない。

### このリポジトリは public である

コメントはすべて公開される。次のものをコメントに書かない:

- secret・token・鍵の形をした文字列(例としても書かない)
- 個人名・メールアドレス・手元の絶対パス(ホームディレクトリから始まるものなど。リポジトリの中の相対パスは書いてよい)
- このリポジトリの外の製品に固有の語。この仕組みは特定の製品に依存しない(例が要るときは `docs/specs/` の図書館の題材を使う)

上のものを差分の中に見つけたら、その中身を引用せずに「ファイル名と行に secret・個人情報・製品に固有の語らしきものがある」とだけ書く。
