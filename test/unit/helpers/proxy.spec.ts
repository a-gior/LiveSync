import { strict as assert } from 'assert';
import { detectSystemProxy } from '../../../src/infrastructure/helpers/proxy/detectSystemProxy';

// Save and restore process.env around each test
let savedEnv: Record<string, string | undefined> = {};
const PROXY_ENV_KEYS = [
  'ALL_PROXY', 'all_proxy',
  'HTTPS_PROXY', 'https_proxy',
  'HTTP_PROXY', 'http_proxy',
];

function clearProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    delete process.env[key];
  }
}

beforeEach(() => {
  savedEnv = {};
  for (const key of PROXY_ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  clearProxyEnv();
});

afterEach(() => {
  for (const key of PROXY_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe('detectSystemProxy', () => {
  describe('returns null when no proxy is configured', () => {
    it('returns null with no env vars set', () => {
      assert.equal(detectSystemProxy(), null);
    });

    it('returns null for empty string values', () => {
      process.env['ALL_PROXY'] = '';
      assert.equal(detectSystemProxy(), null);
    });

    it('returns null for invalid format (missing port)', () => {
      process.env['ALL_PROXY'] = '192.168.1.1';
      assert.equal(detectSystemProxy(), null);
    });

    it('returns null for invalid port out of range', () => {
      process.env['ALL_PROXY'] = '192.168.1.1:99999';
      assert.equal(detectSystemProxy(), null);
    });

    it('returns null for port zero', () => {
      process.env['ALL_PROXY'] = '192.168.1.1:0';
      assert.equal(detectSystemProxy(), null);
    });
  });

  describe('parses host:port format', () => {
    it('parses plain IPv4:port', () => {
      process.env['ALL_PROXY'] = '192.168.1.1:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, '192.168.1.1');
      assert.equal(result.port, 1080);
    });

    it('parses hostname:port', () => {
      process.env['ALL_PROXY'] = 'proxy.corp.com:3128';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, 'proxy.corp.com');
      assert.equal(result.port, 3128);
    });

    it('parses localhost:port', () => {
      process.env['ALL_PROXY'] = 'localhost:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, 'localhost');
      assert.equal(result.port, 1080);
    });
  });

  describe('parses full socks5:// URL format', () => {
    it('parses socks5://host:port', () => {
      process.env['ALL_PROXY'] = 'socks5://proxy.corp.com:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, 'proxy.corp.com');
      assert.equal(result.port, 1080);
    });

    it('parses socks5://user:pass@host:port', () => {
      process.env['ALL_PROXY'] = 'socks5://alice:secret@proxy.corp.com:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, 'proxy.corp.com');
      assert.equal(result.port, 1080);
      assert.equal(result.username, 'alice');
      assert.equal(result.password, 'secret');
    });

    it('parses socks5://user@host:port (no password)', () => {
      process.env['ALL_PROXY'] = 'socks5://alice@proxy.corp.com:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.username, 'alice');
      assert.equal(result.password, undefined);
    });

    it('parses http://host:port (non-SOCKS scheme)', () => {
      process.env['ALL_PROXY'] = 'http://proxy.corp.com:8080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, 'proxy.corp.com');
      assert.equal(result.port, 8080);
    });
  });

  describe('parses IPv6 addresses', () => {
    it('parses bracketed IPv6 via URL format', () => {
      process.env['ALL_PROXY'] = 'socks5://[::1]:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, '::1');
      assert.equal(result.port, 1080);
    });
  });

  describe('env var priority', () => {
    it('ALL_PROXY takes priority over HTTPS_PROXY', () => {
      process.env['ALL_PROXY'] = '10.0.0.1:1080';
      process.env['HTTPS_PROXY'] = '10.0.0.2:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, '10.0.0.1');
    });

    it('HTTPS_PROXY takes priority over HTTP_PROXY', () => {
      process.env['HTTPS_PROXY'] = '10.0.0.2:1080';
      process.env['HTTP_PROXY'] = '10.0.0.3:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, '10.0.0.2');
    });

    it('falls back to HTTP_PROXY when others are unset', () => {
      process.env['HTTP_PROXY'] = '10.0.0.3:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, '10.0.0.3');
    });

    it('lowercase env vars are also recognised', () => {
      process.env['all_proxy'] = '10.0.0.4:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, '10.0.0.4');
    });

    it('skips an invalid entry and falls through to the next', () => {
      process.env['ALL_PROXY'] = 'not-valid';
      process.env['HTTPS_PROXY'] = '10.0.0.2:1080';
      const result = detectSystemProxy();
      assert.ok(result);
      assert.equal(result.host, '10.0.0.2');
    });
  });
});
