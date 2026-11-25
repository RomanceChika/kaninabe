---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0006, PRIN-0008, PRIN-0009, ARCH-SP-BE-0001, ARCH-BE-0014]
decisions: [ADR-0003]
---

# 設定仕様（config_spec）の書き方

`docs/specs/backend/config.md` に置く `config_spec`（設定カタログ）の YAML スキーマと、検証器が実行するチェック（K0〜K6）を定義する。

## 目的

- **暗黙の挙動を無くす。** 「何を設定すればこのシステムは動くのか」は、これまで実装の `process.env` 参照と `app/.env.example` のコメントの中にしか無かった。**引き継いだ人が最初に詰まる**のはここであり、しかも「未設定だと止まるのか・黙って縮退するのか」は実装を読むまで分からない。カタログはその穴を塞ぐ（PRIN-0001）。
- **未設定を「素通し」の理由にしない**（PRIN-0009）ことを、行ごとに宣言させる。`absence`（無いとどうなるか）が必須なのはそのためで、「設定していないので認証を飛ばす」のような挙動をレビューできる形にする。
- **何と繋がっているかを同じ表で答える。** 外部連携（Supabase・example-idp・Vercel Cron）は、結局「そのために何を設定するか」として現れる。`used_by` の軸が**連携カタログを兼ねる**ので、連携のためだけの別カタログは作らない。
- 仕様・実装の参照・雛形を**双方向の閉世界**で結び、片方だけ増えた状態を機械が落とす（PRIN-0008）。

## 参照するもの

- **配置**: [ARCH-SP-BE-0001](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) §設定仕様
- **外部連携の機構**: [ARCH-BE-0014](../../../../architecture/system/backend/ARCH-BE-0014-external-integration.md)
- **テンプレート**: `docs/specs/backend/template.config_spec.md`

## ルール・基準

### 語彙をどちらが持つか（フレームワークとアプリの線）

**このカタログには、フレームワークが固定する軸が 1 つも無い。**

| 軸 | 語彙の持ち主 | 理由 |
|---|---|---|
| `kind` / `requirement` / `used_by` / `target` | **カタログの `vocabulary`** | 「秘密」「example-idp の API トークン」「本番でだけ要る」「Vercel の Production」はこのアプリ（と、それが乗っている基盤）の事情であり、体系の一部ではない |
| `probe.kind` / `read_by.kind` | **体系（固定）** | 置き場の名前を**どう数えるか**の手段は 2 語・1 語の値域である（下表）。ここだけは道具が `kind` で分岐するので、体系が持つ |

これは doc_types.md の「**検証器がコード分岐に使う区別だけが専用の型を持つ**」打ち切り規則の素直な帰結である。分岐に使う区別（`probe.kind`）だけが固定の語を持ち、置き場そのものの名前は持たない。

**固定の語が増えたのは `targets` を入れた日である。** それまでは固定の軸が 1 つも無かった（K1・K2 のどちらも語で分岐せず、突き合わせるのは変数名そのものだった）。置き場を足したので「その置き場をどう覗くか」の手段が要り、そこだけが体系の側に来た。**置き場の名前・コマンドの綴り・ファイルのパスはすべてカタログにある**ので、基盤を替える日に直るのはカタログの 10 行である。

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識 2 種（否定・線引き）のみで、各 1〜3 行。
- カタログは **1 プロジェクト 1 ファイル**（`docs/specs/backend/config.md`）で、`id` は `config-catalog` 固定である（導出元となる名前が無いため）。
- 行の `id` は**環境変数名そのもの**（SCREAMING_SNAKE）である。K1 がこの文字列で実装の参照と突き合わせる。

### 1 行が宣言すること

| キー | 必須 | 意味 |
|---|:---:|---|
| `id` | ○ | 環境変数名（SCREAMING_SNAKE） |
| `kind` | ○ | 値の性質。`vocabulary.kind` の語（秘密か・公開してよいか・つまみか） |
| `requirement` | ○ | 無いと困る度合い。`vocabulary.requirement` の語 |
| `used_by` | ○ | 何が使うか（1 つ以上）。`vocabulary.used_by` の語。**この軸が連携カタログを兼ねる** |
| `provision` | △ | 調達のしかた。`vocabulary.provision` の語（省略時は先頭の語が既定）。§調達のしかた参照 |
| `targets` | △ | **値がどこに要るか**（置き場）。`vocabulary.target` の語。**省略した行は `requirement` の語の `default_targets` から導出される**。§置き場の軸 参照 |
| `summary` | ○ | 何を制御するかを 1 行で |
| `absence` | ○ | **無いとどうなるか**（挙動で書く） |
| `not_in_template_reason` | △ | 雛形（`app/.env.example`）に行を置かない理由。置かない行だけが持つ（K2 の免除） |

