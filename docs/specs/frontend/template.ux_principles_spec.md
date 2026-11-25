---
doc_type: ux_principles_spec
scope: frontend
id: ux-principles                    # 固定。1 プロジェクト 1 枚なので導出元が無い

principles:                          # UX 原則の全数
  - id: "{原則 ID}"                   # U1 / Y5-steps の形。一意
    statement: "{原則を日本語 1 文で}"
    derives:                         # どの既存の宣言から判定するか(出どころの指し示し。事実は書かない)
      - "{state_spec の events など}"
    enforced_by: "{見張る検査の ID}"   # U1 / U4 / Y5 など。見張る検査が無ければ advisory
    # budget: { limit: 7 }           # 閾値を読む検査(U4 / U5 / Y5)の行は必須・advisory の行は書けない
    # affects: confirm_required      # U1 の行だけ。生成物が引く属性の名前(原則が生成物の形を直接決めない)
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換える。
- **ここに書かないもの**(書くと正が割れる):
    事実の宣言(状態・権限・画面の構成)          → 既存の spec(state_spec / access_spec / screen_spec 等)
    画面ごとの受け入れ(原則から外れてよい場所)   → 各 screen_spec の ux:
- 台帳が無いときは検査器の定数が既定値で動く。台帳を置いたら、U 群の閾値とユースケースの予算の
  既定値はここから読まれる(U8 が、U 群の検査と Y5 の指標が 1 行ずつ載っていることを見る)。
- 書き方の正: docs/rules/process/frontend/specification/standards/ux-lint.md
-->
