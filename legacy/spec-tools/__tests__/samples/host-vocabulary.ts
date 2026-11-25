/**
 * サンプルシステムの**生成物**に、この生成器が住むリポジトリ(製品)の語が出ていないことの走査。
 *
 * W1(`lib/generality/verifiers/w1-vocabulary-leak.ts`)は**仕組み側コードの文字列リテラル**を
 * 見るが、それでは捕まらない漏れが 2 種類ある ——
 *   - 生成器の**散文**(確認文言・doc コメント・用語表)に埋まったアプリの語
 *   - 生成器が自分の位置から読んだ**実ファイル**(「書き方の例」の抜粋)
 * どちらも「別のシステムの生成物にこちらのアプリの語が出る」形で現れ、束 ⑱ の 4 題材が
 * 9 件実測した(builder-report-18-rooms.md §5)。W1 の視界の外なので、**出力の側**から見る。
 *
 * 判定は 1 つだけである: **ホストの仕様に現れ、サンプルの仕様には 1 度も現れない語**が、
 * サンプルの生成物に出ていたらそれは漏れである(サンプルの仕様から導けない語の出どころは
 * 仕組み側しか無い)。ホストの語彙と交わらない一般語(フレームワークの定型文)は候補に入らない。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadSpecModel } from '../../lib/model/loader.js';
import { allMachines, type SpecModel } from '../../lib/model/types.js';

/** 漏れ 1 件。 */
export interface VocabularyLeak {
  /** 生成物のパス(リポジトリルート相対)。 */
  readonly file: string;
  /** 出ていた語。 */
  readonly word: string;
}

/**
 * **プラットフォームの語**(SQL / HTML / JS の固定トークン)。綴りがホストの仕様の id と同じ
 * だけであり、生成物に出ていても漏れではない。
 *
 * W1 の `KNOWN_COLLISIONS` と同じ性質の宣言であり、**理由を書いたうえで個別に挙げる**
 * (走査そのものを無力化しない範囲に効果を限定するため)。日本語の一般語はここに足さず、
 * 散文を書き換えて避ける —— 生成物の文面はこちらで直せるからである。
 */
const PLATFORM_TOKENS: readonly { readonly word: string; readonly reason: string }[] = [
  { word: 'revoke', reason: 'SQL の権限文(`revoke all on function … from public;`)。複合 RPC の migration が必ず持つ' },
  {
    word: 'enable',
    reason: 'SQL の DDL(`alter table … enable row level security;`)。RLS のポリシーの生成 migration が必ず持つ',
  },
  { word: 'disabled', reason: 'HTML の属性(生成フォームの送信ボタン)' },
  { word: 'submit', reason: 'HTML の `type="submit"` と送信ハンドラの名前(生成フォーム)' },
  { word: 'resolve', reason: 'JS の Promise の語(生成フォームの非同期の結線)' },
  {
    word: 'confirm',
    reason:
      'action_spec の `ux.confirm`(DSL のキー名)であり、ハンドブックの操作一覧が「方針」の欄に' +
      'そのまま出す。W1 の KNOWN_COLLISIONS が同じ語を同じ理由で受理している',
  },
  {
    word: 'accept',
    reason:
      '製品の遷移 `accept` と綴りが同じだが、拾っているのは DSL のキー(usecase_spec の `accept:`)。' +
      '人向けの表示のタスクの章がそのまま出す(`confirm` と同じ性質)',
  },
  { word: 'link', reason: 'HTML で書き出した本の頭の `<link rel="stylesheet">`(本の資材の読み込み。製品の遷移 `link` と綴りが同じ)' },
];

/** ASCII の id は語境界で、日本語の表示名は部分一致で探す。 */
function occurrence(word: string): RegExp {
  return /^[\x20-\x7e]+$/.test(word) ? new RegExp(`\\b${word}\\b`) : new RegExp(word);
}

