---
doc_type: architecture
scope: common
id: ARCH-SP-0002
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0008, PRIN-0010, PRIN-0011]
decisions: [ADR-0003, ADR-0004]
---

# ARCH-SP-0002 — ドメイン仕様（docs/specs/domain）の構成

## 目的

ドメインの形式定義（状態機械・権限・不変条件・フィールド制約）を `docs/specs/domain/` に一元化し、backend / frontend の仕様が**同じ定義を参照するだけで済む**状態を作る。仕様の穴を機械が検出し、人間は意味の正誤だけを見るための土台となる構成を定める。

## 概要

- `docs/specs/` は **domain / backend / frontend** の 3 スコープとする。**`specs/common` は置かない**。ドメイン仕様が共有の頂点であり、FE/BE 共通の契約はドキュメントではなく `specs/domain` からの**生成物**（zod スキーマ・TS 型）が担う。
- `specs/domain` は 5 つの doc_type で構成する: `role_spec` / `entity_spec` / `state_spec` / `access_spec` / `invariant_spec`。
- ロール定義（`roles.md`）のみドメイン全体で 1 つ。残りは**集約（aggregate）ごとのディレクトリ**に固定ファイル名で置く。
- **YAML フロントマターが正**、Markdown 本文の図・表は `<!-- AUTO-GENERATED -->` で生成する（PRIN-0007）。
- 他レイヤー（backend / frontend の spec）は**ドメインイベント ID を参照するだけ**で、状態・権限・制約を再定義しない（PRIN-0007 / PRIN-0008）。

## スコープ

- **対象**: `docs/specs/domain/` のディレクトリ構成・ファイル分割・doc_type の責務分担、他レイヤーの仕様からドメイン定義を参照する際の原則、`specs/domain` を入力とする生成物の置き場所。
- **対象外**:
  - 各 doc_type の YAML スキーマとガード式の文法、検証チェックの内容（→ process/common/specification/standards/domain-spec-writing.md）
  - 表現力を絞った理由・実装方式の判断理由（→ ADR-0003 / ADR-0004）
  - ドメインの業務知識そのもの（用語・なぜ）（→ ドメイン知識層 W。`docs/specs/` の隣）
  - 実装コードの層構成（→ architecture/system）

---

## 構成

```text
docs/specs/domain/
├── README.md                 # doc_type: directory_guide
├── template.role_spec.md     # 各 doc_type のテンプレート（配下の集約ディレクトリからも解決される）
├── template.entity_spec.md
├── template.state_spec.md
├── template.access_spec.md
├── template.invariant_spec.md
├── roles.md                  # doc_type: role_spec（ドメイン全体で 1 つ）
├── item/                     # 集約（aggregate）ごとのディレクトリ
│   ├── entity.md             # doc_type: entity_spec
│   ├── states.md             # doc_type: state_spec
│   ├── access.md             # doc_type: access_spec
│   └── invariants.md         # doc_type: invariant_spec
├── loan/
│   └── （同上）
└── ...
```

### doc_type の責務分担

| doc_type | ファイル | 責務 | ここにしか書かないもの |
|----------|---------|------|----------------------|
| `role_spec` | `roles.md` | ドメイン全体のロール定義。グローバルロール（anonymous / patron / system）と文脈依存ロール（binding 式で「この対象に対して誰がそのロールか」を定義） | ロール ID とその binding |
| `entity_spec` | `{aggregate}/entity.md` | エンティティのフィールド・型・制約（required / max_length / min / max / pattern）と、文脈依存ロールを解決する `context` 宣言 | **フィールド制約の唯一の定義場所**（zod スキーマ生成の源） |
| `state_spec` | `{aggregate}/states.md` | 状態機械。状態・初期/終了状態・イベント（from / to / by / guard / otherwise_forbidden）・effects | 状態遷移と**遷移の実行権限**、ドメインイベント ID、副作用の接続点 |
| `access_spec` | `{aggregate}/access.md` | 読み取り権限（reads / fields_hidden）と、状態を変えないフィールド更新権限（writes） | **読み取りスコープ**と**編集権限** |
| `invariant_spec` | `{aggregate}/invariants.md` | 不変条件の宣言（statement / formal / enforced_by） | 不変条件と**その執行点** |

