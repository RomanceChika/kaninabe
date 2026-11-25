/**
 * 「書き方の例」章(docs/book/examples.html)のデータ(索引・題材・抜粋の指定)。
 *
 * 内容の正はここではなく実コード・実仕様である —— このファイルが持つのは
 * 「どのファイルのどこを、どの順で、どんな文で繋いで見せるか」という**編集方針**だけで、
 * 中身の文字列(コード・表)は一切書かない。詳細は code-examples.md「印の文法」が正。
 *
 * 索引は CLAUDE.md ルーティング表の並び(操作 → 読み取り → 画面 → 通知 → ジョブ → 設定 →
 * 保証 → RPC → 統合テスト)に揃える —— 「次にどれを読むか」の動線を二重に作らないため。
 */

import { code, spec } from './examples-page-types.js';
import type { ExampleCategory } from './examples-page-types.js';
import { baseDirSource, INFRA_TESTS, operationSource } from './examples-sources.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import { runtimeSrcPath } from '../../../io/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** 全カテゴリ(章の索引の並びそのもの)。 */
export function exampleCategories(roots: ProductRoots, layout: ProductLayout): readonly ExampleCategory[] {
  return [
  {
    title: '操作を足す(5 形それぞれ 1 例)',
    intro:
      '`/add-operation` の⑤(5 形の判定)に出てくる 5 つの形を、実物 1 本ずつで見せる。' +
      'どれも「仕様の抜粋(action_spec) → 生成物の抜粋(ドメイン仕様からの導出) → 実装の抜粋 → テストの抜粋」の順で並ぶ。',
    examples: [
      {
        title: '遷移 — entry.submit',
        intro: '状態が動く形。判断・拒否の写像・競合の扱いは `_template/transition.ts` が持ち、実装は個性だけを渡す。',
        steps: [
          { label: '仕様の抜粋', excerpt: spec(roots, 'backend/actions/entry/submit.md', '宣言') },
          {
            label: '生成物の抜粋',
            bridge: 'action_spec は `input` と `handles` しか書かない。from/to/guard/effects はドメイン仕様(state_spec)からの導出だ。',
            excerpt: spec(roots, 'backend/actions/entry/submit.md', '前提と帰結（ドメイン仕様からの導出）'),
          },
          {
            label: '実装の抜粋',
            bridge: '渡すのは「何を読むか・ロールをどう解決するか・ガードに何を載せるか・どう永続化するか」の 4 つだけ。',
            excerpt: code(operationSource(layout, roots, 'entry.submit'), 'operation-transition', 'ts'),
          },
          {
            label: 'テストの抜粋',
            bridge: '判断から書き込みまでの間に状態が動いていたら 0 行更新 = `conflict` になる(楽観的並行制御)。',
            excerpt: code(baseDirSource(layout, roots, INFRA_TESTS, 'entry/submit.test.ts'), 'transition-conflict-test', 'ts'),
          },
        ],
      },
      {
        title: '作成 — entry.create',
        intro: '行を新しく作る形。判断は `canCreate`、実装は `creates` の条件を満たす事実を集めるだけ。',
        steps: [
          { label: '仕様の抜粋', excerpt: spec(roots, 'backend/actions/entry/create.md', '宣言') },
          {
            label: '生成物の抜粋',
            bridge: '`by` ごとの `when` は access_spec の `creates` からの導出で、action_spec には現れない。',
            excerpt: spec(roots, 'backend/actions/entry/create.md', '前提と帰結（ドメイン仕様からの導出）'),
          },
          {
            label: '実装の抜粋',
            bridge:
              '作成の操作は**手で書かない**(束 ⑰)。仕様から導いた実行計画を、唯一の実行器が' +
              'この順で実行する —— 読む → 手順ごとに `permit` → 不変条件 → RPC を 1 回 → 拒否の写像。',
            excerpt: code(runtimeSrcPath('operation/_template/run-plan.ts'), 'operation-run-plan', 'ts'),
          },
          {
            label: 'テストの抜粋',
            bridge: 'テストの一覧はカタログ(テストケース表)がそのまま全部である。',
            excerpt: spec(roots, 'backend/actions/entry/create.md', 'テストケース'),
          },
        ],
      },
      {
        title: '削除 — entry.delete',
        intro: '行を消して以後どこからも参照しない形。判断は `canDelete`、作成と対になる定型を持つ。',
        steps: [
          { label: '仕様の抜粋', excerpt: spec(roots, 'backend/actions/entry/delete.md', '宣言') },
          { label: '生成物の抜粋', excerpt: spec(roots, 'backend/actions/entry/delete.md', '前提と帰結（ドメイン仕様からの導出）') },
          {
            label: '実装の抜粋',
            bridge:
              '形ごとに違うのは**②の照会先だけ**である(`canFire` / `canCreate` / `canDelete` / ' +
              '`canWrite`)。実行器はその 1 か所で分岐し、拒否の写像から先は形によらず同じ道を通る。',
            excerpt: code(runtimeSrcPath('domain/step-decision.ts'), 'operation-decide', 'ts'),
          },
          { label: 'テストの抜粋', excerpt: spec(roots, 'backend/actions/entry/delete.md', 'テストケース') },
        ],
      },
      {
        title: '編集・単行 form — entry.update',
        intro: '1 つの対象 × 複数フィールドを 1 回の送信で書く形(編集フォームの送信)。',
        steps: [
          { label: '仕様の抜粋', excerpt: spec(roots, 'backend/actions/entry/update.md', '宣言') },
          {
            label: '実装の抜粋',
            bridge:
              '変更される全フィールドをそれぞれ照会し、1 つでも拒否されたら全体を拒否する —— ' +
              '数えるものが形によって違う(対象か欄か)のはここだけである。',
            excerpt: code(runtimeSrcPath('operation/_template/run-plan-decide-core.ts'), 'operation-decide-update', 'ts'),
          },
          { label: 'テストの抜粋', excerpt: spec(roots, 'backend/actions/entry/update.md', 'テストケース') },
        ],
      },
      {
        title: '編集・バルク形 — program_item.update',
        intro:
          '複数の対象 × 固定フィールドを 1 回のまとまりとして書く形(一括並べ替え等)。' +
          '実物は `program_item/update.ts` 1 本だけだが、この章が実コードに印を持てるのは `entry/**` に限るため、' +
          'ここでは定型(`_template/update.ts`)が要求する設定の形までを示す(具体呼び出しは仕様の抜粋で読む)。',
        steps: [
          { label: '仕様の抜粋', excerpt: spec(roots, 'backend/actions/program_item/update.md', '宣言') },
          { label: '生成物の抜粋', excerpt: spec(roots, 'backend/actions/program_item/update.md', '前提と帰結（ドメイン仕様からの導出）') },
          {
            label: '実装の抜粋(定型の設定)',
            bridge: '一括であることが足す制約(1 回の読み取り・全項目への照会・1 回の永続化)はすべて定型側が持つ。',
            excerpt: code(runtimeSrcPath('operation/_template/update.ts'), 'operation-update-bulk-template', 'ts'),
          },
        ],
      },
    ],
  },
  ];
}
