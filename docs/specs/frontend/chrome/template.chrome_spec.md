---
doc_type: chrome_spec
scope: frontend
id: "chrome-{name をハイフン区切りにしたもの}"   # 例: chrome-library。ファイル名は {name}.md 固定

name: "{name}"                       # 必須。snake_case
label: "{日本語名}"                  # 任意。クロームの表示名（例: 利用者向けクローム）

layout:                              # 必須。スロットは header / body.left|center|right / footer
  header: ["{component}"]

navigations:                         # 任意。共有部の部品から出る遷移
  - on: "{きっかけ}"                 # ドットを含まない自由語彙のみ（例: signed_out）
    to: "screen-{name}"
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- chrome_spec に書けるのは doc_type / scope / id / name / label / layout / navigations の 7 つだけである
  （allowlist。それ以外は S0 がエラーにする。綴り違いも黙って無視せず失敗する）。
  **書けないもの**: for / route / precondition / requires_auth / reads / actions
  共有できるのは骨格と、その骨格に置いた部品から出る遷移であって、業務の配線ではない。
- navigations の on にドットは書けない。「{イベント ID}.success」を書けるのは、その操作を
  actions に宣言している画面だけである（chrome は actions を持たない）。
- ここに書いた遷移は、継承する画面すべてへロード時に展開される。到達可能性（S3）も遷移図も
  展開後のグラフで見るので、同じ遷移を各画面に書き写す必要はない。
- **chrome は外枠**であり、継承した画面の layout はこの内側に入る（Next.js の layout.tsx の
  入れ子と同型）。画面が同じスロットを宣言しても衝突ではない。
- testid の名前空間は画面と別で、chrome の部品は `{name}.{スロット}.{部品}` になる。
- 中身（ヘッダに何のリンクを並べるか、どう見せるか）はコンポーネントの内側であり、
  ここには現れない。縛るのは「どのスロットに何という部品が居て、どこへ遷移するか」まで。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の再記述はドリフト源なので書かない。経緯は NOTES へ。
- 書き方の正: docs/rules/process/frontend/specification/standards/screen-spec-writing.md
-->

# {クロームの日本語名}（{name}）

{手書き散文は標識 2 種・各 1〜3 行のみ。例:}

- {否定の標識: 「リンクの出し分けはしない — 誰に出すかを chrome が判断すると共有部が可視性を持つ」}

<!-- AUTO-GENERATED:chrome-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:chrome-body -->
