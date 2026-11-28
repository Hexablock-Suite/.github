import type { Progress } from '../domain/progress/progress';
import type { ProgressKey } from '../domain/progress/progress-key';
import { Stamp } from '../domain/progress/stamp';

// The helpers of the border, as in hexablock-api. Each helper gives a receiver object to a domain object.
// A caller in another file uses the receiver interface of each receiver object.
// It does not use ProgressKey, Progress or Stamp through the helper.
export function receiveKeyOf(source: ProgressKey): string {
  let kept = '';
  source.deliverTo({
    receive(userId) {
      kept = userId;
    },
  });
  return kept;
}

// The helper calls receiveKeyOf() of its own file, so a caller also uses KeyReceiver.
export function receiveProgressOf(source: Progress): { userId: string; score: number; at: number } {
  let kept = { userId: '', score: 0, at: 0 };
  source.deliverTo({
    receive(key, score) {
      kept = { userId: receiveKeyOf(key), score, at: Stamp.now() };
    },
  });
  return kept;
}