**`absence` を「必須です」と書き換えない。** 求めているのは要求度の言い換えではなく、**鍵が無いときの挙動**である（403 で閉じるのか・例外で落ちるのか・機能が消えて他は動くのか）。ここが埋まっていれば、本番で 1 つ設定を忘れたときに何が起きるかを実装を読まずに辿れる。

**`not_in_template_reason` は `job_spec` の `not_scheduled_reason` と同じ免除方式**である。雛形に置かないという判断も宣言の対象にし、黙って抜けているのと区別する。

### 調達のしかた（`provision`）

**`provision` は行ごとの必須ではない。** `kind` / `requirement` は「無いと行の意味が決まらない」ので必須にしているが、`provision` は省略できる —— **省略した行は `vocabulary.provision` の先頭に宣言した語になる**。秘密の大半は人が外部サービスの画面からコピーしてくるものであり、その語を毎行書かせるのは雑音でしかない。

このアプリでは次の 2 語を宣言し、「人が値を貼る」を先頭（既定）にしている（`docs/specs/backend/config.md` の `vocabulary.provision`）。

- `prompt`（先頭 = 既定） … 人が値を用意し、道具（`app/scripts/setup-secrets.mts`）が対話で聞いて投入する。
- `generate` … **道具が値を作る**（例: `CRON_SECRET` の合言葉）。人には聞かず、生成した値をそのまま投入する。

**「先頭の語が既定」という位置づけの規約だけが体系側のルールであり、どの語を先頭にするか(＝何が既定か)はこのアプリの選択である。** 体系側のコード（`legacy/spec-tools/lib/config/`）は `prompt` という綴りを一切持たない —— 特定の語を仕組み側にリテラルで書くと W1(語彙漏れの検査)が落とす(「軸は仕組み、語はアプリ」— dsl-extension-triage.md §軸と語)。

この軸を持ち込んだ理由は、**道具の側にアプリ固有の変数名を 1 つも書かないため**である。以前の投入手順（`setup-secrets.sh`）は「どの変数を聞き、どれを生成するか」を道具のシェルスクリプトに直書きしており、変数を 1 つ足すたびに道具のコードを直す必要があった（仕組み側の道具にアプリの語彙が漏れる過適合）。`provision` を含めたカタログの全項目を `app/src/domain/generated/config.ts` に生成し、道具はそれを読むだけにすることで、**カタログを直せば道具の挙動もそのまま直る**（notification_spec → `notifications.ts` → ハンドラ、と同じ「仕様 → 生成物 → 実装」の輪）。

`vocabulary.provision` として宣言する以上、他の軸（`kind` / `requirement` / `used_by`）と同じ扱いを受ける —— 閉世界（宣言されていない語は K0 が落とす）であり、語彙そのものはこのアプリの事情（体系側に持たない）。行ごとに必須にしない、という一点だけが他の軸と異なる。

### 置き場の軸（`targets`）

**「値がどこに要るか」は他のどの軸からも出ない。** `kind` は「画面に出してよいか」の軸であり、`requirement` は「無いと困る度合い」の軸である。CI だけに要る秘密・どこにも人が入れないつまみは、どちらの言い換えでも表せない（設計の経緯は非公開の開発記録）。だから置き場は独立の軸にしてある。

#### 宣言するか、導出するか（判定表）

| 状況 | 書き方 | 機械の言うこと |
|---|---|---|
| その要求度の**普通の置き場**に要る | **`targets` を書かない** | `requirement` の語の `default_targets` から導出される |
| 同じ要求度の**例外**（CI だけに要る・開発機だけに要る） | **`targets` を書く** | K0 が語彙に閉じていることと重複が無いことを見る |
| 既定と**同じ集合**を書いた | — | **K0 がエラー**（「導出できるのに宣言しています」）。並びが違っても集合が同じなら落とす |
| 既定が宣言されていない要求度の行 | **`targets` を書く** | 書かなければ K0 がエラー（置き場が決まらない状態を黙って通さない） |
| **どこにも人が入れない**（実行するたびに渡すつまみ） | その要求度の `default_targets: []` を引く（**`targets: []` と書くのは、その要求度の既定が空でないときだけ**） | 空リストは正当な宣言である。doctor の表には出ない |

**両方向にしてあるのは `provision` の「省略したら先頭の語」と違う点である。** `provision` は書き写しても害が少ないが、置き場は行ごとに 1〜3 語を並べるので、**既定を変えた日に「追随しない行」が既定と同じ値を書いた行に埋もれる**。`A15`（導出できるのに宣言していてもエラー）と同じ理由で両方向にしている。

