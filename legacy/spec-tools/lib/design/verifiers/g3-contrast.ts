/**
 * G3 — 宣言した前景 / 背景の組み合わせが WCAG のコントラスト比を満たすこと。
 *
 * **トークン化して初めて成立する検査**である。色が実装に散っていた頃は、どの色が
 * どの色の上に載るかを機械が知る手段が無かった。`contrast` の宣言は「重ねると決めた
 * 組み合わせ」の一覧であり、これがあるので比を計算で確かめられる(U6 と地続き)。
 *
 * 見ているのは**宣言した組み合わせだけ**である。総当たりにしないのは、実際には重ねない
 * 色の比まで守ることになり、パレットが痩せるため(この限界は styling.md にも書いてある)。
 *
 * それでも「行を消せば黙る」の穴は残る ―― `contrast` に 1 行も現れない色トークンは、
 * 比を検査されないまま緑になる。**網羅の床**として、色トークン(palette を ref で
 * 参照するトークン)のうち `contrast` に一度も現れないものを warning で挙げる。
 *
 * この warning は「理由つきで受け入れる」既存の作法(U 群の `ux:` と同じ形)で
 * 消す ―― トークンに `decorative: <理由 1 行>` を書くと、そのトークンは網羅の床の対象外
 * になる(warning が消える)。これは**検査を消す操作ではなく受け入れの記録**であるため、
 * `decorative` を持つのに実際には `contrast` にも現れる(= 重ねると言いながら重ねている)
 * トークンは**矛盾として error**にする(coverage の warning より重い)。
 */

import type { Finding } from '../../kernel/finding.js';
import { contrastRatio } from '../../model/design/color.js';
import type { DesignInput, DesignToken, DesignTokenSpec } from '../../model/design/types.js';
import { designFinding, type DesignVerifier } from '../verifier.js';

/** 検証器 ID。 */
const ID = 'G3';

/** G3 検証器。 */
export const g3Contrast: DesignVerifier = {
  id: ID,
  title: '宣言した色の組み合わせが WCAG AA のコントラスト比を満たす(+ 色トークンの contrast 網羅)',

  verify(input: DesignInput): Finding[] {
    const spec = input.tokens.spec;
    if (spec === null) return [];
    return [...ratioFindings(spec), ...decorativeContradictionFindings(spec), ...coverageFindings(spec)];
  },
};

/** 宣言した組み合わせのうち、比が足りないものを挙げる。 */
function ratioFindings(spec: DesignTokenSpec): Finding[] {
  const byName = new Map<string, DesignToken>(spec.tokens.map((token) => [token.name, token]));
  const findings: Finding[] = [];
  for (const pair of spec.contrast) {
    const fg = byName.get(pair.fg);
    const bg = byName.get(pair.bg);
    if (fg === undefined || bg === undefined) continue;
    const ratio = contrastRatio(fg.value, bg.value);
    if (ratio === null || ratio >= pair.min) continue;
    findings.push(
      designFinding(ID, {
        message: `コントラスト比が足りません: ${pair.fg} / ${pair.bg} は ${ratio.toFixed(2)}:1(必要 ${pair.min}:1)`,
        file: spec.file,
        pointer: `contrast.${pair.fg}-on-${pair.bg}`,
        suggestion:
          `palette の ${fg.ref ?? fg.name} を暗く(または ${bg.ref ?? bg.name} を明るく)する。` +
          'この組み合わせを実際には重ねないと判断して行を消す場合は、なぜ重ならないかを YAML のコメントで残す(消せば黙る検査なので、理由の無い削除は緑を買っただけになる)',
        counterexample: {
          fg: `${pair.fg} = ${fg.value}`,
          bg: `${pair.bg} = ${bg.value}`,
          ratio: `${ratio.toFixed(2)}:1`,
          required: `${pair.min}:1`,
        },
      }),
    );
  }
  return findings;
}

/** 実際に重ねる色を集める({@link referencedNames} との重複計算を避けるための共通処理)。 */
function referencedNames(spec: DesignTokenSpec): ReadonlySet<string> {
  const referenced = new Set<string>();
  for (const pair of spec.contrast) {
    referenced.add(pair.fg);
    referenced.add(pair.bg);
  }
  return referenced;
}

/**
 * `decorative`(重ねない理由)を持つのに `contrast` にも現れるトークンを矛盾として挙げる。
 *
 * 「実際には重ねない」という受け入れの記録と、`contrast` の「重ねると決めた」宣言は
 * 両立しない ―― 重ねないと言った色を実際には重ねているなら、`decorative` を消して
 * G3 の比の検査(ratioFindings)に委ねるべきである。
 */
function decorativeContradictionFindings(spec: DesignTokenSpec): Finding[] {
  const referenced = referencedNames(spec);
  const findings: Finding[] = [];
  for (const token of spec.tokens) {
    if (token.decorative === null) continue;
    if (!referenced.has(token.name)) continue;
    findings.push(
      designFinding(ID, {
        message: `色トークン ${token.name} は decorative(重ねない理由)を持つのに contrast にも現れています(矛盾)`,
        file: spec.file,
        pointer: `groups.color.${token.name}`,
        suggestion:
          '実際に重ねているなら decorative を消して比の検査に委ねる。重ねていないなら contrast の該当行を消す(どちらか一方に揃える)',
        counterexample: { token: token.name, decorative: token.decorative },
      }),
    );
  }
  return findings;
}

/**
 * `contrast` に一度も現れない色トークン(palette 参照つき)を挙げる(網羅の床。severity: warning)。
 *
 * `decorative` を持つトークンは「理由つきで受け入れ済み」として数えず、この警告から除く。
 */
function coverageFindings(spec: DesignTokenSpec): Finding[] {
  const referenced = referencedNames(spec);
  const findings: Finding[] = [];
  for (const token of spec.tokens) {
    if (token.ref === null) continue; // 色トークン = palette を参照するトークン(readContrast と同じ定義)
    if (token.decorative !== null) continue; // 理由つきで受け入れ済み
    if (referenced.has(token.name)) continue;
    findings.push(
      designFinding(
        ID,
        {
          message: `色トークン ${token.name} が contrast に一度も現れません(比を検査されないまま緑になっています)`,
          file: spec.file,
          pointer: `groups.color.${token.name}`,
          suggestion:
            '実際に文字や UI 部品の境界としてこの色を重ねている背景/前景があるなら contrast に 1 行足す。' +
            '装飾的で実際には重ねない色(区切り線など)なら、tokens.md のこのトークンに `decorative: <理由>` を書いて受け入れる',
          counterexample: { token: token.name, value: token.value },
        },
        'warning',
      ),
    );
  }
  return findings;
}
