/**
 * 画面カードの「実物」— **SSR プレビュー**の組み立て(純粋関数)。
 *
 * 実装(`app/src/app/_screens/`)を偽データで描画した HTML 断片
 * (`docs/book/assets/previews/{画面名}.html`)を、章に埋め込める形に整える。
 * 中の見た目は実装 CSS の写し(`docs/book/assets/ui.css` の `.screen-preview` スコープ)が
 * 決めるので、ここがやるのは**器と安全化**だけである:
 *
 *   1. サニタイズ — `<script>` / `<style>` / `on*` 属性を落とす(描画結果には現れないが、
 *      「文書に生 HTML を差し込む」経路に無防備な口を残さない)
 *   2. 重ね表示の切り出し — 閉じた `<dialog>` は章に何も見せないので、本体から**外して**
 *      `open` を付け、別の枠で見せる(id の重複も同時に避けられる)
 *   3. 器 — `inert` を付けた枠に入れる(章の中のリンクやボタンが押せてしまうのを防ぐ)
 *
 * 撮影(スクリーンショット)の後継である。画がバイナリでなくなったことで、鮮度は
 * ハンドブック生成の鮮度検査(generate:check)と app 側の断片テストに吸収された。
 */

/** 断片から切り出した重ね表示 1 つ。 */
export interface PreviewOverlay {
  /** 重ね表示の id(`screen_spec` の `overlays[].id`)。 */
  readonly id: string;
  /** `open` を付けた `<dialog>` のマークアップ。 */
  readonly html: string;
}

/** 断片を「本体」と「重ね表示」に割った結果。 */
export interface PreviewParts {
  /** 重ね表示を外した本体のマークアップ。 */
  readonly base: string;
  /** 切り出した重ね表示(出現順)。 */
  readonly overlays: readonly PreviewOverlay[];
}

/** プレビューが無いときの表記(撮影時代の「未撮影」に当たる)。 */
export const PREVIEW_MISSING =
  'プレビュー未生成 — `cd app && npm run book:previews` で断片を書き出し、ルートで `npm run generate` を回して章に反映する。';

/** 重ね表示が 1 つも無い画面の表記。 */
export const NO_OVERLAY = 'この画面に重ね表示は無い。';

/**
 * 断片を本体と重ね表示(開いた姿の `<dialog>`)に分ける(登録簿に触らない純粋関数。本の HTML は出力の口で別に許可表に通す)。
 *
 * @param html 断片
 * @returns 本体と重ね表示(どちらも登録前の文字列)
 */
export function splitDialogs(html: string): PreviewParts {
  const overlays: PreviewOverlay[] = [];
  let base = '';
  let rest = html;
  for (;;) {
    const start = rest.indexOf('<dialog');
    if (start === -1) break;
    const end = closingIndex(rest, start);
    if (end === null) break;
    const dialog = rest.slice(start, end);
    const id = overlayIdOf(dialog);
    if (id !== null) overlays.push({ id, html: openedDialog(dialog) });
    base += rest.slice(0, start);
    rest = rest.slice(end);
  }
  return { base: base + rest, overlays };
}

/**
 * `<dialog>` の閉じタグの直後の位置を返す。
 *
 * @param html 探す対象
 * @param start `<dialog` の位置
 * @returns `</dialog>` の直後。閉じていなければ null
 */
function closingIndex(html: string, start: number): number | null {
  const pattern = /<dialog\b|<\/dialog\s*>/gi;
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return null;
}

/**
 * `<dialog>` の testid から重ね表示の id を読む。
 *
 * @param dialog `<dialog>` のマークアップ
 * @returns 重ね表示の id。testid が規則に合わなければ null
 */
function overlayIdOf(dialog: string): string | null {
  const match = /data-testid="[^"]*\.overlay\.([a-z0-9_]+)\./.exec(dialog);
  return match?.[1] ?? null;
}

/**
 * `<dialog>` に `open` を付ける(章では開いた姿を見せる)。
 *
 * @param dialog `<dialog>` のマークアップ
 * @returns `open` 付きのマークアップ
 */
function openedDialog(dialog: string): string {
  if (/^<dialog\b[^>]*\sopen(?=[\s>])/i.test(dialog)) return dialog;
  return dialog.replace(/^<dialog\b/i, '<dialog open');
}