権限は 3 軸に分かれる。**遷移**（`state_spec` の `by`）/ **読み取り**（`access_spec` の `reads`）/ **編集**（`access_spec` の `writes`）。いずれも列挙されていないものは拒否（deny by default、PRIN-0010）。

### 生成物と置き場所

`specs/domain` は人間のレビュー対象であると同時に、実装・検証の入力である（PRIN-0001）。

| 生成元 | 生成物 | 置き場所 | 用途 |
|--------|--------|---------|------|
| state_spec | mermaid 状態遷移図 + 遷移表 + **state × event マトリクス**（✓遷移 / ✗理由） | 当該 `states.md` 本文（AUTO-GENERATED） | 人間レビュー |
| state_spec + access_spec | ロール × 操作の権限マトリクス表 | 当該ファイル本文（AUTO-GENERATED） | 人間レビュー |
| entity_spec | zod スキーマ + TS 型 | `src/domain/generated/{entity}.schema.ts` | フォーム（即時 FB）と Server Action（本検証）の共通バリデーション |
| state_spec | 遷移テーブルデータ（`as const`） | `src/domain/generated/{machine}.transitions.ts` | 実装（汎用エンジンが読む） |
| access_spec | スコープ定義データ | `src/domain/generated/` | クエリ層のフィルタ + RLS ポリシーとの突合リスト |
| invariant_spec | テスト義務リスト（この INV を検証する統合テストの ID） | 検証器の出力 | trace 検証（仕様⇔テスト突合）への入力 |

遷移ロジックは `src/domain/engine/` の汎用エンジン（`canFire` / `nextState` / ガード式インタープリタ）が生成テーブルを読んで実行する。**遷移ロジックを手で書く場所を作らない**（ADR-0004）。

---

## 命名・分割方針

- **ディレクトリ名 = 集約名**（単数形・スネークケース。例: `item/`, `loan/`）。エンティティ名・状態機械名と一致させる。
- **ファイル名は固定**（`entity.md` / `states.md` / `access.md` / `invariants.md`）。集約ディレクトリを見れば 4 種が揃っているかが目視で分かる。
- **1 集約 1 ディレクトリ**。集約をまたぐ不変条件は、**主たる集約側**の `invariants.md` に置き、`entities:` で関与するエンティティを宣言する。
- ロール定義は分割しない。`roles.md` がドメイン全体で唯一のロールの出典。
- **ドメインイベント ID** は `{state_machine}.{event}` 形式（例: `loan.submit`）。他レイヤーからの参照はこの ID で行う。
- **不変条件 ID** は `INV-{ENTITY}-{NNN}` 形式（例: `INV-LOAN-001`）。
- **spec の `id`** は id_policy どおりファイル・リソース名で管理する（例: `loan-states`, `domain-roles`）。
- **テンプレート**は `docs/specs/domain/` 直下に `template.{doc_type}.md` として置く。同一階層に複数 doc_type が混在するため、`template.md`（汎用）ではなく doc_type 別テンプレートを使う（template_policy）。集約ディレクトリからは「同階層 → 上」の解決でこれらが選ばれる。

---

## 制約・不変条件

- **MUST**: ドメインの状態・権限・フィールド制約・不変条件は `specs/domain` にのみ定義する。backend / frontend の仕様に再定義してはならない（PRIN-0007）。
- **MUST**: `specs/domain` の YAML フロントマターを正とする。本文の図・表は生成物であり、手書きしない（次回生成で上書きされる）。
- **MUST**: 他レイヤーの仕様は、ドメインの操作をドメインイベント ID で参照する。
  - `specs/frontend` の画面仕様: アクションに `emits: loan.submit` を宣言
  - `specs/backend` の Server Action 仕様: `handles: loan.submit` を宣言
  - `specs/backend/external` の Webhook / Cron 仕様: `emits:` を宣言（`by: [system]` のイベントの発火元）
