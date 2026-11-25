---
doc_type: decision
scope: common
id: ADR-0014
status: accepted
targets: [spec_dsl, verification]
date: 2026-10-02
norms: [PRIN-0001, PRIN-0007, PRIN-0009, ADR-0003]
---

# ADR-0014: `composite` の関数が「どの `writes` の規則の執行点か」を宣言する — `functions[].enforces`

## Status

accepted (2026-10-02)

---

## Context

### 背景

`access_spec` の `writes[]`(誰が・どの条件で・どの欄を編集してよいか)を **SQL の執行点に落とすのは、`shape: update` の生成 RPC の本文だけ**である(`rpc-authz-build.ts` の `updateAuthz`)。その形の関数を持たない表では、`writes[]` は読み物になる。A18 はこの穴を報告する検査で、執行点として認めるのは次の 2 つだけだった。

- `kind: rpc` / `shape: update` / `migration:` — 本文が生成物
- `kind: rpc` / `shape: update` / `handwritten:` — 本文は手書きだが、理由を T6 が、見張りテスト(`test_cases`)の宣言を A18 が要求する

ところが、**複数の行を一括で動かす書き込み**は `shape: update` に乗らない。題材の製品の `reorder_holds`(予約順の一括並べ替え)がそれで、`shape: composite` の手書き RPC として宣言されている。`hold` の `writes`(`by: librarian` / `by: staff`・`when` は蔵書の状態)を実際に守っているのはこの関数の本文だが、**宣言のどこにもそれが書かれていない**。結果として A18 は「`hold` の `writes` を執行する生成物がありません」と 2 件の警告を毎回出し続けるが、人が直す道が無い(`update` の関数を足すと、INV-HOLD-002 の衝突を避けるために捨てた 1 行ずつの更新口が復活する)。

### 前提条件

- 規則を守る本文が手書きなのは、`composite` が「定型に乗らない」ものの宣言だからで、これは設計どおりである。欠けているのは**本文の中身の検査ではなく、帰属の宣言**(この関数はどの規則の執行点か)である。
- `composite` の本文の意味は突合しない(ARCH-SP-BE-0001)。守っているかどうかを担うのは、規則ごとの**見張りテスト**になる。
- 拡張の手順は [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) に従った。下の「トリアージの記録」がその結果である。

### トリアージの記録

- **手順 0(宣言の欠落として 1 行に)**: data_table の `functions[]` の `shape: composite` の関数に、「この関数が access_spec の `writes` のどの規則の執行点か」を書きたいが、文法に無い。書きたい形は `enforces: [{ writes: hold, by: librarian }, { writes: hold, by: staff }]`。
- **手順 1(迂回パターン集)**: P-1〜P-10 に該当なし。どれも可視性・ガード・参照の表現力の話で、執行点の帰属の宣言ではない。
- **手順 2(別の見方)**: **運用** — 一括の並べ替えを 1 行ずつの定型 `update`(生成物)に戻せるか → **いいえ**。INV-HOLD-002(予約順の一意)のため 1 行ずつ動かすと途中で番号が衝突し、「編成中は UI の編集状態・確定時に一括反映」はユーザー決定である(migration `20260818000012` のコメント)。可変長の行の集まりは usecase の保存点(手順の数が固定)にも乗らない。**キャッシュ / セキュリティ / 告知の安定性** — 該当なし。
- **手順 3(2 実例)**: 実例は題材の製品の `reorder_holds` 1 つ。**例外条項に該当**する —— 「可視性・権限のように実装とテストに固着してから直すと全面改修になるものは 1 実例でも起票してよい」。これは `by` / `when`(権限と状態の前提)の執行点の話で、DB を直接呼べる経路に穴が開いたまま実装が固着する。
- **手順 4(決定可能性)**: 変数は有限(参照できるのは access_spec に実在する規則だけ)。全列挙で検査できる。書き間違いは新しい検査 T18(存在しない規則を名指し・`composite` 以外に書いた・見張りテストの id が無い・同じ規則を 2 つの関数が名指し)が落とす。

---

## Decision

### 決定内容

**data_table の `functions[]` に、`kind: rpc` + `shape: composite` の関数だけが書ける `enforces` を足す。**

