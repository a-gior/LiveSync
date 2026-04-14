import { execSync } from 'child_process';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * Parse a proxy URL string into a ProxyConfig.
 * Accepts formats:
 *   socks5://user:pass@host:port
 *   host:port
 */
function parseProxyUrl(raw: string): ProxyConfig | null {
  try {
    // Strip protocol prefix if present so URL constructor can handle it
    let normalized = raw.trim();
    if (!normalized.includes('://')) {
      normalized = 'socks5://' + normalized;
    }

    const url = new URL(normalized);
    // url.hostname keeps brackets for IPv6 (e.g. "[::1]") — strip them
    const host = url.hostname.replace(/^\[(.+)\]$/, '$1');
    const port = parseInt(url.port, 10);

    if (!host || isNaN(port) || port <= 0 || port > 65535) {
      return null;
    }

    return {
      host,
      port,
      username: url.username || undefined,
      password: url.password || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Read proxy from Windows Internet Settings registry via PowerShell.
 * Returns null on non-Windows or if no proxy is configured.
 */
function readWindowsRegistryProxy(): ProxyConfig | null {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const raw = execSync(
      'powershell -NoProfile -Command "' +
        '(Get-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\' ' +
        '-Name ProxyServer -ErrorAction SilentlyContinue).ProxyServer' +
        '"',
      { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();

    if (!raw) {
      return null;
    }

    return parseProxyUrl(raw);
  } catch {
    return null;
  }
}

/**
 * Detect the system SOCKS5 proxy.
 *
 * Resolution order:
 *   1. ALL_PROXY environment variable
 *   2. HTTPS_PROXY environment variable
 *   3. HTTP_PROXY environment variable
 *   4. Windows Internet Settings registry (Windows only)
 *
 * Returns null if no system proxy is found.
 */
export function detectSystemProxy(): ProxyConfig | null {
  const candidates = [
    process.env['ALL_PROXY'],
    process.env['all_proxy'],
    process.env['HTTPS_PROXY'],
    process.env['https_proxy'],
    process.env['HTTP_PROXY'],
    process.env['http_proxy'],
  ];

  for (const candidate of candidates) {
    if (candidate) {
      const parsed = parseProxyUrl(candidate);
      if (parsed) {
        return parsed;
      }
    }
  }

  return readWindowsRegistryProxy();
}
