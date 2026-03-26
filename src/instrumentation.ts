import pkg from "../package.json" with { type: "json" };

const version: string = pkg.version;

export async function register() {
  if (process.env.NODE_ENV !== "development") return;

  checkForUpdates().catch(() => {
    // Silently ignore — never block or break the dev server
  });
}

async function checkForUpdates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      "https://registry.npmjs.org/opencauldron/latest",
      { signal: controller.signal },
    );
    if (!res.ok) return;

    const data = (await res.json()) as { version: string };
    const latest = data.version;

    if (latest && latest !== version && isNewer(latest, version)) {
      const msg = [
        "",
        `  \x1b[36m╭───────────────────────────────────────────╮\x1b[0m`,
        `  \x1b[36m│\x1b[0m                                           \x1b[36m│\x1b[0m`,
        `  \x1b[36m│\x1b[0m   Update available: \x1b[90m${version}\x1b[0m → \x1b[32m${latest}\x1b[0m${" ".repeat(Math.max(0, 14 - version.length - latest.length))}\x1b[36m│\x1b[0m`,
        `  \x1b[36m│\x1b[0m   Run \x1b[1mnpx create-opencauldron@latest\x1b[0m     \x1b[36m│\x1b[0m`,
        `  \x1b[36m│\x1b[0m                                           \x1b[36m│\x1b[0m`,
        `  \x1b[36m╰───────────────────────────────────────────╯\x1b[0m`,
        "",
      ].join("\n");
      console.log(msg);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}
