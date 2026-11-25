# AGENTS.md — AI エージェント向けの入口

仕様を正にして、検証・文書・実装の部品・テストを仕様から導く仕組み(フレームワーク)です。版は安定していません([README.md](README.md) を先に読むこと)。

**作業の前に、[CLAUDE.md](CLAUDE.md) を読んでください。** 「やること」ごとに読む文書を引くルーティング表と、コマンドと、作業の流れがあります(同じ表をここに写しません。正は CLAUDE.md の 1 か所です)。

## 守ること

- **仕様が正です**(`docs/specs/`)。実装・テスト・文書は仕様から導かれるもので、実装を先に変えて仕様を後追いさせません。
- 生成物(`<!-- AUTO-GENERATED -->` のブロックと、`generate` が書き出したファイル)を手で編集しません。仕様を直して `generate` します。
- 変更を確定させる前に、`npm run verify -- --fail-on-unclassified` と `npm run test:unit` と `npm run test:spec-tools` を通します(この木のデモ製品は実装の木を持たないので、`generate:check` はまだ回しません。docs/known-gaps.md の 1)。エラーを黙らせるための雑な定義を書きません。
- 仕組み自身のコード(`framework/`)を変えたら、`npm run test:spec-tools` / `typecheck:spec-tools` / `lint:spec-tools` / `typecheck:framework` / `lint:framework` を通します。
- 検査の無効化コメント(`eslint-disable` など)で警告を黙らせません。

## 最小の確認

```sh
npm ci
npm --prefix legacy/spec-tools ci
npm run verify
npm run generate
```

Node.js 24 以上が要ります。
