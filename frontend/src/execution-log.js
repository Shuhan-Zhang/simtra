// Decode real server events; EOF without an explicit result is never success.
export async function readExecutionStream(response, onLog = () => {}) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The backend did not return an execution stream.");
  const decoder = new TextDecoder();
  let buffer = "", result, terminal = false;
  function accept(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (terminal) throw new Error("Unexpected data after the experiment finished.");
    if (event.type === "log") onLog(event.event);
    else if (event.type === "error") {
      const error = new Error(event.error || "Experiment failed.");
      error.trace = event.trace;
      throw error;
    } else if (event.type === "result") { result = event.data; terminal = true; }
    else throw new Error("Unknown experiment stream event.");
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) accept(line);
      if (done) { accept(buffer); break; }
    }
    if (!terminal) throw new Error("The execution connection ended before results were complete. No result was saved.");
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function executionCounts(events = []) {
  const count = kind => events.filter(e => e.kind === kind).length;
  return { requests: count("model.request"), cacheHits: count("model.cache_hit"), retries: count("model.retry") };
}
