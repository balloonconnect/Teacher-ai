/** A tiny in-process background queue (OCR runs here so uploads return at once). One worker per server process by default. */
export class JobQueue {
  private q: (() => Promise<void>)[] = []; private active = 0; private waiters: (() => void)[] = [];
  constructor(private concurrency = 1, private onError: (e: unknown) => void = e => console.error('[job]', e)) {}
  add(fn: () => Promise<void>) { this.q.push(fn); queueMicrotask(() => this.pump()); }
  private pump() {
    while (this.active < this.concurrency && this.q.length) {
      const fn = this.q.shift()!; this.active++;
      fn().catch(this.onError).finally(() => { this.active--; this.pump(); if (!this.active && !this.q.length) this.waiters.splice(0).forEach(w => w()); });
    }
  }
  /** Resolves when nothing is queued or running (used by tests and graceful shutdown). */
  idle() { return !this.active && !this.q.length ? Promise.resolve() : new Promise<void>(r => this.waiters.push(r)); }
  get pending() { return this.q.length + this.active; }
}
