/** Runs once when the server starts. A bad production configuration stops the boot here. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateConfig } = await import("./server/config");
    validateConfig();
  }
}
