import type { ProgressKey } from './progress-key';

// A receiver gets the parts that a Progress delivers.
export interface ProgressReceiver {
  receive(key: ProgressKey, score: number): void;
}

export class Progress {
  constructor(
    private readonly key: ProgressKey,
    private readonly score: number,
  ) {}

  deliverTo(receiver: ProgressReceiver): void {
    receiver.receive(this.key, this.score);
  }
}