/**
 * 仕様モデルに現れる語(id と表示名)を集める。
 *
 * id は集約・状態・イベント・settles・ロール、表示名は集約・欄・状態・イベント・ロール・
 * settles・enum の値の `label` である。**表示名まで見るのが要点**で、実測された漏れの多くは
 * 「メンバー」「枠主」のような label だった(id は W1 が既に見ている)。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @returns 語の集合(2 文字以上のものだけ。1 文字は偶然の一致が多すぎる)
 */
export function vocabularyOf(model: SpecModel): ReadonlySet<string> {
  const words = new Set<string>();
  const add = (word: string | undefined): void => {
    if (word !== undefined && word.trim().length >= 2) words.add(word.trim());
  };
  for (const [aggregate, specs] of model.aggregates) {
    add(aggregate);
    add(specs.entity?.label);
    for (const field of specs.entity?.fields ?? []) {
      add(field.label);
      for (const label of Object.values(field.labels ?? {})) add(label);
    }
  }
  for (const { machine } of allMachines(model)) {
    for (const state of machine.states) add(state);
    for (const label of Object.values(machine.stateLabels)) add(label);
    for (const event of machine.events) {
      add(event.id);
      add(event.label);
    }
    for (const [id, label] of Object.entries(machine.settlesVocabulary)) {
      add(id);
      add(label);
    }
  }
  for (const role of model.roles.roles) {
    add(role.id);
    add(role.label);
  }
  return words;
}

/**
 * ホストの語彙のうち、サンプルの仕様に 1 度も現れないものを候補にする。
 *
 * サンプル側は**仕様の生テキスト全体**で見る(語彙の宣言だけでなく、説明文・標識に出ていれば
 * その語はそのシステムのものである)。
 *
 * @param host ホスト(この生成器が住むリポジトリ)の語彙
 * @param sample サンプルの語彙
 * @param sampleSpecText サンプルの仕様の生テキスト(全ファイルを連結したもの)
 * @returns 生成物に出てはいけない語
 */
export function forbiddenWords(
  host: ReadonlySet<string>,
  sample: ReadonlySet<string>,
  sampleSpecText: string,
): readonly string[] {
  const platform = new Set(PLATFORM_TOKENS.map((entry) => entry.word));
  return [...host]
    .filter((word) => !platform.has(word) && !sample.has(word) && !sampleSpecText.includes(word))
    .sort();
}

/**
 * ホストのドメイン仕様を読む(走査の母集合)。
 *
 * @param repoRoot この生成器が住むリポジトリのルート
 * @returns 語の集合。仕様が読めなければ空
 */
export function hostVocabulary(repoRoot: string): ReadonlySet<string> {
  const { model } = loadSpecModel(path.join(repoRoot, 'docs/specs/domain'), { repoRoot });
  return model === null ? new Set<string>() : vocabularyOf(model);
}

/**
 * サンプルの生成物を走査して、ホストの語が出ている箇所を返す。
 *
 * @param args ホストのリポジトリルート・サンプルの仕様モデル・仕様ツリーのルート・生成物
 * @returns 漏れの一覧(ファイル・語)。空なら健全
 */
export function findVocabularyLeaks(args: {
  readonly hostRepoRoot: string;
  readonly sampleModel: SpecModel | null;
  readonly sampleSpecFiles: readonly string[];
  readonly generatedFiles: ReadonlyMap<string, string>;
}): readonly VocabularyLeak[] {
  const sample = args.sampleModel === null ? new Set<string>() : vocabularyOf(args.sampleModel);
  const specText = args.sampleSpecFiles.map((file) => readFileSync(file, 'utf-8')).join('\n');
  const forbidden = forbiddenWords(hostVocabulary(args.hostRepoRoot), sample, specText);
  const leaks: VocabularyLeak[] = [];
  for (const [file, content] of args.generatedFiles) {
    for (const word of forbidden) {
      if (occurrence(word).test(content)) leaks.push({ file, word });
    }
  }
  return leaks;
}