```yaml
  - name: reorder_holds
    kind: rpc
    shape: composite
    enforces:
      - writes: hold          # access_spec のエンティティ
        by: librarian                 # その writes の規則(by で名指す)
        test_case: TC-TABLE-HOLDS-010   # 守っていることを確かめる見張りテスト(同じ表の test_cases の id)
      - writes: hold
        by: staff
        test_case: TC-TABLE-HOLDS-011
```

1. **`when` / `fields` は書かない**(書くと T0 が error)。規則の中身の正は access_spec で、写すと 2 重の正になる。名指しは `writes`(エンティティ)と `by` の 2 つだけで、同じ `by` の規則が複数あればそのすべてを名指す。
2. **`test_case` は必須。** 見張りテストを宣言していない手写しは宣言ではない(A18 の既存の文面と同じ線)。A18 の既存の判定(「表に `test_cases` が 1 本でもあれば手書きの `update` を執行点と認める」)より厳しく、**規則ごとに**見張りテストを名指す。
3. **検査 T18(error)**: (a) `enforces` を書いた関数は `kind: rpc` + `shape: composite` であること (b) `writes` のエンティティが実在し、`by` の規則がその `writes` に実在すること (c) `test_case` が**その関数の表の** `test_cases` に実在すること (d) 同じ規則を 2 つの宣言が名指ししないこと(執行点は 1 つ。warning ではなく error —— どちらの本文が正か決まらない宣言は読み物ですらない)。`test_case` の `@tc` との 3 段の突合は T3 がそのまま見る。
4. **A18 の判定に足す**: `enforces` で名指しされた規則(見張りテストが実在するもの)は執行点を持つものとして数える。指摘の対処は 3 択から 4 択になり、4 つ目は「`composite` の関数が執行点なら `enforces:` にその規則と見張りテストの id を書く」である。
5. **生成物**: data_table の本文ブロックの「関数の帰属」の下に、`enforces` を持つ関数があるときだけ「執行点になっている規則」の表を出す。ブックの集約の章の操作表では、その規則の編集の行に執行点の関数名を添える。宣言が無ければ出力は 1 バイトも変わらない。

### 適用範囲

data_table の `functions[]`(`composite` の関数)と、A18・T18・data-table-body・ブックの操作表。**既存の挙動は変えない** —— `enforces` を書かない表の A18 の判定は従来どおりで、既存の `handwritten` の `update` を見張りテストの粒度で厳しくする変更は、この決定の範囲外である。

---

## Consequences

### Positive（メリット）

- 手書きの `composite` が守っている規則が、**宣言として読める**ようになる。A18 の警告に人が取れる道(4 つ目)ができる。
- 名指しが規則ごとなので、規則を足すと「その規則の執行点と見張りテストは?」が機械で問われる。
- 迂回の余地がない。規則の存在と見張りテストの実在を検査し、免除リストを持たない。

### Negative（デメリット・トレードオフ）

- **`composite` の本文が規則を実際に守っているかは突き合わせない。** 宣言は帰属と見張りテストの名指しまでで、守ることの証明は見張りテストが担う。見張りテストが弱ければ、警告が消えても穴は残る。
- 語彙が 1 つ増える(`enforces`)。書き場所は `composite` の関数だけに閉じ、誤った場所への記述は T18 が止める。
- **`test_case` は同じ表の実在する id なら何でも通る。** T18(c)も、変異テストの例外(`lib/mutation/exemptions.ts`)も、名指した id が実在することしか見ない。名指しが「その規則を本当に見張るテストか」は機械が見ず、人のレビューが見る。
- **`enforces[].writes` のエンティティが、関数の属する表と一致することは見ない。** `composite` は `also_writes` の表の規則も執行しうるので、表とエンティティを 1 対 1 に縛ると正しい宣言まで落ちる。意図した判断である。
- **実例は題材の製品の 1 件だけで、手順 3 の例外条項により導入した。** 2 つ目の製品(archive)を立てる日に、この語彙が本当に一般かを再点検する。
- **生成器の変異テストの受け皿にもなる。** 規則の `when` を落とす変異は、手書きの `composite` の本文が守る規則では生成物のどこにも現れず、A18 が消えた後は捕る検査が無い。`enforces` が名指す規則(`writes` + `by`)を壊した変異は、`lib/mutation/exemptions.ts` が「宣言された例外」として読み、見張りテストの id を canaries にする(`handwritten` の `update` と同じ形。宣言が無い・見張りテストが実在しない場合は例外にならず、穴のまま赤になる)。

