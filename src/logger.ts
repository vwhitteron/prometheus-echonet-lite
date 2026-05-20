/**
 * Minimal logger.
 *
 * Log levels (lowest → highest): debug < info < warn < error
 *
 * The active level is controlled by the LOG_LEVEL environment variable.
 * Defaults to "info".  Set LOG_LEVEL=debug to enable debug output.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

function activeLevel(): number {
    const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
    return LEVELS[env] ?? LEVELS.info;
}

function log(level: Level, message: string): void {
    if (LEVELS[level] < activeLevel()) return;
    const out = level === 'error' ? console.error : console.log;
    out(`[${level.toUpperCase()}] ${message}`);
}

const logger = {
    debug: (msg: string) => log('debug', msg),
    info: (msg: string) => log('info', msg),
    warn: (msg: string) => log('warn', msg),
    error: (msg: string) => log('error', msg),
};

export default logger;
