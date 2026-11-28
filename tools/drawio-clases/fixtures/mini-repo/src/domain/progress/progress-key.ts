// A receiver gets the one value that a ProgressKey delivers.
export interface KeyReceiver {
  receive(userId: string): void;
}

export class ProgressKey {
  constructor(private readonly userId: string) {}

  deliverTo(receiver: KeyReceiver): void {
    receiver.receive(this.userId);
  }
}
