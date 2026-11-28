import type { Progress } from '../domain/progress/progress';
import { receiveProgressOf } from './received';

// A const object: its member calls a helper of another file.
export const ProgressRowMapper = {
  toRow(progress: Progress): { userId: string; score: number } {
    const { userId, score } = receiveProgressOf(progress);
    return { userId, score };
  },
};
