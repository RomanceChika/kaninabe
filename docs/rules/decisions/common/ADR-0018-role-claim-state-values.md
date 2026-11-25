---
doc_type: decision
scope: common
id: ADR-0018
status: accepted
targets: [spec_dsl, verification]
date: 2026-10-18
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0009, ADR-0003, ADR-0012]
---

# ADR-0018: 役の `claim` に state / enum の値の集合を書き、`implies` を述語にも効かせる

## Status

accepted (2026-10-18)

---

## Context

### 背景

ロールは「誰が・どの対象に対して」立つかを宣言し、DB の述語(定型 RPC の `by`)と RLS のポリシーはその宣言から生成される。ところが**実行者自身の行の状態**(利用者が有効か・利用者カードが有効か)でロール全体を絞る書き方が無かった。

- `claim` が指せるのは `session: true` の **boolean の欄**だけで、state / enum の欄の値では立てられない。
- `implies`(「A は必ず B」)は実行時にロール配列を閉じるだけで、**DB の述語には出ない**。`patron` を絞っても、`implies: [patron]` を持つ文脈依存ロール(対象の行の列だけを述語にするもの)は素通りする。退会した主催者が今も自分の対象を遷移できる、という穴がここから出る。
- 作成の `when` に `patron.state == active` を書く迂回は作成にしか効かず、遷移・読み取りには届かない。しかも**書き忘れを検査で見つけられない**(拒否が既定でない = PRIN-0009 に反する)。

### 前提条件

- 拡張の手順は [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) に従った。
- 条件を宣言しなければ、生成される SQL・コードは 1 バイトも変わらない(既存の製品・題材の出力は不変)。
- 設計の全体は 2026-10-18 のセキュリティの点検の設計メモ(利用者の状態でロールを絞る設計)。この ADR が決めるのは**仕様の語彙(E1 / E2)**で、実行時のロール解決・オラクル・製品の仕様の編集は別の束である。

### トリアージの記録

- **手順 0(1 行)**: role_spec の `claim` に boolean ではなく `patron.state in [active]` を書きたいが文法に無い。かつ `implies` の先の行の条件を述語に持ち込む語が無い。
- **手順 1(迂回パターン集)**: P-3(関係を対象の行に畳む)は却下済み、P-11(作成の `when`)は作成にしか効かない。迂回では閉じない。
- **手順 2(別の見方)**: キャッシュ・告知は非該当。不在による安全(guest / 退会者を別の集約に分ける)は、guest → active が同じ状態機械の中で動くため使えない。運用(認証層の BAN)は権限を絞れず、読み取りの制限も表せない。
- **手順 3(2 実例)**: 製品の利用者の `state`(guest / active / suspended / …)と、題材 library の `patron.card`(valid / expired / revoked)。ただし**同じ doc_type の独立した 2 題材**で、別プロジェクトでの再現ではない。
- **手順 4(決定可能性)**: 値の集合は有限(欄は state / enum / boolean のみ)で、`claim` は原子 1 つに限る。決定可能性は変わらない(ADR-0003 の決定は動かない)。

---

## Decision

### 決定内容

**E1 `claim` の文法を広げる。** 次の 3 つの書き方を許す。

```yaml
- id: patron
  kind: authenticated_default
  claim: patron.state == active          # state / enum の欄がこの値のときに立つ
- id: paused_patron
  claim: patron.state in [suspended, lapsed]   # 値の集合のどれか
- id: staff
  claim: patron.is_staff                 # boolean(従来どおり)
  implies: [patron]
```

- 指せるのは `session: true` を宣言した boolean / enum / state の欄。enum / state は**値を添える**(省略は不可)。値は欄の値域になければならない(V11。綴り違いは「誰にも立たないロール」になるため)。
- `kind: authenticated_default` との併記だけ許す(「行がある」に「この条件を満たす」を足す形)。他の `kind` と `binding` は従来どおり併記できない。
- モデルでは欄のパスを `claim`、値の集合を `claimValues` に分けて持つ(boolean は `claimValues` なし)。

**E2 `implies` を述語にも効かせる。** `claim` を持つロール = **行の条件を持つロール**。ロール R の述語は、**R 自身の根拠 AND(R が推移的に含意するロールのうち行の条件を持つもの)の行の条件**になる。

- 足すのは行の条件だけで、実行者が渡す配列(`p_actor_roles`)の照合は足さない。
- 定型 RPC の本文: `exists (select 1 from {表} a where a.id = p_actor_id and a.{欄} in (…))` を論理積で足す。
- RLS のポリシー: 含意の先の補助関数 `public.is_{role}()` の呼び出しを論理積で足す(**一様**。`staff` のポリシーにも足す)。補助関数の本体は**自分の根拠だけ**を持つ(含意の先の条件を本体に埋めない)ので、ポリシーが要求する補助関数の全数には含意の先のロールも入る(T7 が宣言の過不足を両方向で見る)。
- 含意の先に `claim` が無ければ何も足さない。

