// Retry only an explicit missing-runtime error, never failed/ambiguous inference.
export async function withSimulationRecovery({run, restore, signal}) {
  const check = () => { if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError'); };
  check();
  try { return await run(); }
  catch (error) {
    if (error.status !== 404 || !/^(simulation|branch) not found$/i.test(error.serverMessage || '')) throw error;
    check();
    await restore();
    check();
    return run(); // One recovery attempt; repeated failures reach the caller.
  }
}