- **MUST NOT**: `docs/specs/common/` を新設しない。FE/BE 共通の型・バリデーションは `specs/domain` からの生成物で解決する。
- **MUST NOT**: 集約ディレクトリに 4 種以外のファイルを置かない（新しい種類が必要になったら doc_type を追加し、この文書と doc_types.md を同時に更新する）。
- **SHOULD**: 集約は「同一トランザクションで整合性を守る単位」で切る。判断に迷う場合は不変条件（`invariants.md`）が閉じる単位を優先する。

---

## 配置ルールと方針

### ドメイン記述の 3 分担

ドメインの記述は 3 箇所に分かれる。書き分けの目安は「**検証器が読む必要があるか**」。

| 置き場所 | 何を書くか | 性質 |
|---------|-----------|------|
| ドメイン知識層（W。`docs/specs/` の隣） | 知識（用語の意味・なぜそうなっているか・業務例） | 人間が読む。機械検証の対象外 |
| `docs/specs/domain/` | 形式定義（状態・権限・制約・不変条件） | **機械検証の対象**。生成物の源 |
| `src/domain/` | 実装（生成された型 + 純粋関数） | 生成物 + 手書きの純粋関数 |

### 他レイヤーからの参照の検証

ドメインイベント ID を共通通貨とすることで、レイヤー間の接続そのものを機械検証できる（PRIN-0008）。以下は DSL 本体の外（`legacy/spec-tools/` 側）で実装する追加検証である。

- 人間ロールが実行できる全イベントに、UI 上の到達経路（`emits`）が 1 つ以上あるか。無い場合は画面仕様側で `exposure: none（理由）` の明示を必須とする。
- `by: [system]` のイベントに Webhook / Cron の発火元があるか。
- 画面 / Server Action が未定義のイベント ID を `emits` / `handles` していないか。

### 時間駆動遷移の表現

「期限が来たら自動で overdue」のような時間駆動の進行は、新しい構文を作らず、**`by: [system]` の通常イベント**（例: `loan.report_overdue`）+ Cron 仕様側の `emits:` で表現する。時間駆動が「特別なもの」にならず、上記の発火元検証にそのまま乗る。

### 各 doc_type の書き方

YAML スキーマ・ガード式の文法・検証チェック（V1〜V12）は process/common/specification/standards/domain-spec-writing.md に定める。この文書は「どこに何を置くか」に限定する。

---

## 補足（移行・トレードオフ）

### specs/common を廃止した理由

参考にした体系の `api_contract`（FE/BE 間の API インターフェース契約）は「**別コードベース・別チームの国境の条約**」であり、Next.js のモノリスでは国境が存在しない。契約文書として二重管理する代わりに、`specs/domain` の YAML から zod スキーマ / TS 型を生成し、サーバー（本検証）もフォーム（即時 FB）も**同じものを import** する形に置き換える。Server / Client の境界は契約文書ではなくリンター（`server-only` + import 境界）と型で守る。

バリデーション仕様を frontend ではなく domain のフィールド制約に統合するのも同じ理由による（フィールド制約は業務の制約であって UI の都合ではない）。

**復活条件**: ネイティブアプリ等、別コードベースの利用者が現れた時点で `specs/common` と契約文書を復活させる。その際は ADR を書く。

### v1 で扱わないもの

- **階層状態・並行状態機械**: v1 はフラットな状態機械のみ。直交する軸（貸出状態 × 取り置き状態など）は、エンティティに**複数の直交状態フィールド**を持たせてフラットな機械の合成で表現する。
- **集計を含む制約**（貸出冊数の合計上限など）: 意図的に DSL 外とし、operation 内の純粋関数 + テスト + `enforced_by: application` 宣言で扱う（ADR-0003）。
- **台帳（ポイント残高・ローリング期限）**: v2 で `ledger` 専用 doc_type を検討する。
