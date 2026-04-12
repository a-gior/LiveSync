import * as net from 'net';
import { SocksClient } from 'socks';
import * as vscode from 'vscode';
import { detectSystemProxy, type ProxyConfig } from './detectSystemProxy';

/**
 * Read proxy configuration from VSCode settings.
 * Returns null if proxy is disabled or not configured.
 */
export function getProxyConfig(): ProxyConfig | null {
  const cfg = vscode.workspace.getConfiguration('livesync.proxy');
  const enabled: boolean = cfg.get('enabled', false);

  if (!enabled) {
    return null;
  }

  const rawHost: string = cfg.get('host', '').trim();
  const username: string = cfg.get('username', '').trim();
  const password: string = cfg.get('password', '').trim();

  if (!rawHost) {
    // Fall back to OS proxy
    const system = detectSystemProxy();
    if (!system) {
      return null;
    }
    // Overlay credentials from VSCode settings if provided
    return {
      ...system,
      username: username || system.username,
      password: password || system.password,
    };
  }

  const parsed = parseHostPort(rawHost);
  if (!parsed) {
    return null;
  }

  return {
    host: parsed.host,
    port: parsed.port,
    username: username || undefined,
    password: password || undefined,
  };
}

/**
 * Parse a "host:port" string. Handles IPv6 addresses like [::1]:1080.
 */
function parseHostPort(raw: string): { host: string; port: number } | null {
  try {
    // IPv6 bracketed address: [::1]:1080
    const ipv6Match = raw.match(/^\[([^\]]+)\]:(\d+)$/);
    if (ipv6Match) {
      const port = parseInt(ipv6Match[2], 10);
      return isValidPort(port) ? { host: ipv6Match[1], port } : null;
    }

    // hostname:port or IPv4:port
    const lastColon = raw.lastIndexOf(':');
    if (lastColon === -1) {
      return null;
    }

    const host = raw.slice(0, lastColon);
    const port = parseInt(raw.slice(lastColon + 1), 10);
    return host && isValidPort(port) ? { host, port } : null;
  } catch {
    return null;
  }
}

function isValidPort(port: number): boolean {
  return !isNaN(port) && port > 0 && port <= 65535;
}

/**
 * Create a TCP socket tunnelled through the configured SOCKS5 proxy,
 * destined for targetHost:targetPort (the SSH server).
 *
 * Returns a net.Socket ready to be passed as `sock` to ssh2 / ssh2-sftp-client.
 * Throws if the proxy is misconfigured or unreachable.
 */
export async function createProxySocket(
  targetHost: string,
  targetPort: number,
  proxy: ProxyConfig
): Promise<net.Socket> {
  const socksOptions: Parameters<typeof SocksClient.createConnection>[0] = {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5,
      ...(proxy.username
        ? { userId: proxy.username, password: proxy.password ?? '' }
        : {}),
    },
    command: 'connect',
    destination: {
      host: targetHost,
      port: targetPort,
    },
  };

  const { socket } = await SocksClient.createConnection(socksOptions);
  return socket;
}
