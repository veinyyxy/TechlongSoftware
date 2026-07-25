const workersMockUrl = new URL("./cloudflare-workers.mock.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      shortCircuit: true,
      url: workersMockUrl,
    };
  }

  return nextResolve(specifier, context);
}
