/**
 * @fileoverview Pins the runtime guard that keeps a unit spec from opening a socket: the setup
 * file refuses a server, a connection and a datagram socket, and the resolver refuses `supertest`.
 * @layer repository
 */
import dgram from 'node:dgram'
import net from 'node:net'
import { join } from 'node:path'

const fixture = join(__dirname, '..', 'scripts', 'jest-no-sockets.fixture.cjs')
const startRequest = require(fixture) as (name: string) => { end(done: () => void): void }

describe('socket gate', () => {
  it('refuses to start a server', () => {
    // Scenario: a unit spec asks a server to listen by a name built at run time, which no lint
    // selector can see; the setup replaces `listen`, so the call throws before any port is bound.
    const method: 'listen' = ['lis', 'ten'].join('') as 'listen'
    expect(() => new net.Server()[method](0)).toThrow('A unit spec opens no socket')
  })

  it('refuses to open a connection', () => {
    // Scenario: a unit spec connects a socket; the setup replaces `connect`, so the call throws
    // before any address is resolved.
    expect(() => new net.Socket().connect(1, '127.0.0.1')).toThrow('A unit spec opens no socket')
  })

  it('refuses to open a datagram socket', () => {
    // Scenario: a unit spec asks for a datagram socket by its factory; the factory is replaced.
    expect(() => dgram.createSocket('udp4')).toThrow('A unit spec opens no socket')
  })

  it('refuses supertest when a spec loads it by a name built at run time', () => {
    // Scenario: the lint rule cannot see a name passed in as data; the resolver refuses the
    // package for any module under `src/`, so loading it throws the reason and not a missing module.
    expect(() => require(['super', 'test'].join(''))).toThrow('cannot load supertest')
  })

  it('refuses a request that a helper outside src starts through supertest', () => {
    // Scenario: a helper outside `src/` loads supertest by a name it is given. The resolver lets
    // that load through, and sending the request it builds ends in `listen`, which the setup refuses.
    expect(() => startRequest('supertest').end(() => undefined)).toThrow(
      'A unit spec opens no socket'
    )
  })
})