**「その置き場には入れない」という運用の判断も、`targets` の例外として宣言する。** doctor が同じ欠けを毎回言い続けるのは、**カタログが「入れる」と言っているのに入れていない**状態そのものである。入れない判断をしたなら（例: RLS をバイパスする鍵をプレビュー環境には置かない）、その行の `targets` から置き場を外して**宣言の側を事実に合わせる** —— そうすれば doctor の `—` は「まだ入れていない」だけを意味するようになる。宣言を直さずに欠けを見慣れることが、いちばん危ない挙動である（欠けの列が長いと、本当に入れ忘れた 1 本が読めなくなる）。

#### 置き場そのものの宣言（`vocabulary.target`）

```yaml
target:
  - id: dev_machine                  # 語はこのアプリ（が乗っている基盤）の事情
    label: 開発機の app/.env.local
    probe: { kind: dotenv, path: app/.env.local }
  - id: github_secrets
    label: CI の GitHub Secrets
    probe: { kind: command, argv: [gh, secret, list, --json, name] }
    read_by: { kind: workflow_secret, path: .github/workflows }
```

| キー | 必須 | 意味 |
|---|:---:|---|
| `probe` | ○ | その置き場に**どの名前が入っているかを列挙する手**。体系が持つ `kind` の値域は `dotenv`（ファイルの `NAME=` の左辺だけを読む）と `command`（`argv` を実行し、出力に名前が現れるかだけを見る。`cwd` は任意）。**`command` の `argv` は閉じた許可表の形だけ**（`gh secret list --json name` / `vercel env ls {環境名}` / `supabase secrets list [--project-ref {20字}]`。`sh -c`・任意の実行ファイル・パスつきの実行ファイル・`npx` は書けず、検証器がエラーにする。`npx` は実行する位置の `node_modules` や `.npmrc` を拾うので、CLI は人が入れたものを名前で呼ぶ）。**`cwd` は閉じた表（`.` / `app`）のどれか、`dotenv` の `path` はリポジトリの根の中の相対パスだけ**（`..`・絶対パス・`~` はエラー。リンクで外へ出る位置は実行器が拒む）。**`argv` に秘密を書かない** —— 認証は置き場の CLI 側（`gh auth login` / `vercel login`）に任せる。宣言に秘密を置く形は、カタログが「値はここに書かない」と言っていることと矛盾する |
| `read_by` | △ | その置き場の名前を**リポジトリの中で読んでいる場所**。`kind` は `workflow_secret`（GitHub Actions の `secrets.NAME`）。宣言した置き場は K1 の「誰かが読んでいる」側に数えられ、K3 が双方向を見る |

**`probe` の `kind` が 2 語しかないことと、`command` の許可表が閉じていることが、合わせて「道具は値を読まず、任意のコマンドも実行しない」の担保である。** 値を返す形はこの値域に無く、実行できるのは読み取り専用の列挙の形だけなので、どちらも**宣言として書けない** —— 規約で禁じるのではなく、宣言の形で不可能にしてある。許可表は検証器（`lib/model/config/probe-policy.ts`）と実行器（`probe-guard.ts`。config 道具の置き場の中）の両方が持ち、実行器は生成物が書き換えられていても表の外を実行しない（二重）。表の外のコマンドを足したい日は、表を直す変更として人が読む。だから `npm run config:doctor` は AI が回してよい（決定 3-A）。

**なぜ `read_by` が宣言なのか（パスを体系側に固定すれば済む話ではない理由）。** 走査する場所だけなら体系が固定してもよく、その先例もある（`lib/job/verifiers/j2-schedule-parity.ts` の `CRON_CONFIG_FILE = 'app/vercel.json'`）。**足りないのは「見つけた参照をどの置き場に帰属させるか」である** —— K3 は置き場ごとに突き合わせるので、走査で拾った `secrets.NAME` が**どの置き場のもの**かを知らなければ判定を組めない。その対応を体系が持つには置き場の id（このアプリでは `github_secrets`）を仕組み側のコードに書くことになり、そこで初めて W1 に当たる。つまり `read_by` は **K3 を成立させる最小の宣言**であって、W1 を避けるための迂回ではない。`probe.argv` からは導けない（argv は「外の置き場でどう列挙するか」しか語らず、リポジトリの中の読み口には触れない）。副産物として走査する場所も宣言の側に出たので、J2 より一段だけ体系の持ち物が減っている。

**逆向きの注意: doctor は `.env.local` を書かない。** `vercel env pull` は既定でこのファイルを上書きするので、道具が人の手で埋めたローカルの値を踏むのは、この設計で一番やってはいけない事故である。読むのはキー名だけで、書き込む経路は持たない。

#### 置き場に**しない**もの

