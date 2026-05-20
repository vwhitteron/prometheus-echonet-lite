import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import Metrics from './metrics';
import { resolveNetif } from './netif';
import logger from './logger';

interface Config {
    server: {
        address?: string;
        port?: string;
    };
    echonet: {
        netif?: string;
        discoveryIntervalSecs: number;
        discoveryDurationSecs: number;
        epcTimeoutSecs?: number;
    };
}

const configPath = path.resolve(__dirname, '..', 'config.json');
const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Config;

const port: number = config.server.port != null
    ? parseInt(config.server.port, 10)
    : 3000;

const address: string = config.server.address ?? '127.0.0.1';

const netif = resolveNetif(config.echonet.netif);
Metrics.init(netif, config.echonet.discoveryIntervalSecs, config.echonet.discoveryDurationSecs, config.echonet.epcTimeoutSecs);

const app: Express = express();

app.get('/metrics', async (_req: Request, res: Response) => {
    try {
        const metrics = await Metrics.getMetrics();
        res.type('text/plain').send(metrics);
    } catch (e) {
        logger.error(String(e));
        res.status(500).send('Internal Server Error');
    }
});

const server = app.listen(port, address, () => {
    logger.info(`Server is running at http://${address}:${port}`);
});

async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close();
    await Metrics.echonet.shutdown();
    process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
