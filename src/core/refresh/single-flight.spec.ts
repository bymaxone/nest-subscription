/**
 * @fileoverview Pins the single-flight helper: one run per key at a time, shared by every caller
 * that arrives meanwhile, and no entry left behind once a run settles. Promises the test resolves
 * by hand drive every ordering.
 * @layer core
 */
import { SingleFlight } from './single-flight'

/** A promise and the two functions that settle it. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('SingleFlight', () => {
  it('starts one run for a hundred concurrent callers of one key and gives them one result', async () => {
    // Scenario: a hundred callers arrive while the first run is held; only one run starts.
    const flights = new SingleFlight<number>()
    const gate = deferred<number>()
    const start = jest.fn(() => gate.promise)
    const callers = Array.from({ length: 100 }, () => flights.run('k', start))
    gate.resolve(7)
    expect(await Promise.all(callers)).toEqual(Array.from({ length: 100 }, () => 7))
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not make a run of one key wait for a run of another', async () => {
    // Scenario: the run of key a is held; the run of key b completes meanwhile.
    const flights = new SingleFlight<string>()
    const held = deferred<string>()
    const first = flights.run('a', () => held.promise)
    await expect(flights.run('b', () => Promise.resolve('b done'))).resolves.toBe('b done')
    held.resolve('a done')
    await expect(first).resolves.toBe('a done')
  })

  it('shares one rejection with every waiting caller', async () => {
    // Scenario: the run fails while three callers wait.
    const flights = new SingleFlight<number>()
    const gate = deferred<number>()
    const failure = new Error('boom')
    const callers = [1, 2, 3].map(() => flights.run('k', () => gate.promise))
    gate.reject(failure)
    for (const caller of callers) await expect(caller).rejects.toBe(failure)
  })

  it('holds an entry only while its run is in flight and none after success', async () => {
    // Scenario: the entry is counted before, during and after a successful run.
    const flights = new SingleFlight<number>()
    const gate = deferred<number>()
    expect(flights.size).toBe(0)
    const run = flights.run('k', () => gate.promise)
    expect(flights.size).toBe(1)
    gate.resolve(1)
    await run
    expect(flights.size).toBe(0)
  })

  it('holds no entry after a failed run and starts a new run on the next call', async () => {
    // Scenario: a run rejects; the next call for the key starts again instead of reusing it.
    const flights = new SingleFlight<number>()
    await expect(flights.run('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(flights.size).toBe(0)
    const start = jest.fn(() => Promise.resolve(2))
    await expect(flights.run('k', start)).resolves.toBe(2)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('turns a start function that throws synchronously into a rejection and keeps no entry', async () => {
    // Scenario: the start function throws before returning a promise.
    const flights = new SingleFlight<number>()
    const run = flights.run('k', () => {
      throw new Error('sync')
    })
    await expect(run).rejects.toThrow('sync')
    expect(flights.size).toBe(0)
  })

  it('starts a new run for a key once the earlier run has settled', async () => {
    // Scenario: two runs one after the other, each calls its own start function.
    const flights = new SingleFlight<number>()
    const start = jest.fn(() => Promise.resolve(1))
    await flights.run('k', start)
    await flights.run('k', start)
    expect(start).toHaveBeenCalledTimes(2)
  })
})
