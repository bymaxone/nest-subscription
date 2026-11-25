/**
 * @fileoverview Entry point of the `testing` directory: the in-memory store, the conformance cases, the fake source and the request builders for tests.
 * @layer testing
 */
export { assertNoSentinel, createCapture } from './capture'
export type { Capture, CapturedPayload } from './capture'
export { createFailingStore } from './failing.store'
export type { FailingStore, FailingStoreMethod } from './failing.store'
export { FakeSubscriptionSource } from './fake.source'
export type { FakeSourceOptions } from './fake.source'
export { InMemorySubscriptionStore } from './in-memory.store'
export type { InMemoryStoreOptions } from './in-memory.store'
export { ManualClock } from './manual.clock'
export { storeConformanceCases } from './store-conformance'
export type { StoreConformanceCase, StoreFactory } from './store-conformance'
