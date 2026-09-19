// Explicit browser origin for Node tests of the local frontend client.
globalThis.location ??= new URL("http://localhost:5173");