- **Supabase の Vault**（`cron_secret` / `cron_base_url`）。ここに入る名前は環境変数名ではなく [ADR-0010](../../../../decisions/common/ADR-0010-pg-cron-vercel-trigger.md) が固定した別の名前空間であり、カタログの行（SCREAMING_SNAKE の環境変数名）と 1 対 1 にならない。そのうえ**入れるかどうかは `jobs.md` の `scheduler: database` から導出できる**（`setup-secrets.mts` の `hasPgCronJob()`）ので、宣言すれば「導出できるのに宣言している」側になる。
- **GitHub が自動で配る値**（`GITHUB_TOKEN` 等）。人も道具も入れないので置き場を持たない。使い始めた日には K1 が「宣言がありません」で落ちるので、そのとき扱いを決める（黙って通る経路は無い）。

### 拾える書き方（K1 が突き合わせられる形）

実装が設定を読むときは、**変数名がその場に文字列リテラルとして現れる**形で書く。

- `process.env.NAME` / `process.env['NAME']`
- `requireEnv('NAME')`（無ければ落とすヘルパ。このリポジトリの定型）

`process.env[name]`（名前を変数で受ける）は**拾えない**。ヘルパの内部実装としてはこの形になるが、**呼び出し側にリテラルが現れること**が条件である。走査対象は `app/src` / `app/e2e` / `app/scripts` と、仕組み側の `@kaninabe/runtime` / `@kaninabe/lint-config`（正は `config/env-scan.ts` の `envScanRoots`）。

**拾えない書き方は ESLint が書けなくする**（`@kaninabe/lint-config/policies` の `PROCESS_ENV_SELECTORS`。`npm run lint`）。K1 は名前が文字列リテラルとしてその場にある形しか拾えないので、次の形で読んだ設定は**カタログにも `.env.example` にも無いまま K1・K2 とも緑になる**（網の穴探し 2026-10-06 の M02。ここの規約だけでは執行者が居なかった）。

- 分割代入・別名: `const { NAME } = process.env;` / `const env = process.env;`
- 計算した鍵: `` process.env[name] `` / `` process.env[`NAME`] ``（**例外は 1 つだけ**: `requireEnv` という名前の関数の定義の内側。K1 の 3 つ目の拾い方そのものの実装であり、呼び出し側が `requireEnv('NAME')` とリテラルで渡す）
- `process.env` そのものを値として渡す・並べる・比べる: `use(process.env)` / `{ ...process.env }` / `'NAME' in process.env`
- `requireEnv(name)` のように引数がリテラルでない呼び出し
- **`process.env` の字面を作らない形**: `process` 自体の別名・分割代入・引数・戻り値（`const { env } = process;` / `const p = process;` / `use(process)`）・添字（`process['env']`）・`globalThis.process` / `global.process` 経由・`process` 自体の import（`import { env } from 'node:process'`）・`import.meta.env`（と `import.meta` を変数に束ねる・引数に渡す形。この製品の環境変数は `process.env.NAME` だけで、K1 は `import.meta` を読まない）

**下限として残る形**（静的に決まらないので ESLint は見ない。規約で書かない）: `Reflect.get(globalThis, 'process')` / `const { process: p } = globalThis` / `Object.entries(globalThis)` のような取り出しと、`import.meta` の関数の戻り値経由の読み取り。

書き込み（`process.env.NAME = '…'` / `delete process.env.NAME`）は名前がその場にあるので許される。

### ここに書かないもの（正が割れる）

- **値そのもの**（鍵・URL・トークン） — 環境ごとの運用設定であり、仕様が宣言するのは「何が要るか」だけである。原則は通知カタログと同じ「**何を保証するかは仕様（固定）・値は設定（可変）**」。
- **どのファイルが読んでいるか** — 実装が正であり、K1 が走査して双方向に突き合わせる。カタログに書き写すと二重の正になる。
- **設定を投入する手順**（Vercel の環境変数画面・`supabase secrets set` 等） — runbook（運用文書）の領分。
- **外部サービス側の設定** — Supabase の認証プロバイダ設定（example-idp OAuth のクライアント ID / シークレット）のように、アプリの環境変数として現れないものはこのカタログの閉世界の外である。

### 検証（K 群）

