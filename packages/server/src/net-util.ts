import net from 'node:net';

/** Probe whether a port is free by briefly binding a throwaway server. */
export function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

/** Find the first free port at or after `start`. */
export async function findFreePort(start: number, span = 100): Promise<number> {
  let port = start;
  for (let i = 0; i < span; i++, port++) {
    if (await probePort(port)) return port;
  }
  return start;
}
