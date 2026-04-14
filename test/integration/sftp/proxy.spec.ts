import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Client as SSHClient } from 'ssh2';

import { SftpRemotePort } from '../../../src/infrastructure/remote/SftpRemotePort';
import { ConfigValidator } from '../../../src/infrastructure/config/ConfigValidator';
import * as proxyModule from '../../../src/infrastructure/helpers/proxy/createProxySocket';
import { stringToWsId, stringToRel } from '../../../src/infrastructure/helpers/path';
import { VM_CONFIG, setupVMTests, cleanupRemotePath, REMOTE_PATHS } from '../../helpers/vm/config';
import type { WorkspaceId } from '../../../src/domain/types';
import type { ProxyConfig } from '../../../src/infrastructure/helpers/proxy/detectSystemProxy';

// ─── In-process SOCKS5 proxy ─────────────────────────────────────────────────
//
// Starts a minimal SOCKS5 server backed by a single SSH connection to the VM.
// Each incoming SOCKS5 CONNECT opens a direct-tcpip channel on that SSH
// connection — exactly what `ssh -D` does, but without requiring any external
// command or manual setup.
//
// Target addresses are resolved from the VM's side, so LiveSync must be
// configured with hostname=127.0.0.1 port=22 (the VM's own SSH daemon) rather
// than the VirtualBox-forwarded 127.0.0.1:2222.

interface Proxy {
  config: ProxyConfig;
  stop: () => void;
}

async function startSocks5Proxy(): Promise<Proxy> {
  // Reuse the standard host-side port-forwarded SSH to connect to the VM
  const sshClient = new SSHClient();
  await new Promise<void>((resolve, reject) => {
    sshClient
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: VM_CONFIG.hostname,  // 127.0.0.1
        port: VM_CONFIG.port,       // 2222 (VirtualBox forwarded)
        username: VM_CONFIG.username,
        password: VM_CONFIG.password,
        readyTimeout: 8000,
      });
  });

  const server = net.createServer((socket) =>
    handleSocks5Connection(socket, sshClient)
  );

  // Let the OS pick a free port
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    config: { host: '127.0.0.1', port },
    stop: () => {
      server.close();
      sshClient.end();
    },
  };
}

function handleSocks5Connection(socket: net.Socket, sshClient: SSHClient): void {
  let buf = Buffer.alloc(0);
  let state: 'auth' | 'request' | 'connected' = 'auth';

  socket.on('error', () => {});

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    processBuffer();
  });

  function processBuffer(): void {
    // ── Phase 1: auth negotiation ─────────────────────────────────────────
    if (state === 'auth') {
      if (buf.length < 2) { return; }
      const nmethods = buf[1];
      if (buf.length < 2 + nmethods) { return; }
      socket.write(Buffer.from([0x05, 0x00])); // SOCKS5, no-auth
      buf = buf.slice(2 + nmethods);
      state = 'request';
    }

    // ── Phase 2: connection request ───────────────────────────────────────
    if (state === 'request') {
      if (buf.length < 4) { return; }

      const addrType = buf[3];
      let host: string;
      let port: number;
      let consumed: number;

      if (addrType === 0x01) {              // IPv4
        if (buf.length < 10) { return; }
        host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
        port = buf.readUInt16BE(8);
        consumed = 10;
      } else if (addrType === 0x03) {       // hostname
        if (buf.length < 5) { return; }
        const len = buf[4];
        if (buf.length < 5 + len + 2) { return; }
        host = buf.slice(5, 5 + len).toString();
        port = buf.readUInt16BE(5 + len);
        consumed = 5 + len + 2;
      } else if (addrType === 0x04) {       // IPv6
        if (buf.length < 22) { return; }
        const parts: string[] = [];
        for (let i = 0; i < 8; i++) {
          parts.push(buf.readUInt16BE(4 + i * 2).toString(16));
        }
        host = parts.join(':');
        port = buf.readUInt16BE(20);
        consumed = 22;
      } else {
        socket.destroy();
        return;
      }

      state = 'connected';
      const remaining = buf.slice(consumed);

      // Open a direct-tcpip channel on the SSH connection to the VM.
      // The VM resolves host:port from its own network context.
      sshClient.forwardOut('127.0.0.1', 0, host, port, (err, channel) => {
        if (err) {
          // SOCKS5 "Connection refused" reply
          socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.destroy();
          return;
        }

        // SOCKS5 success reply
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));

        if (remaining.length > 0) { channel.write(remaining); }

        socket.pipe(channel);
        channel.pipe(socket);
        socket.on('close', () => channel.close());
        channel.on('close', () => socket.destroy());
      });
    }
  }
}

// ─── VM config seen through the proxy ────────────────────────────────────────
// The proxy forwards requests from the VM's network context, so port 22 is the
// VM's own SSH daemon — not the VirtualBox-forwarded 2222.
const PROXY_VM_CONFIG = { ...VM_CONFIG, port: 22 };