| ID | 何を見るか | 実行場所 |
|---|---|---|
| **K0** | スキーマ適合。`id` の固定値・変数名の形（SCREAMING_SNAKE）・重複・**位置づけの軸（kind / requirement / used_by）と任意の `provision` が宣言された語彙に閉じていること**・`used_by` が 1 つ以上・**`absence` の必須**・**置き場が宣言か導出で必ず決まること（両方向。§置き場の軸 の判定表）**・**`probe` / `read_by` は `target` の語だけが持ち、`target` の語は `probe` を必ず持つこと**・**`default_targets` は `requirement` の語だけが持つこと**・**`logging` の形（`format` の値域・`sink.mode` の値域・`sink.required_in` が置き場の語・`app_direct` の `key_env` が環境変数名の形で `host_drain` は持たない・`sink.exempt` が転送先の欄と排他で `required_in` があるときだけ・`retention.days` が正の整数・`readers` が 1 つ以上）** | ローダー（`lib/model/config/loader.ts` → `parse-target.ts` / `parse-probe.ts`） |
| **K1** | 実装の `process.env` 参照**と、置き場の `read_by` が指す読み口** ⇔ カタログの**双方向**閉世界（読んでいるのに宣言が無い／宣言があるのに誰も読まない） | `lib/config/verifiers/k1-env-reference-parity.ts` |
| **K2** | 雛形 `app/.env.example` ⇔ カタログの**双方向**一致（雛形に無い行は `not_in_template_reason` で免除。免除したのに載っている掃除漏れも落とす） | `lib/config/verifiers/k2-template-parity.ts` |
| **K3** | 置き場の宣言（`targets`）⇔ その置き場の読み口（`read_by`）の**双方向**一致（その置き場に要ると宣言したのに読み口が読んでいない／読み口が読んでいるのに `targets` にその置き場が無い） | `lib/config/verifiers/k3-target-reader-parity.ts` |
| **K4** | 外へ出る URL の設定（ASVS V12.3.1）。`vocabulary.kind` の語が `url: true` を宣言した種類の行は `format: url` と `scheme` を宣言すること／`format: url` の設定を実装の木（テストを除く）で `readConfigUrl('NAME', process.env['NAME'], '<scheme>')` 以外の形で読まないこと／関門に書いた `scheme` がカタログの宣言と同じであること | `lib/config/verifiers/k4-url-format.ts`（読み口の走査は `lib/config/url-read-scan.ts`） |
| **K5** | ログの目録（ASVS V16.1.1・V16.4.3）。設定カタログに `logging` があること／転送先がアプリの動くホストの外にあること（`sink.off_host: true`）／`app_direct` の鍵の環境変数（`key_env`）が `variables` に行を持ち、本番の置き場（`required_in`）に置かれる宣言であること。**導入はマストではない（オプトイン）: 警告は製品が本番の置き場を宣言したとき（`required_in`）だけ** —— 転送先も `exempt` も無ければ警告（未分類）、`exempt: 理由` で外していれば毎回「受け入れた危険」として名指す（`Finding.acceptance`。W5 が宣言の実在を見る）、本番を宣言していなければ何も言わない。**本番の転送先の設定（鍵が本番にあるか）は検査から見えないので、本番を宣言して転送先を持つ製品は、実行ログが毎回 `K5: 未実施 — 本番のログの転送先は未検証です` と名指す**（H5 の本番の設定と同じ扱い） | `lib/config/verifiers/k5-log-sink.ts`（形の検査は K0 = `lib/model/config/parse-logging.ts`） |
| **K6** | 秘密の宣言（ASVS V11.1.1・V11.2.2・V13.2.3）。`vocabulary.kind` の語が `confidential: true` を宣言した種類の行は `rotation` を宣言すること／サービスの認証の秘密（`vocabulary.used_by` の語が `service_auth: true` の使い先の秘密、と外部連携の受信の署名の鍵）は `strength` を宣言すること／`previous` は宣言された行を 1 対 1 で指し、`strength` のある行だけが持ち、種類が同じで連鎖しないこと／`strength` のある秘密（と `previous` の行）を実装の木（テストを除く）で `readServiceSecret('NAME', process.env['NAME'], {min_length})` 以外の形で読まないこと／関門に書いた下限がカタログの `min_length` と同じであること | `lib/config/verifiers/k6-secret-declarations.ts`（読み口の走査は `lib/config/secret-read-scan.ts`。形の検査は K0 = `lib/model/config/parse-secret.ts`） |

#### ログの目録（`logging`。K0・K5）

ログを出すだけでは、侵入されたときに証拠が同じホストごと失われ、何を・どこに・誰が・何日 残しているかも誰にも読めない。設定カタログの最上位に `logging` を **1 つ**置く（必須。無ければ K5 が落とす）。**何を出すか（事象の目録）は仕組みが持つ**（`@kaninabe/runtime/security-log` の `SECURITY_EVENTS`）ので書かない —— ハンドブックの設定の章の「ログの目録」が、この宣言と事象の目録を並べて出す。

