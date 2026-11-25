---
doc_type: directory_guide
id: DG-BE-0008
norms: []
scope: backend
---

# process/backend/system/playbooks — コードを書く手順

コードを書くうえでの**手順**を置く箱。対象は API の追加・開発フロー・レビュー・品質チェックである。

この箱は**規約を参照する側であって、規約を持つ側ではない**。手順の中で「何が正しい形か」が要るなら、[system/standards/](../standards/README.md) の該当文書を参照する。手順の中に規約を書き写すと、規約を直したときに手順が古いまま残る。

## 配下の文書

| 文書 | 内容 | 参照する Skill |
|---|---|---|
| （未整備） | — | — |

3 列目に「参照する Skill」を持つのは、**どの手順をどのスキルが読むかを表で維持する**ためである。手順とスキルの対応が表に無いと、スキルだけが更新されて手順が置き去りになる。

**現在この箱は空である。** 実運用の実装手順は `.claude/skills/{add-operation,add-query,add-screen}/SKILL.md` が丸ごと担っている。ただし**スキルは手順の索引であって正典ではなく、`docs/rules/` 側にスキルの規約は作らない**。内容の正は standards 側にある。

### 受け皿が無いままの手順（在庫）

次の手順は文書としての受け皿が未着手である。消すと予定が失われるので在庫として残す。

| 手順 | 現在どこが担っているか |
|---|---|
| Server Action・ルートハンドラの追加 | `.claude/skills/add-operation`(規約の正は [conventions/server-actions.md](../standards/conventions/server-actions.md) / [route-handlers.md](../standards/conventions/route-handlers.md)) |
| 開発フロー | CLAUDE.md の「変更の流れ」と各スキル冒頭のビルダー×レビュアー体制 |
| 課題の分析と計画 | スキルの設計凍結フェーズ |
| 課題の実装ループ | スキルの実装フェーズ |
| 課題解決のワークフロー全体 | スキル 3 本 |
| 課題の起票 | `BACKLOG.md`(未処理項目の正。消し込み式) |
| worktree の管理 | 受け皿なし |
| PR の作成 | 受け皿なし |
| PR の評価 | スキルの独立レビューと裁定(裁定者はユーザー) |
| ローカルの品質保証 | CLAUDE.md のコマンド節(`npm run verify` / `cd app && npm run typecheck` `lint` `test` `test:integration` `test:e2e`) |
| 全体の品質保証 | CI が同じ検査を再実行する |

worktree の管理・PR の作成・PR の評価に相当する決まりは、現状 CLAUDE.md と **3 台帳の分業**——`NOTES.md`(経緯の一次記録。正典ではない)/ `BACKLOG.md`(未処理項目の正)/ `docs/handoff/review-queue.md`(ユーザー判断待ち)——に散っており、この箱には無い。

## テンプレート

新規文書は**同階層の `template.md`** に従う。このテンプレートは process 配下で唯一 `id` / `norms` / `standards` をフロントマターに持つ。`standards` はこの手順が依存する実装ルールの ID を並べる欄で、**手順から規約への依存を機械が辿れるようにする**ためにある。本文の手順節にも「参照」ラベルで同じ ID を書き、メタと本文の両方で対応を保つ。

## 参照するもの

| 系統 | 中身 |
|---|---|
| [system/standards/](../standards/README.md) | 手順の中で参照する規約(`conventions/`)と層のきまり(`layers/`) |
| [../../specification/](../../specification/README.md) | 仕様のルールと手順。実装の前段にあたる |
