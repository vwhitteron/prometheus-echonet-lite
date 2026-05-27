import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import Metrics, { MeterConfig } from './metrics';
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
    meters?: Record<string, MeterConfig>;
}

const configPath = path.resolve(__dirname, '..', 'config.json');
const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Config;

const port: number = config.server.port != null
    ? parseInt(config.server.port, 10)
    : 3000;

const address: string = config.server.address ?? '127.0.0.1';

const netif = resolveNetif(config.echonet.netif);
Metrics.init(netif, config.echonet.discoveryIntervalSecs, config.echonet.discoveryDurationSecs, config.echonet.epcTimeoutSecs, config.meters);

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
    await new Promise<void>(resolve => { server.close(() => resolve()); });
    await Metrics.echonet.shutdown();
    process.exit(0);
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(e => logger.error(String(e))); });
process.on('SIGINT', () => { shutdown('SIGINT').catch(e => logger.error(String(e))); });