| キー | 意味 |
|---|---|
| `format` | `json_lines`（1 行 1 JSON。値域は体系が持つ） |
| `sink` | 転送先の宣言のまとまり。**省略できる**（本番を宣言せず、転送先も書かない = 試験環境・趣味の用途。K5 は何も言わない） |
| `sink.required_in` | 本番の置き場（`vocabulary.target` の語）。**これを書いたときだけ**、転送先が無いと K5 が警告する。省略・空は「本番を宣言しない」 |
| `sink.mode` | 送り方。`app_direct`（アプリから直接送る。`@kaninabe/runtime/log-sink` + adapter。鍵が設定されたときだけ送る = オプトイン）か `host_drain`（配置先のログドレインに任せる） |
| `sink.label` | 転送先の呼び名 |
| `sink.off_host` | 転送先がアプリの動くホストの外にあるか。**`false` は K5 が止める**（ホストに侵入されたとき、証拠も一緒に失われる） |
| `sink.key_env` | `app_direct` の鍵を読む環境変数の名前（`variables` に同じ名前の行を持つ。`host_drain` では書けない）。未設定なら送らず、標準出力だけで正常に動く |
| `sink.configured_in` | 転送先を設定する場所（管理画面・CLI など）。**設定の値やプロバイダの設定キーは書かない**（それは仕様の外にあり、書き写すと二重の正になる） |
| `sink.exempt` | 本番でも転送先を要らない理由（`mode` などの欄とは同時に書けず、`required_in` があるときだけ書ける）。外した製品は verify が毎回「受け入れた危険」として名指す |
| `retention.days` / `retention.reason` | ログを残す日数（正の整数）と、その日数にした理由 |
| `readers` | 読める人の呼び名（1 つ以上。権限の付与は運用） |

**死んだジョブの知らせ先(`dead_letter_alert`)**は `sink` と同じ形の欄である。エラーのログは宣言によらず必ず出る。宛先はそれを人へ届ける口で、鍵が設定されたときだけ、ワーカーが種別と件数だけを送る(`DeliveryChannel` の `dead_letter`)。省略すると `sink.required_in` を継いで宛先なしと読み、本番を宣言していれば K5 が警告する。`sink` が本番を宣言しているのに `required_in` を空で書くと K0 が止める。本番でも要らないなら `exempt: 理由` で外す(毎回受け入れた危険として名指される)。

K5 が見るのは宣言の形・`off_host`・鍵の行の実在と置き場・本番を宣言したときの転送先の有無だけである。**転送先が本当に有効か（鍵が本番に置かれているか）・保管日数が効いているか・読める人が宣言どおりかは検査から見えない**ので、実行ログが毎回「未検証」と名指す（`describeLogSinkRun`）。管理画面で確かめるのは人である。有効にする手順は [logging.md](../../system/standards/conventions/logging.md) の「ホストの外への転送」。

#### 秘密の行（`rotation`・`strength`・`previous`。K0・K6）

秘密は作って終わりではなく、**いつ作り直し・誰が持ち・短すぎる値で口が開かない**ことまで宣言して初めて運用できる。種類の語に `confidential: true`、使い先の語に `service_auth: true` を宣言し、行に次を書く。

| キー | 必須 | 意味 |
|---|:---:|---|
| `vocabulary.kind[].confidential` | △ | その種類の値は秘密である（`true`）。この種類の行は `rotation` が必須（K6）。`kind` の語だけが持てる |
| `vocabulary.used_by[].service_auth` | △ | その使い先は共有秘密だけで口を開ける（サービスの認証）。この使い先の秘密の行は `strength` が必須（K6）。`used_by` の語だけが持てる。外部連携の受信の署名の鍵（`signature_key`）は使い先によらず `strength` が必須 |
| `rotation.every` | ○ | 更新の周期。`"{正の整数} day"` か `"{正の整数} month"`（例 `365 day`） |
| `rotation.procedure` | ○ | 更新の手順（短い文か、手順の文書の場所）。値は書かない |
| `rotation.holders` | ○ | 値を持つ者・置き場の呼び名（1 つ以上。権限の付与は運用） |
| `rotation.reason` | △ | 周期の根拠。**運営がまだ決めていない仮置きの値は「仮置き・運用で決める」と明記する**（組織の事実を発明しない） |
| `strength.min_length` | ○（サービスの認証） | 値の長さの下限（正の整数）。実装は関門で読み、下限に満たない値は**設定されていないものとして口を閉じる**（`absence` と同じ挙動。例外にも表示にも値は出さない） |
| `previous` | △ | 更新の間だけ旧い値も受けるための環境変数名。**旧い値の行は別に宣言する**（`rotation` は免除。`targets: []` にして道具の管理の外に置く運用もできる）。`strength` のある行だけが持つ |

実装の読み方は 1 形である: `readServiceSecret('NAME', process.env['NAME'], 32)`（`@kaninabe/runtime/secret`。TypeScript の構文木で本物の import に束縛されていることまで見る）。更新の間は現在と旧い値の両方を読み、`matchesAnySecret`（または `verifyInboundSignature` に鍵の並びを渡す）で**全部と**定数時間で比べる（どちらに一致したかを時間に出さない — ASVS V11.2.2）。受信の署名の鍵は、生成した配線がカタログの行から同じ形で読む（`strength` と `previous` を運ぶ）。ハンドブックの設定の章の「暗号の目録」が、秘密・受信の署名・ログインセッション・持っていれば効く値を、これらの宣言から 1 表に並べて出す（ASVS V11.1.2。手で書き足す欄は無い）。

