export default async function globalTeardown() {
  const dev = (globalThis as unknown as { __dev?: { stop: () => Promise<void> } }).__dev;
  await dev?.stop();
}
