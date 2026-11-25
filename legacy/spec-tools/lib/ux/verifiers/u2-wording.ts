/**
 * U2 操作の語の一貫性。
 *
 * ux-lint.md の U2:「同じ操作(イベント ID / 予約 ID)の語は、画面をまたいで同じにする」。
 *
 * 画面ごとに同じ操作の呼び名が違うと、利用者は「これは前にやったあれと同じ操作か」を毎回考える。
 * 語の出どころはどれも宣言された文字列である —— 状態機械のイベントの `label`(`{machine}EventLabels` として
 * 生成され、行のボタンと確認の見出しの既定の語になる)・重ね表示の `label`(確認の見出しと実行ボタンの語)・
 * `kind: form` の部品の `label`(その操作のフォームの見出し)。**生成物が語を宣言から引くようになった**ので、
 * 画面をまたぐ比較が静的にできる(この検査が長く空き番号だったのは、ボタンの語が実装の手書きだったため)。
 *
 * 比べるのは**画面と画面の間**だけである。ある画面が操作に当てる語は、その画面が書いた `label`
 * (重ね表示 → フォーム)があればそれ、無ければイベントの `label`(状態機械の操作のみ)とし、
 * 2 つ以上の画面で語が食い違えば指摘する。**単一画面の中の「ボタンの語と確認の語が違う」は対象外**
 * (確認の見出しは「何をしようとしているか」を言う語で、ボタンと同じである必要はない)。
 * 予約 ID(`create` / `update` / `delete`)の既定の語(生成された表の「登録」「保存」「削除」)は
 * 汎用の語で役割が違うので、画面が書いた `label` どうしだけを比べる。
 */

import type { SourceLocation, SpecModel } from '../../model/types.js';
import type { ScreenSpec } from '../../model/screen/types.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import { findEvent } from '../../semantics/domain-index.js';
import type { UxInput, UxIssue } from '../../model/ux/types.js';
import type { UxVerifier } from '../verifier.js';
import { acceptHint, uxIssue } from '../verifier.js';

/** ある画面が操作に当てている語 1 つとその出どころ。 */
interface Wording {
  readonly word: string;
  /** 出どころの説明(指摘文に出す)。 */
  readonly source: string;
  readonly screen: ScreenSpec;
  /** 画面が自分で書いた `label` か(false ならイベントの `label` を引いた既定の語)。 */
  readonly authored: boolean;
  readonly location: SourceLocation;
}

/** U2: 同じ操作に画面ごとに違う語が当たっていないかを検査する。 */
export const wordingVerifier: UxVerifier = {
  id: 'U2',
  title: '操作の語 — 同じ操作の語は画面をまたいで同じ',

  verify(input: UxInput): UxIssue[] {
    const byOperation = new Map<string, Wording[]>();
    for (const screen of input.screens.screens) {
      for (const [id, wording] of screenWords(screen, input.domain)) {
        const list = byOperation.get(id);
        if (list === undefined) byOperation.set(id, [wording]);
        else list.push(wording);
      }
    }
    return [...byOperation].flatMap(([id, words]) => (new Set(words.map((w) => w.word)).size < 2 ? [] : [inconsistent(id, words)]));
  },
};

/**
 * 1 画面が、宣言した操作それぞれに当てている語(操作 ID → 語)。
 *
 * 画面の `label`(重ね表示 → フォーム部品の順)を先に取り、無い操作だけイベントの `label` を既定とする。
 */
function screenWords(screen: ScreenSpec, domain: SpecModel): ReadonlyMap<string, Wording> {
  const canonical = (id: string): string => canonicalActionId(domain, id) ?? id;
  const words = new Map<string, Wording>();
  for (const overlay of screen.overlays) {
    if (overlay.label === undefined) continue;
    for (const action of overlay.actions) {
      const id = canonical(action.id);
      if (words.has(id)) continue;
      words.set(id, {
        word: overlay.label,
        source: `画面 ${screen.name} の重ね表示 ${overlay.id} の label`,
        screen,
        authored: true,
        location: overlay.location,
      });
    }
  }
  for (const component of screen.layout.slots.flatMap((slot) => slot.components)) {
    const action = component.actionRefs?.[0];
    if (component.kind !== 'form' || component.label === undefined || action === undefined) continue;
    const id = canonical(action.id);
    if (words.has(id)) continue;
    words.set(id, {
      word: component.label,
      source: `画面 ${screen.name} のフォーム ${component.name} の label`,
      screen,
      authored: true,
      location: component.location,
    });
  }
  return withDefaults(screen, domain, words, canonical);
}

/** 画面が label を書いていない操作に、状態機械のイベントの label(既定の語)を当てる。 */
function withDefaults(
  screen: ScreenSpec,
  domain: SpecModel,
  words: Map<string, Wording>,
  canonical: (id: string) => string,
): ReadonlyMap<string, Wording> {
  const declared = [...screen.actions, ...screen.overlays.flatMap((overlay) => overlay.actions)];
  for (const ref of declared) {
    const id = canonical(ref.id);
    if (words.has(id)) continue;
    const entry = findEvent(domain, id);
    const label = entry?.event.label;
    if (entry === null || label === undefined) continue;
    words.set(id, {
      word: label,
      source: `画面 ${screen.name} が引く state_spec の ${entry.machine.machine} の events の label`,
      screen,
      authored: false,
      location: ref.location,
    });
  }
  return words;
}

/** 語が食い違っている操作。受け入れられる画面は、自分で語を書いた画面(既定の語を引くだけの画面は受け入れの主ではない)。 */
function inconsistent(id: string, words: readonly Wording[]): UxIssue {
  const authored = words.filter((wording) => wording.authored);
  const screens = [...new Set((authored.length === 0 ? words : authored).map((wording) => wording.screen.id))];
  const first = authored[0] ?? words[0];
  const distinct = [...new Set(words.map((wording) => wording.word))];
  return uxIssue('U2', screens, id, {
    message: `操作 ${id} の語が画面ごとに違います(${distinct.map((word) => `「${word}」`).join(' / ')})`,
    location: first?.location ?? { file: '' },
    suggestion:
      `語を 1 つに決めて揃える(状態機械のイベントの label か、各画面の重ね表示・フォームの label。どちらの語が正しいかは業務の判断)。` +
      `意図して語を分けるなら${acceptHint('U2', id)}(語を書いた画面のどれかに書く)`,
    counterexample: {
      operation: id,
      words: words.map((wording) => `${wording.word}(${wording.source})`).join(' / '),
    },
  });
}
