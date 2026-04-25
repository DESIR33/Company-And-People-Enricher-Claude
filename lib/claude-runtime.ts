import fs from "node:fs";
import path from "node:path";

// The Claude Agent SDK auto-detects which native binary to spawn by trying
// its optional dependency packages in a fixed order. On Linux it tries the
// musl variant before the glibc one and uses the first that resolves. Most
// installs only end up with the variant matching the host's libc, but in
// environments where npm doesn't honour the package's `libc` field (some CI
// runners, sandboxed Docker layers, frozen lockfiles copied across distros)
// BOTH variants land in node_modules. The SDK then picks the musl binary on
// glibc hosts, the spawn fails with "interpreter not found", and the agent
// throws "Claude Code native binary not found at ...".
//
// Resolve the matching variant ourselves and pass it via
// `pathToClaudeCodeExecutable` so the SDK doesn't rely on its own picker.
// Returns undefined when we don't have a better answer than the SDK's default
// (non-Linux, unknown arch, or the matching package isn't installed).
export function resolveClaudeCodeExecutable(): string | undefined {
  const override = process.env.CLAUDE_CODE_EXECUTABLE;
  if (override) return override;

  if (process.platform !== "linux") return undefined;
  if (process.arch !== "x64" && process.arch !== "arm64") return undefined;

  const pkg = isGlibc()
    ? `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`
    : `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`;

  return findInNodeModules(pkg, "claude");
}

function isGlibc(): boolean {
  try {
    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    return Boolean(report?.header?.glibcVersionRuntime);
  } catch {
    return false;
  }
}

// Walk up from cwd looking for node_modules/<pkg>/<file>. Hand-rolled instead
// of require.resolve because Next.js's bundler refuses to statically analyse
// require.resolve() with a dynamic argument and erases the call.
function findInNodeModules(pkg: string, file: string): string | undefined {
  const segments = pkg.split("/");
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, "node_modules", ...segments, file);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
