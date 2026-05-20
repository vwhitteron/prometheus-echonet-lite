import os from 'os';
import logger from './logger';

/**
 * Resolve the network interface address to bind to.
 *
 * Resolution order:
 *  1. If `configured` is a non-empty string other than "auto", use it as-is.
 *  2. Otherwise, pick the first non-loopback, non-link-local IPv4 address
 *     found on any interface.
 *
 * Throws if no suitable address can be found automatically.
 */
export function resolveNetif(configured?: string): string {
    if (configured && configured !== 'auto') {
        return configured;
    }

    const ifaces = os.networkInterfaces();

    for (const [name, addrs] of Object.entries(ifaces)) {
        if (!addrs) continue;

        for (const addr of addrs) {
            if (
                addr.family === 'IPv4' &&
                !addr.internal &&                          // skip loopback
                !addr.address.startsWith('169.254.')       // skip link-local
            ) {
                logger.info(`Auto-detected network interface: ${name} (${addr.address})`);
                return addr.address;
            }
        }
    }

    throw new Error(
        'Could not auto-detect a suitable network interface. ' +
        'Set "netif" to an explicit IP address in config.json.'
    );
}