#### URL の設定（`format: url` と `scheme`。K4）

外へ出る URL（Webhook・招待・デプロイフック・自分のスタックの接続先）が平文の `http://` に化けると、秘密（Webhook の URL そのもの・Cron の合言葉・service role の鍵）が盗聴される口になる。**種類の語に `url: true` を宣言し、その種類の行は `format: url` と `scheme` を必ず書く**（URL の種類を宣言から漏らさない）。

| キー | 意味 |
|---|---|
| `vocabulary.kind[].url` | その種類の値は URL である（`true`）。この種類の行は `format: url` と `scheme` が必須（K4）。`kind` の語だけが持てる |
| `format: url` | 行の値が URL である。種類を問わず書ける（URL 自体が秘密の Webhook を `secret` の種類に置く製品がある） |
| `scheme` | `https`（https の絶対 URL だけ。既定の選択）／`https_or_loopback`（https に加えて、**自分の機械（`localhost` / `127.0.0.1`）への http だけ**。開発機が自分のスタックにつなぐ接続先用）。`format: url` と対で書き、`scheme` だけ・`format` だけはスキーマ違反（K0）。**外部サービスの URL に `https_or_loopback` を選ばない** |

実装の読み方はカタログが決める。`readConfigUrl('NAME', process.env['NAME'], '<scheme>')`（`@kaninabe/runtime/url`）の 1 形だけが関門で、宣言した `scheme` に合わない値は例外になる（未設定・空は `undefined` のまま返し、挙動は `absence` が持つ）。**例外の文面に値を入れない**（Webhook の URL は URL 自体が秘密）。名前を変数越しに読む書き方は K1 が拾えず、ESLint の `PROCESS_ENV_SELECTORS` が止める。`pg_cron` が叩く先（Vault の `cron_base_url`）は `CRON_BASE_URL` から `setup-secrets` が入れるので、その値も `scheme: https` の関門を通る。

**K3 が閉じるのは「置き場の取り違え」である。** K1 が見るのは「**どこかで**読まれているか」なので、CI だけに要る秘密の行に開発機の置き場を書いても緑のままになる。K3 があると「**CD を通すのに要る設定はこれで全部**」がカタログの側から機械で答えられる —— これが無いあいだ、その答えは workflow の手書きの分岐にしか無かった（設計メモ §1-1 の穴 3）。**挙動は `absence` が持ち、要る場所は `targets` が持ち、workflow はそれを執行するだけ**という向きに直すための検査である。

**なぜ検査群の記号が `K` なのか。** 素直な `C`（config）は既に 3 つの名前空間で使われている — enforcement-matrix の機械執行ルール（C1・C2・C9）、`review-queue`(開発用リポジトリの判断待ち台帳) の判断 ID（C1・C2）、DSL 拡張候補（C-14・C-19）。同じ文字が 4 つ目の意味を持つと、`C2` と書いたときにどれを指すか読み手に決められなくなる。`K` は**構成（Konfiguration）**の頭文字で、他のどの名前空間とも衝突していない。

**実装側の閉世界を突き合わせる検証器は増やしていない。** 通知・ジョブは「仕様 → 生成物 → 実装 → 仕様」の輪を app 側のテストで閉じるが、設定の**値**は実装が assert する対象ではない（値は環境のもの）。K1 が**仕様の側から実装のソースを見に行く**ことで輪は閉じており、この形は変えていない。ただし `app/src/domain/generated/config.ts` という生成物は存在する — 読むのはテストではなく**道具**（`app/scripts/setup-secrets.mts`）であり、「投入時に何を聞き、どう聞くか」を機械的に導出するためのものである。カタログを直せば道具の挙動もそのまま直り、Discord・LINE のような**アプリ固有の変数名を道具のコードに書き写す過適合を避ける**（通知・ジョブの生成物が実装の突合に使われるのと役割は違うが、「仕様が生成物を通じて別の何かを機械的に動かす」という発想自体は同じである）。

### 道具（カタログを読んで動くもの）

