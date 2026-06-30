import { spawn } from 'node:child_process';
import path from 'node:path';
import { createServer } from '@openrepl/server';

/** Open a URL in the default browser, cross-platform, best-effort. */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    /* headless / no browser — the URL is printed anyway */
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open') || process.env.OPENREPL_NO_BROWSER === '1';
  const dirArg = args.find((a) => !a.startsWith('--'));
  const initialProject = dirArg ? path.resolve(dirArg) : undefined;
  const portArg = args.find((a) => a.startsWith('--port='));
  const projectsArg = args.find((a) => a.startsWith('--projects-dir='));
  const port = portArg ? Number(portArg.split('=')[1]) : undefined;
  const projectsRoot = projectsArg ? projectsArg.split('=')[1] : undefined;

  const server = await createServer({ initialProject, projectsRoot, port });

  const where = initialProject ? `\n  Project: ${initialProject}` : '\n  Pick or create a project in the browser.';
  // eslint-disable-next-line no-console
  console.log(`\n  OpenREPL running${where}\n  → ${server.url}\n`);
  if (!noOpen) openBrowser(server.url);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start OpenREPL:', e);
  process.exit(1);
});