### Neutral（その他の影響）

- 既存の `shape: update` / `handwritten` の経路は、表に `test_cases` が 1 本でもあれば執行点と認める従来の判定のままである(`enforces` のほうが厳しい)。揃えるかは別の判断である。
- 実仕様(題材の製品)への適用は束 H2(643b2e46)で済んだ。題材の製品の A18 の 2 件は解消している。

---

## Alternatives Considered

### Option 1: 1 行ずつの定型 `update`(生成物)に戻す

- **Pros**: 新しい語彙が要らない。本文が生成物になり、`by` と `when` が SQL の執行点に落ちる。
- **Cons**: INV-HOLD-002 のため 1 行ずつ動かすと途中で番号が衝突し、空き番号運用が実装に復活する。「編成中は UI の編集状態・確定時に一括反映」はユーザー決定に反する。
- **Why rejected**: 手順 2(運用)で「戻せるか」を実際に当てた結果、戻せない。

### Option 2: usecase の保存点(生成した複合 RPC)に乗せる

- **Pros**: 一括の書き込みを 1 トランザクションの生成物にできる。
- **Cons**: 保存点は手順の数が固定で、可変長の行の集まりを渡す形には乗らない。
- **Why rejected**: 形が合わない。

### Option 3: A18 の警告を受け入れて(`accept` して)残す

- **Pros**: 仕組みを広げない。
- **Cons**: 受け入れは「この規則は執行点を持たなくてよい」の宣言になり、実際には `composite` の本文が守っている事実が仕様のどこにも残らない。警告が消える代わりに、規則と関数の結びつきが誰にも読めなくなる。
- **Why rejected**: 仕様を痩せさせる迂回であり、「迂回が仕様を痩せさせるなら、拡張のほうが正しい」(拡張トリアージの迂回の限界)に当たる。

### Option 4: `enforces` に `when` / `fields` も写す

- **Pros**: 関数の側だけ読めば何を守るかが分かる。
- **Cons**: 規則の正が access_spec と data_table の 2 か所になり、食い違いを検査する別の仕組みが要る。
- **Why rejected**: 2 重の正を作らない。名指しだけにして中身は access_spec に引く。

---

## Implementation

### Tasks

- [x] パーサー(`parse-data-enforces.ts`)・型(`DataFunctionEnforces`)
- [x] T18(`t18-composite-enforces.ts`)・文面(`messages-enforces.ts`)
- [x] A18 の判定(`unenforced-write-rules.ts` / `composite-enforces.ts`)と 4 択の文面
- [x] 生成物(data-table-body・ブックの操作表)
- [x] 題材の製品の `reorder_holds` への適用(束 H2 = 643b2e46)

### Timeline

- 開始: 2026-10-02
- 完了予定: 仕組み側は同日

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: ADR-0003(表現力を制限し列挙ベース検証を採用する。T18 は列挙で検査できる範囲に収めた)/ ADR-0012(DB を権威にする。規則の執行点を RPC に生成する)
- **Blocks**: None
- **Blocked by**: None

---

## References

- [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) — 拡張の手順(0〜4)
- [ARCH-SP-BE-0001 §テーブル仕様](../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) — `functions[]` の `shape` と `enforces`
- [enforcement-matrix.md](../../process/backend/system/standards/conventions/enforcement/enforcement-matrix.md) — A18 / T18 の行

---

## Notes

**名指しの粒度が `by` である理由。** `writes` の規則は `by` + 任意の `when` + `fields` だが、複数の規則が同じ `by` を持つ場合に、規則を 1 つずつ別名で呼ぶ仕組みを作ると語彙が増える。`by` が同じなら同じ関数が守ると読むほうが、現実の宣言(同じロールの規則は同じ口から実行される)と合う。同じ `by` の規則を別々の関数で守りたい事例が出たら、その時点で粒度を見直す。
