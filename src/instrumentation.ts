export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorkers } = await import("./server/worker");
    await startWorkers();
  }
}
