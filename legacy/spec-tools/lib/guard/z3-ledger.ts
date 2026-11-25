/**
 * Z3 の親(`z3-host.ts`)が手放した worker の `terminate()` を追跡する帳簿と、その結果から立つ fail-closed の障壁。
 *
 * 手放した worker は `track` に渡す。`terminate()` の確認(定義は `z3-timing.ts` の `terminateWithin`)が出るまで `closing` に載り、
 * 確認できなかった worker は理由つきで `unconfirmed` に残る。**`unconfirmed` が空でないあいだが障壁**: 親は新しい worker を作らない。
 * 外れるのは、同じ worker を `track` し直して確認できたときだけ(時間の経過・理由の文面を読んだことでは外れない)。
 */

import { terminateWithin } from './z3-timing.js';

/** 止める対象(`terminate()` だけ要る)。 */
export interface Terminable {
  terminate(): Promise<number>;
}

export class TerminateLedger {
  /** `terminate()` の確認待ち(確認の結果が出ると自分で外れる)。 */
  private readonly closing = new Set<Promise<void>>();
  /** 終了を確認できていない worker(→ 直近の理由の文面)。 */
  private readonly unconfirmed = new Map<Terminable, string>();

  constructor(
    private readonly terminateDeadlineMs: number,
    private readonly log: (line: string) => void,
  ) {}

  /** 終了を確認できていない worker が 1 本でもあるか(障壁が立っているか)。 */
  get blocked(): boolean {
    return this.unconfirmed.size > 0;
  }

  /** 確認待ちの `terminate()` があるか。 */
  get settling(): boolean {
    return this.closing.size > 0;
  }

  /** 確認できていない worker(再確認の対象)。 */
  pending(): Terminable[] {
    return [...this.unconfirmed.keys()];
  }

  /** 確認できていない理由の文面。 */
  reasons(): string[] {
    return [...this.unconfirmed.values()];
  }

  /**
   * 確認待ちの `terminate()` が**空になるまで**待つ(結果は `blocked` で見る)。呼んだ時点の分だけを待つと、待つ間に別の呼び手が足した
   * 確認(同じ worker の再確認)が後から失敗したとき、先に resolve した側だけが障壁の消えた状態を見てしまう(並行する `shutdown()` の結果が割れる)。
   * 各周で新しく足された分も待つので、どの呼び手も確認待ちが空になった後の `blocked` を見る。
   */
  async settled(): Promise<void> {
    while (this.closing.size > 0) await Promise.all([...this.closing]);
  }

  /**
   * `terminate()` を追跡する。確認できれば障壁から外し、できなければ(失敗・上限超過)理由つきで残す。
   * 同じ worker を並行して 2 回追跡したとき、障壁を決めるのは**最後に完了した確認**である(完了順):
   *   - 成功が先・失敗が後: 先の成功で障壁は外れ、後から来た失敗が理由つきで立て直す(fail-closed の側)
   *   - 失敗が先・成功が後: 先の失敗で障壁は立ち、後から来た成功が(同じ worker の終了を確認できたので)外す
   */
  track(worker: Terminable): void {
    const done: Promise<void> = terminateWithin(worker, this.terminateDeadlineMs).then((error) => {
      this.closing.delete(done);
      if (error === null) {
        this.unconfirmed.delete(worker);
        return;
      }
      this.unconfirmed.set(worker, error);
      try {
        this.log(`z3: worker の終了を確認できなかった(${error})。新しい worker は shutdown が確認するまで作らない`);
      } catch {
        // 行を出せなくても、確認の結果(障壁)は残す。`done` を reject させない(`settled()` を落とさない)。
      }
    });
    this.closing.add(done);
  }
}
