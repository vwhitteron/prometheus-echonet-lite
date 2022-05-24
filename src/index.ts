import express, { Express, Request, Response } from 'express';
import Metrics from './metrics';

const config = require('../config.json');

const app: Express = express();

const port: number = config.server.port != null
                   ? parseInt(config.server.port, 10)
                   : 3000;

const address: number = config.server.address != null
                   ? config.server.address
                   : "127.0.0.1";


app.get('/metrics', async (req: Request, res: Response) => {
    try {
        const metrics = await Metrics.getMetrics();
        res.type('text/plain').send(metrics);
    } catch (e) {
        console.error(e)
        throw e 
    }
});

app.listen(port, () => {
    console.log(`Server is running at https://${address}:${port}`);
})