**V23 書き忘れを検査で落とす。** 実行者の集約が状態機械を持つのに `kind: authenticated_default` のロールが状態の欄に `claim` を宣言していない仕様を、検証器 V23 が落とす(「行があれば状態に関わらず立つ」を書き忘れで作らせない)。重さは検証器の定数 `ROLE_STATE_CONDITION_SEVERITY` の 1 か所で決まる。製品の仕様が条件を足すまでの移行のあいだは警告(拡張候補の台帳 `X-login-role-state-condition`)だったが、製品が条件を宣言した束 5 で `error` に切り替え、台帳の候補は `done` にした。免除の一覧は持たない(状態機械を持たない集約が対象外なだけ)。

### 適用範囲

仕様の語彙(role_spec)・検証(V11)・SQL の翻訳(定型 RPC・RLS のポリシーと補助関数)。実行時のロール解決(先読み)・実行計画の型・オラクル(world)は、この ADR の語彙を使う別の束(束 3・4)で追随した。製品の仕様の編集は、さらに別の束で扱う。

---

## Consequences

### Positive（メリット）

- 「有効な利用者でなければ何も書けない・読めない」を、**ロールの宣言 1 本**で全ての書き込み・読み取りに効かせられる。書き忘れで穴が開く形(`when` を各所に書く)ではなく、**既定が拒否**になる(PRIN-0009)。
- 実例を足しても検証器・生成器にアプリの語は増えない。`active` / `valid` は仕様の語で、仕組みは `claim` / `implies` / `kind` の軸だけを持つ。
- 宣言しなければ生成物は不変。先に入れても既存の製品・題材は動かない。

### Negative（デメリット・トレードオフ）

- 含意が「持ち得る」の宣言から「**その行の条件も満たす**」の宣言に強まる。`implies: [patron]` を書いていた文脈依存ロールは、`patron` に条件を足した瞬間に全部が絞られる(意図した効果だが、書き手は `implies` の読み方が変わると知る必要がある)。条件を持たない `implies` は従来どおりで、この変化は `claim` を足したロールにだけ起きる。
- RLS のポリシーが一様に補助関数を 1 つ足す。条件を宣言した製品ではポリシーを生成した migration が全て新しい連番になる(機械的な再生成。C23)。
- 実例は同じ doc_type の独立した 2 題材(別プロジェクトの再現ではない)。2 つ目の製品が現れたら再点検する。

### Neutral（その他の影響）

- ロール配列(`p_actor_roles`)の契約は変わらない。DB は実行者の行を直に読むので、配列が自己申告のままでも行の条件は偽造できない。
- 先読み(実行器の `resolveActorRoles`)は、セッションの写しで行の条件を読む(生成物 `roles.ts` の `AUTHENTICATED_WHEN` / `ROLE_GATES`)。写しは遅れうるので、取り消しの直後は甘い側に外れうるが、DB の述語が必ず落とす(DB が正。ADR-0012)。

---

## Alternatives Considered

### Option 1: 各 `when` に `actor.state == active` を書く

- **Pros**: 語彙の拡張が要らない。
- **Cons**: 書き忘れを検査で見つけられない。文脈依存ロールの述語と読み取り(RLS)には書けない。
- **Why rejected**: 拒否が既定にならない(PRIN-0009)。迂回(P-11)は作成にしか効かない。

### Option 2: 有効でない利用者を別の集約に分ける

- **Pros**: 不在による安全で、行が無ければ `authenticated_default` が立たない。
- **Cons**: 招待を受けた人(guest)が有効利用者になる遷移が同じ状態機械の中で動くため、集約を分けられない。
- **Why rejected**: ドメインの形が許さない。

### Option 3: 認証層で BAN する

- **Pros**: 仕様の拡張が要らない。
- **Cons**: 権限を絞れず、休会者に読み取りだけ許す等の区別も表せない。
- **Why rejected**: 要求の一部しか満たさない。

---

## Implementation

### Tasks

- [x] パーサー・型(`claim` の文法と `claimValues`)・V11(型・session・値域・kind 併記)
- [x] SQL の翻訳(値の集合・含意の先の行の条件・RLS の補助関数の要求)
- [x] 実行時のロール解決(`RoleTables` の `authenticatedWhen` / `gates`)・実行計画の型(`values` / `roleGates`)・オラクル(world は条件を満たす人と満たさない人を分けて立てる。RLS・一致の証明・保存点)。`STATE_CLAIM_SUPPORTED` は `true`
- [ ] 製品の仕様の編集と migration(別の束)

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: [ADR-0003](./ADR-0003-constrained-spec-dsl.md)(表現力の制限。適用範囲を広げる)・[ADR-0012](./ADR-0012-db-as-authority.md)(DB が権威)
- **Blocks**: None
- **Blocked by**: None

---

## References

- [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md)
- [domain-spec-writing.md §role_spec](../../process/common/specification/standards/domain-spec-writing.md)

---

## Notes

- 休会者に読み取りだけ許す第 2 段は、`claim: patron.state == suspended` の役(`kind` なし・`implies` なし)を足し、読ませる集約の `reads` に並べる形で、仕様だけで書ける(フレームワークの追加は要らない)。
