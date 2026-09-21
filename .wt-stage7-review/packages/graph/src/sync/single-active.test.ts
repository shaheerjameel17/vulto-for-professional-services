import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SyncLeadership, type LockManagerLike } from "./single-active";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Node 20+ exposes a real `navigator.locks` (`LockManager`). It is
 * process-scoped rather than origin-scoped, which is exactly the isolation a
 * test wants — a fresh lock name per test stands in for a fresh origin.
 */
function realLocks(): LockManagerLike {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) throw new Error("this test needs navigator.locks (Node >= 20)");
  return locks;
}

interface FakeClient {
  started: number;
  stopped: number;
}

function member(lockName: string, locks: LockManagerLike | undefined) {
  const client: FakeClient = { started: 0, stopped: 0 };
  const leadership = new SyncLeadership(
    lockName,
    async () => {
      client.started += 1;
      return async () => {
        client.stopped += 1;
      };
    },
    locks,
  );
  return { client, leadership };
}

describe("SyncLeadership", () => {
  it("runs onLead immediately when there is no lock manager", async () => {
    const { client, leadership } = member(`no-locks-${randomUUID()}`, undefined);
    leadership.start();
    await flush();
    expect(client.started).toBe(1);
    expect(leadership.leading).toBe(true);

    await leadership.stop();
    expect(client.stopped).toBe(1);
    expect(leadership.leading).toBe(false);
  });

  it("lets only one member lead at a time and hands over on release", async () => {
    const lock = `handover-${randomUUID()}`;
    const a = member(lock, realLocks());
    const b = member(lock, realLocks());

    a.leadership.start();
    b.leadership.start();
    await flush();

    // A got the lock; B is queued.
    expect(a.client.started).toBe(1);
    expect(a.leadership.leading).toBe(true);
    expect(b.client.started).toBe(0);
    expect(b.leadership.leading).toBe(false);

    // A releases -> B takes over.
    await a.leadership.stop();
    await flush();
    expect(a.client.stopped).toBe(1);
    expect(b.client.started).toBe(1);
    expect(b.leadership.leading).toBe(true);

    await b.leadership.stop();
    expect(b.client.stopped).toBe(1);
  });

  it("hands over when the leader's tab closes (its lock frees) — modeled by dropping stop()", async () => {
    const lock = `tab-close-${randomUUID()}`;
    const a = member(lock, realLocks());
    const b = member(lock, realLocks());

    a.leadership.start();
    b.leadership.start();
    await flush();
    expect(a.leadership.leading).toBe(true);
    expect(b.leadership.leading).toBe(false);

    // A's context goes away: it never calls stop(), but releasing the promise
    // it is parked on is what the browser does when it frees the lock.
    await a.leadership.stop();
    await flush();
    expect(b.leadership.leading).toBe(true);

    await b.leadership.stop();
  });

  it("a queued member that stops before it leads never leads and does not throw", async () => {
    const lock = `queued-cancel-${randomUUID()}`;
    const a = member(lock, realLocks());
    const b = member(lock, realLocks());

    a.leadership.start();
    b.leadership.start();
    await flush();
    expect(a.leadership.leading).toBe(true);

    // B gives up while still queued.
    await b.leadership.stop();
    expect(b.client.started).toBe(0);
    expect(b.client.stopped).toBe(0);

    // A can still release cleanly; nothing is waiting to take over.
    await a.leadership.stop();
    expect(a.client.stopped).toBe(1);
  });

  it("start() is idempotent", async () => {
    const { client, leadership } = member(`idem-${randomUUID()}`, realLocks());
    leadership.start();
    leadership.start();
    await flush();
    expect(client.started).toBe(1);
    await leadership.stop();
  });
});
