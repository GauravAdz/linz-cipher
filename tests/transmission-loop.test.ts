import { describe, expect, it } from 'vitest';
import { loopTransmission } from '../src/audio/transmission-loop';

describe('loopTransmission', () => {
  it('repeats complete transmissions until cancelled', async () => {
    const controller = new AbortController();
    const repetitions: number[] = [];

    await loopTransmission(async repetition => {
      repetitions.push(repetition);
      if (repetition === 3) controller.abort();
    }, controller.signal);

    expect(repetitions).toEqual([1, 2, 3]);
  });

  it('does not start when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const playOnce = () => {
      called = true;
      return Promise.resolve();
    };

    await loopTransmission(playOnce, controller.signal);

    expect(called).toBe(false);
  });
});
