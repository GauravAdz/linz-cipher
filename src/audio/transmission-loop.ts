export async function loopTransmission(
  playOnce: (repetition: number) => Promise<void>,
  signal: AbortSignal,
) {
  let repetition = 0;
  while (!signal.aborted) {
    repetition += 1;
    await playOnce(repetition);
  }
}