function makeConfigService() {
  return {
    getById: async () => ({
      hasRemote: true,
      data: {
        hostname: PROXY_VM_CONFIG.hostname,
        port: PROXY_VM_CONFIG.port,
        username: PROXY_VM_CONFIG.username,
        password: PROXY_VM_CONFIG.password,
        privateKeyPath: PROXY_VM_CONFIG.privateKeyPath,
        passphrase: PROXY_VM_CONFIG.passphrase,
        remotePath: REMOTE_PATHS.integration,
      },
      ignoreFilter: {
        globs: [],
        shouldIgnore: () => false,
        getFastGlobPatterns: () => [],
      } as any,
    }),
  } as any;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Proxy — SOCKS5 SSH/SFTP', function () {
  this.timeout(30000);

  let proxy: Proxy;
  let getProxyStub: sinon.SinonStub;
  let remote: SftpRemotePort;
  let localTempDir: string;
  const workspaceId: WorkspaceId = stringToWsId('/test-proxy-workspace');

  before(async function () {
    await setupVMTests(this);

    try {
      proxy = await startSocks5Proxy();
    } catch (err) {
      console.log(`\n⚠️  Could not start in-process SOCKS5 proxy: ${err instanceof Error ? err.message : err}`);
      this.skip();
      return;
    }

    // Point all LiveSync proxy calls at our in-process proxy
    getProxyStub = sinon.stub(proxyModule, 'getProxyConfig').returns(proxy.config);
  });

  after(function () {
    getProxyStub?.restore();
    proxy?.stop();
  });

  beforeEach(async function () {
    localTempDir = path.join(os.tmpdir(), `livesync-proxy-test-${Date.now()}`);
    await fs.mkdir(localTempDir, { recursive: true });
    remote = new SftpRemotePort(makeConfigService(), 4);

    try {
      await cleanupRemotePath(REMOTE_PATHS.integration);
    } catch (err) {
      console.warn(`⚠️  Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  afterEach(async () => {
    remote.dispose();
    await fs.rm(localTempDir, { recursive: true, force: true }).catch(() => {});
  });

  // ── Reachability ────────────────────────────────────────────────────────────

  describe('quickReachabilityTest', () => {
    it('returns true for reachable host through proxy', async () => {
      const ok = await ConfigValidator.quickReachabilityTest(
        PROXY_VM_CONFIG.hostname,
        PROXY_VM_CONFIG.port
      );
      assert.equal(ok, true);
    });

    it('returns false for unreachable host through proxy', async () => {
      const ok = await ConfigValidator.quickReachabilityTest('192.0.2.1', 22);
      assert.equal(ok, false);
    }).timeout(10000);
  });

  // ── Connection test ─────────────────────────────────────────────────────────

  describe('testConnection', () => {
    it('succeeds with valid credentials through proxy', async () => {
      const result = await ConfigValidator.testConnection({
        hostname: PROXY_VM_CONFIG.hostname,
        port: PROXY_VM_CONFIG.port,
        username: PROXY_VM_CONFIG.username,
        password: PROXY_VM_CONFIG.password,
      });
      assert.equal(result.success, true, result.details);
    });

    it('fails with wrong credentials through proxy', async () => {
      const result = await ConfigValidator.testConnection({
        hostname: PROXY_VM_CONFIG.hostname,
        port: PROXY_VM_CONFIG.port,
        username: PROXY_VM_CONFIG.username,
        password: 'wrong-password',
      });
      assert.equal(result.success, false);
    });

    it('fails when proxy is unreachable', async () => {
      getProxyStub.returns({ host: '127.0.0.1', port: 19999 });
      const result = await ConfigValidator.testConnection({
        hostname: PROXY_VM_CONFIG.hostname,
        port: PROXY_VM_CONFIG.port,
        username: PROXY_VM_CONFIG.username,
        password: PROXY_VM_CONFIG.password,
      });
      assert.equal(result.success, false);
      assert.match(result.message, /proxy/i);
      getProxyStub.returns(proxy.config); // restore for subsequent tests
    });
  });

  // ── File operations ─────────────────────────────────────────────────────────

  describe('file operations through proxy', () => {
    it('lists remote directory', async () => {
      const index = await remote.list(workspaceId);
      assert.ok(index instanceof Map);
    });

    it('uploads a file', async () => {
      const localFile = path.join(localTempDir, 'upload-test.txt');
      await fs.writeFile(localFile, 'proxy upload test');

      await assert.doesNotReject(() =>
        remote.uploadFile(workspaceId, stringToRel('upload-test.txt'), localFile)
      );
    });

    it('downloads a previously uploaded file', async () => {
      const localFile = path.join(localTempDir, 'roundtrip.txt');
      const content = `proxy roundtrip ${Date.now()}`;
      await fs.writeFile(localFile, content);

      await remote.uploadFile(workspaceId, stringToRel('roundtrip.txt'), localFile);

      const downloadTarget = path.join(localTempDir, 'roundtrip-dl.txt');
      await remote.downloadFile(workspaceId, stringToRel('roundtrip.txt'), downloadTarget);

      assert.equal(await fs.readFile(downloadTarget, 'utf8'), content);
    });

    it('creates a remote directory', async () => {
      await assert.doesNotReject(() =>
        remote.createDirectory(workspaceId, stringToRel('proxy-subdir'))
      );
    });

    it('deletes a remote file', async () => {
      const localFile = path.join(localTempDir, 'to-delete.txt');
      await fs.writeFile(localFile, 'delete me');
      await remote.uploadFile(workspaceId, stringToRel('to-delete.txt'), localFile);

      await assert.doesNotReject(() =>
        remote.deletePath(workspaceId, stringToRel('to-delete.txt'))
      );
    });
  });
});