| 道具 | 何をするか | AI が回してよいか |
|---|---|---|
| `cd app && npm run config:doctor` | カタログの全行 × 置き場を**名前だけ**で照合し、「○ 有る / — 要るのに無い / ? その置き場を見られなかった / · その置き場には要らない」の表と、欠けた組の `absence` を出す | **よい。** 値を読む経路が宣言の形として無く、置き場に書き込む経路も無く、実行できるのは許可表の読み取り専用の列挙の形だけ（`npx` は書けず、CLI は人が入れたものを名前で起動する）。ただし覗く先の CLI（`gh` / `vercel`）は**開発者のログインのまま**走るので、`config.md` の `probe` の行を変える差分は他人の PR でも読んでから回す |
| `cd app && npm run config:doctor -- --catalog` | 置き場に 1 度も触らず、カタログ側の宣言だけを出す | よい（通信しない） |
| `cd app && npm run setup:secrets` | 本番の秘密を端末で 1 回ずつ貼って投入する | **回さない。** 秘密を貼る作業が中に居る |

**置き場は道具の両側で導出する（照合も投入も）。** doctor は `decl.targets` から照合先を決めるのに、投入の道具が `['production','preview']` を手で持っていた時期があり、束 §20 でカタログから `vercel_preview` が消えたあとも**カタログに無い置き場へ秘密を押し込み、その表を人に見せていた**（束 ①-c-d の独立レビューが発見。K 群は環境変数の**名前**しか見ないので、この乖離を見る口が無かった）。いまは両方が `app/scripts/config/vercel-targets.ts`（純関数）を通り、**Vercel の環境名はカタログの `probe` が宣言する語**である（id の綴りから機械的に作らない）。「カタログに載っているものが全部」は、設定の行だけでなく**置き場**についても言えなければ意味がない。

**doctor は検査ではない。** 置き場を覗くには認証が要り、CI にも開発機にも一様に有るとは言えない。覗けない置き場は `?` のまま**報告して続け**、終了コードは常に 0 である（`verify` とは別の道具であり、`npm run verify` には載せない）。

**「無い」と「見られなかった」を混ぜない。** 未ログインの置き場を「欠けている」と出すと、人は入っている値をもう一度貼りに行く。doctor はこの 2 つを別の印にし、どの置き場を覗けなかったかを件数と理由つきで報告する。

**この旗は 0 件のときにこそ効く。** コマンドが通ったのに**その置き場に要る名前が 1 つも取れなかった**とき、doctor は「全部無い」ではなく**「見られなかった」に倒す** —— 「まだ 1 本も入っていない」と「出力の書式が変わった」を見分ける手が無いからである。「見られなかった」に倒さないと、置き場の CLI が出力の書式を変えた日に**道具の故障が入れ忘れと同じ見え方**になる（`probe` が書式に依存しない形を選んだ代償が、ここに出る）。

**カタログに無い名前は最初から候補に入らない。** 置き場には道具が置く知らない鍵が混じる（`vercel env pull` が置く類）。doctor はそれを**エラーにできる形を持たない** —— 置き場は K1 / K2 のような閉世界にはできないので、閉世界にしようとしない。

**この束で作っていないもの**（設計メモ §5-2 / §5-3）。`config:provision`（欠けを対話で埋め、`targets` の全部に流し、最後に 1 回だけ出し直す）は既存の `setup-secrets.mts` の射程を広げる形で入る。失効する行の差し替え（`rotates` + 期限の Variable + 見張り）は 2 つ目のプロダクトを作る日に入る。**doctor が先で provision が後**なのは、今日の往復の大半が「どれが入っているか誰も知らない」だったからである。

### フレームワークとプロダクトが分かれた日（方針だけ）

**カタログは 1 枚のままにする。** フレームワークが「自分が読む行の宣言」を配り、プロダクトのカタログが `extends` で**取り込む**（継承）。写しを持たない（合成にしない）のは、フレームワークが変数名を改名した日に**手作業のコピーが N 個あると N 回同じ作業をする**からである —— 継承ならバージョンを上げるだけで K1 が「新しい名前を読んでいる実装がありません」で落ち、doctor が「置き場に新しい名前が無い」と言う（設計メモ §2-2 / §2-3）。

**所有の軸（どの行がフレームワークのものか）は今は宣言しない。** カタログが 1 枚・リポジトリが 1 つの今、宣言しても読む者が居ない（検査も道具も分岐しない）。分岐しない区別に専用の軸を持たせないのは doc_types の打ち切り規則そのままである。パッケージ分離の設計を始める日に「宣言 + 検査」の二段で入れる。

### 検証方法

- `npm run verify`（K0・K1・K2・K3 が走る）
- `npm run generate`（カタログのマトリクスとハンドブックの章を再生成）

## 関連ドキュメント

- [job-spec-writing.md](./job-spec-writing.md) — 同型の先行実物。`not_scheduled_reason` の免除方式と、デプロイ設定（`app/vercel.json`）との双方向はここと同じ発想である
- [notification-spec-writing.md](./notification-spec-writing.md) — 「保証は仕様・値は設定」の線引きの出典
- [route-handlers.md](../../system/standards/conventions/route-handlers.md) — `CRON_SECRET` を使う側（共有秘密による認可。未設定なら閉じる）
