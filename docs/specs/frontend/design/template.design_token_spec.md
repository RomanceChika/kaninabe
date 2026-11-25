---
doc_type: design_token_spec
scope: frontend
id: design-tokens                    # 固定。1 プロジェクト 1 ファイルなので連番も導出も無い

theme: "{テーマ名}"                  # 必須。snake_case（例: night_reading_room）

palette:                             # 必須。**hex を書いてよい唯一の場所**
  "{色の名前}": '#rrggbb'            # 名前は「何に使うか」ではなく「どんな色か」で付ける

externals:                           # 任意。トークン層の外から供給される CSS 変数
  - name: "{変数名（-- は付けない）}"
    from: "{供給元のファイル}"
    reason: "{なぜ仕様側で値を持てないか}"

groups:                              # 必須。意味を持つトークン。名前は必ず `{group}-` で始まる
  - group: "{グループ名}"            # 例: color / space / radius / font / text / shadow
    purpose: "{このグループが何を決めるか}"
    tokens:
      - name: "{group}-{用途}"
        ref: "{palette の名前}"      # 色はこちら（value と排他）
        note: "{どこで使うか}"       # 任意
        decorative: "{理由}"         # 任意・色トークンだけ。「実際には重ねない」ので G3 の contrast 網羅の床から外す
      - name: "{group}-{用途}"
        value: "{直値}"              # 色以外（px・秒・数値・フォント列）はこちら

contrast:                            # 任意。宣言した組み合わせだけを G3 が検査する
  - fg: "{color-… トークン}"
    bg: "{color-… トークン}"
    min: 4.5                         # 4.5 = 本文（WCAG AA） / 3 = 大きい文字・UI 部品の境界

brand:                               # 必須。アプリのアイコン。G8 が検査する
  icon: "{app/src/app/icon.png}"     # 必須。512px 正方形の透過 PNG か SVG
  apple_icon: "{パス}"               # 任意
  og_image: "{パス}"                 # 任意
  placeholder:                       # 任意。実物のロゴ待ちの受け入れ（あると G8 の実在検査が warning に落ちる）
    reason: "{なぜ仮のままか}"
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- **palette と groups を分ける**。実装が引くのは groups のトークンだけで、palette は
  「色そのもの」の名前空間である。色を振り替えるときに直すのは ref の 1 行になる。
- **value と ref はどちらか一方**。両方書く / 両方書かないは G0 がエラーにする。
  ref は色トークン（group: color）でしか使えない。
- **トークン名は `{group}-` で始まる**（G0）。CSS 変数名がそのままトークン名になるので、
  グループを見ればどの語彙かが変数名だけで分かる状態を保つ。
- **contrast は総当たりにしない**。実際に重ねる組み合わせだけを並べる。総当たりにすると、
  重ねもしない色の比を守るためにパレットが痩せる。
- **decorative は「実際には重ねない」ことの受け入れの記録であって、検査を消す操作ではない**。
  色トークンが `contrast` に一度も現れないと G3 の網羅の床が warning を出す。装飾用途で
  本当に重ねないなら `decorative` に理由を書いて受け入れる（`note` と役割は別: note は
  「どこで使うか」、decorative は「なぜ contrast に無くてよいか」）。**`decorative` を書いた
  トークンが `contrast` にも現れると矛盾として G3 がエラーにする**（重ねないと言った色を
  実際には重ねている）。
- **externals は増やさない**。ここが増えるほど意匠がトークン層の外へ漏れる。
  書いてよいのは「値がビルド時にしか決まらない」等の機械的な理由があるものだけである。

検査（正は styling.md）:
  G0  トークン仕様のスキーマ（この表の形）
  G1  実装の CSS に生値（色・単位・無単位のマジック値・装飾文字）を書いていない（許可リスト方式）
  G2  実装が引いた var(--…) が実在するトークンか externals である
  G3  contrast に宣言した組み合わせが min 以上（palette の実値から計算）+ 色トークンの
      contrast 網羅の床（decorative の無い色トークンが 1 度も現れないと warning）+
      decorative と contrast の矛盾（両方あると error）
  G4  JSX に style 属性を書いていない（ESLint）
  G7  宣言したトークンが実装の CSS から引かれている（死語彙が残っていない）
  G8  brand.icon が宣言され、実在し、Next テンプレート既定の favicon.ico のまま出ていない
      （`brand.placeholder` を宣言している間は実在・内容の検査を warning に格下げする。
        「宣言していない」「favicon.ico の残骸が残っている」は placeholder があっても error）
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の可読形は生成ブロックが担う（手書きで再記述しない）。YAML コメントは
  行ローカルの短注（1 行）のみ。経緯は NOTES へ。
-->

# デザイントークン（{テーマ名}）

{このテーマが何を表すか。1〜2 文}

## トーン

| 要素 | 決めたこと | なぜ |
|------|-----------|------|
| アクセント | | |
| 地 | | |
| 文字 | | |

## 関連ドキュメント

- [styling.md](../../../rules/process/frontend/system/standards/conventions/styling.md)

<!-- AUTO-GENERATED:token-tables -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:token-tables -->
