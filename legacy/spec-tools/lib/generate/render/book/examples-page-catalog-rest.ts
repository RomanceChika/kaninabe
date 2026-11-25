/**
 * 「書き方の例」章のデータ(続き)。操作以外の 8 カテゴリ
 * (読み取り・画面・通知・ジョブ・設定・保証・RPC migration・統合テストのスコープ条件の見張りテスト)。
 * 索引・抜粋の考え方は examples-page-catalog.ts の頭のコメントを見よ。
 */

import { code, sign, spec } from './examples-page-types.js';
import type { ExampleCategory } from './examples-page-types.js';
import { GUARANTEE_TABLE_HEADING } from '../guarantee-headings.js';
import { baseDirSource, INFRA_TESTS, infrastructureSource } from './examples-sources.js';
import { migrationPath } from '../../../model/product/paths.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import type { ProductRoots } from '../../../model/product/types.js';

export function exampleCategoriesRest(roots: ProductRoots, layout: ProductLayout): readonly ExampleCategory[] {
  return [
  {
    title: '読み取りを足す(query_spec 1 本 + 写像)',
    intro:
      '`workshop_my_list`(世話役の担当催し一覧)を題材にする。上界(RLS)は `member = all` と広いままで、' +
      '「自分の催しだけ」を成立させているのは**スコープ条件**(`via: organizer` の binding の写し)だけという、' +
      'スコープ条件が要る典型例である(`/add-query` 判定 3)。',
    examples: [
      {
        title: 'workshop_my_list — スコープ条件を持つ一覧',
        intro: '',
        steps: [
          { label: '仕様の抜粋', excerpt: spec(roots, 'backend/queries/workshop/workshop_my_list.md', '宣言') },
          {
            label: '実装の抜粋(生成物の適用)',
            bridge:
              'スコープ条件そのものは `npm run generate` の生成物(`query-windows.ts`)が持つ。写像はそれを' +
              ' `applyActorConditions` に渡すだけで、絞り込みの条件式を手で書き直さない。',
            excerpt: code(infrastructureSource(layout, roots, 'workshop/queries.ts'), 'query-window-mapping', 'ts'),
          },
          {
            label: 'テストの抜粋',
            bridge: 'スコープ条件の見張りテスト(TC-WORKSHOP-MY_LIST-002)の実物は次の「統合テストのスコープ条件の見張りテスト」節で見る。',
            excerpt: spec(roots, 'backend/queries/workshop/workshop_my_list.md', 'テストケース'),
          },
        ],
      },
    ],
  },
  {
    title: '画面を足す(screen_spec + testid の葉 + screenTest)',
    intro: '`organizer_entries`(世話役の申込み管理画面)の操作一覧を題材にする。',
    examples: [
      {
        title: 'organizer_entries — actions と screenTest',
        intro: '',
        steps: [
          { label: '仕様の抜粋', excerpt: spec(roots, 'frontend/screens/organizer/organizer_entries.md', '操作（actions）') },
          {
            label: '生成物の抜粋(testid の葉)',
            bridge:
              '生成 testid は `{画面名}.{layout のスロットパス}`(overlay は' +
              ' `{画面名}.overlay.{overlay id}.{スロットパス}.{部品}`)の形をとり、実装は生成物と同じキーで骨格と文言を引く' +
              '(詳細は screen-spec-writing.md と `code-testids.ts`)。',
            note: '実際の定数表は `app/src/domain/generated/testids.ts` に生成されるが、この章は `app/src/app/**` に印を持てない。',
          },
          {
            label: 'テストの抜粋(screenTest)',
            bridge: 'screenTest の母集合は screen_spec 自身のテストケース表がそのまま全部である。',
            excerpt: spec(roots, 'frontend/screens/organizer/organizer_entries.md', 'テストケース'),
            note: '実装の抜粋は⑩a(アクション実行器)完了後 —— 部品の書き方が実行器に統一されてから写す。',
          },
        ],
      },
    ],
  },
  {
    title: '通知を足す(effects 1 要素 + カタログ 1 項目 + 表 1 行)',
    intro:
      'entry.submit の effects に載る `notify_organizer_new_entry` を題材にする(仕様の抜粋は' +
      '「操作を足す」節の entry.submit を見よ —— 1 つの通知 ID が action_spec とカタログの両方に現れる)。',
    examples: [
      {
        title: 'notify_organizer_new_entry — カタログの 1 行',
        intro: '',
        steps: [
          { label: '仕様の抜粋(語彙)', excerpt: spec(roots, 'backend/notifications.md', '語彙(このカタログが宣言する値域)') },
          {
            label: '生成物の抜粋(カタログの全数)',
            bridge:
              '1 行だけ抜き出すと「カタログに載っているものが全部」であることが伝わらないため、全数表をそのまま見せる。' +
              'effects との双方向の閉世界は N1 が見ている。',
            excerpt: spec(roots, 'backend/notifications.md', '通知の全数(effects と双方向に閉じている)'),
          },
          {
            label: '実装の抜粋(ハンドラ表 1 行)',
            bridge:
              '通知 ID → 発火元イベント → 宛先の対応は、ハンドラの登録表にも同じ 1 行として現れる' +
              '(文面・宛先の値は実装に無く、カタログの `summary` と運用設定から来る)。',
            excerpt: code(baseDirSource(layout, roots, { layer: 'operation', dir: 'jobs' }, 'handlers.ts'), 'notification-handler-row', 'ts'),
          },
          {
            label: 'テストの抜粋',
            excerpt: spec(roots, 'backend/notifications.md', 'テストケース'),
          },
        ],
      },
    ],
  },
  {
    title: 'ジョブを足す',
    intro: 'entry.submit が積む `notify_organizer_new_entry` ジョブを題材にする。',
    examples: [
      {
        title: 'notify_organizer_new_entry — outbox に積まれるジョブ',
        intro: '',
        steps: [
          {
            label: '仕様の抜粋(全数)',
            excerpt: spec(roots, 'backend/jobs.md', 'イベントで積まれるジョブ(outbox。effects と双方向に閉じている)'),
          },
          {
            label: '生成物の抜粋(実装の対応)',
            bridge: 'ジョブ ID からハンドラの実装モジュールへの対応もカタログの一部であり、実在は検査される。',
            excerpt: spec(roots, 'backend/jobs.md', '実装(実在も検査される)'),
          },
        ],
      },
    ],
  },
  {
    title: '不変条件に「空かどうか」を書く',
    intro:
      '`INV-WORKSHOP-CHECK-002`(システム連動の項目は人が消し込めない)を題材にする。' +
      '`is null` / `is not null` を書けるのは**不変条件の `formal` だけ**であり、' +
      'ガード・`when`・`binding`・`filters` に書くとパースの段で落ちる(束 ㉒)。',
    examples: [
      {
        title: 'INV-WORKSHOP-CHECK-002 — 「空でないなら〜できない」を含意 1 本で書く',
        intro: '',
        steps: [
          {
            label: '生成物の抜粋(一覧表)',
            bridge:
              '含意・同値は 2 本に割って `or` 1 つで書く —— 括弧は文法に無いが、' +
              '`and` は `or` より強く結合するので 1 本の式に収まる。' +
              '生成された一覧表が `check(...)` の全文を持つので、日本語の statement と' +
              '機械が読む式を**同じ表の同じ行で**突き合わせられる。',
            excerpt: spec(roots, 'domain/workshop_check/invariants.md', '催しチェック項目の不変条件'),
          },
        ],
      },
    ],
  },
  {
    title: '設定を足す',
    intro: '`CRON_SECRET`(未設定なら閉じる設定の代表例)を題材にする。',
    examples: [
      {
        title: 'CRON_SECRET — 未設定なら閉じる',
        intro: '',
        steps: [
          {
            label: '仕様の抜粋(未設定のときの原則)',
            bridge:
              '設定もカタログに載っているものが全部で、行ごとに「無いとどうなるか」を宣言する(全数の表は config.md の生成ブロック。行が増えると 1 例の上限を超えるので、ここでは表ではなく原則の段落を見せる)。',
            excerpt: sign(roots, 'backend/config.md', '未設定を「素通し」の理由にしない'),
          },
        ],
      },
    ],
  },
  {
    title: '保証の見張りテストを紐づける',
    intro: '`writes_only_via_rpc`(書き込みは RPC だけ)を題材にする —— 見張りテストを宣言していない保証は無い。',
    examples: [
      {
        title: 'writes_only_via_rpc — 見張りテストの宣言',
        intro: '',
        steps: [
          {
            label: '仕様の抜粋(台帳)',
            excerpt: spec(roots, 'backend/guarantees.md', GUARANTEE_TABLE_HEADING),
          },
          {
            label: 'テストの抜粋(見張りテスト)',
            bridge: '見張りテストの定義は「これが崩れたら必ず赤くなる」こと。ここでは直接 INSERT / UPDATE / DELETE の権限が 1 つも無いことを確かめる。',
            excerpt: code(baseDirSource(layout, roots, INFRA_TESTS, 'guarantees/no-direct-writes.test.ts'), 'guarantee-canary-test', 'ts'),
          },
        ],
      },
    ],
  },
  {
    title: 'RPC migration を読む(遷移 1 本)',
    intro:
      '`apply_entry_transition`(状態更新 + outbox 投入を同一トランザクションで行う RPC)を題材にする。' +
      '**いまはこの本文は生成物である**(data_table の `functions[].migration` が生成先を宣言する。束 ⑳-2)—— ' +
      'ここに引くのは最初に手で書かれた版であり、生成器が写す「形」そのものが読み取れる。' +
      '**いまの本文はさらに `by`(ロール)とガードの述語を持つ**(束 ⑳-3。engine は先読みに降格した)—— ' +
      '下の「判断は TS」は歴史であり、いまの分担は server-actions.md §RPC が `by` とガードを守る が正である。',
    examples: [
      {
        title: 'apply_entry_transition — 原子的な書き込みと監査の形(⑳-3 より前の版)',
        intro: '',
        steps: [
          {
            label: '仕様の抜粋',
            bridge: '判断(canFire)と原子的な書き込み(RPC)の分担は ARCH-BE-0013 / ARCH-BE-0015 が正であり、from/to/guard/effects は state_spec からの導出である。',
            excerpt: spec(roots, 'backend/actions/entry/submit.md', '前提と帰結（ドメイン仕様からの導出）'),
          },
          {
            label: '実装の抜粋(RPC 本体)',
            bridge:
              '`expected_state` を WHERE に含めることで、判断から書き込みまでの間に他者が状態を動かしていたら 0 行更新(競合)になる。' +
              'この形は生成器(`code-rpc-bodies`)の規則そのものであり、いまは宣言を書けば同じ本文が出る。',
            excerpt: code(migrationPath(roots, '20260806000006_apply_entry_transition.sql'), 'rpc-transition-migration', 'sql'),
          },
          {
            label: 'テストの抜粋(競合)',
            excerpt: code(baseDirSource(layout, roots, INFRA_TESTS, 'entry/submit.test.ts'), 'transition-conflict-test', 'ts'),
          },
        ],
      },
    ],
  },
  {
    title: '統合テストのスコープ条件の見張りテストを書く',
    intro:
      '`/add-query` ⑤の「スコープ条件の見張りテストの作り方」を、`workshop_my_list` の実物のテストで見せる。' +
      '上界に頼らない実行者の選び方(親の `reads` が `all` で、スコープ条件だけが自分の分を作っているケース)がここで採られている。',
    examples: [
      {
        title: 'workshop_my_list — 上界に頼らない実行者の選び方',
        intro: '',
        steps: [
          {
            label: '実装の抜粋',
            bridge: 'スコープ条件を消す(`applyActorConditions` の呼び出しをコメントアウトする)とこの経路は全員の催しを返すようになる —— それを赤くするのが見張りテストの仕事である。',
            excerpt: code(infrastructureSource(layout, roots, 'workshop/queries.ts'), 'query-window-mapping', 'ts'),
          },
          {
            label: 'テストの抜粋(スコープ条件の見張りテスト TC-WORKSHOP-MY_LIST-002)',
            bridge:
              '上界(RLS)は他人の催しも通してしまう(`member = all`)。この一覧から他人の分を落としているのはスコープ条件だけであり、' +
              'それを他人の名義で立てた行 1 件だけで確かめる —— 0 件で返ればスコープ条件が効いている。',
            excerpt: code(
              baseDirSource(layout, roots, { layer: 'composition', dir: '__tests__' }, 'workshop/workshop_my_list.test.ts'),
              'window-canary-test',
              'ts',
            ),
          },
        ],
      },
    ],
  },
  ];
}
