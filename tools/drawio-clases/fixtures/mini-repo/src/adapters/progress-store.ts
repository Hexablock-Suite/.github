import type { Progress } from '../domain/progress/progress';
import type { ProgressKey } from '../domain/progress/progress-key';
import { receiveKeyOf } from './received';

// A function of this file. It calls a helper of another file.
function readRow(key: ProgressKey): string {
  return `row ${receiveKeyOf(key)}`;
}

export class ProgressStore {
  find(key: ProgressKey): string {
    return readRow(key);
  }

  lock(key: ProgressKey): string {
    return `lock ${receiveKeyOf(key)}`;
  }

  // The member gives its own receiver object.
  scoreOf(progress: Progress): number {
    let kept = 0;
    progress.deliverTo({
      receive(_key, score) {
        kept = score;
      },
    });
    return kept;
  }
}
