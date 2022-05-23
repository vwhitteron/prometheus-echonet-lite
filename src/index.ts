import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import Metrics from './metrics';

dotenv.config();

const app: Express = express();
const port: number = process.env.PORT != null
                   ? parseInt(process.env.PORT, 10)
                   : 3000;

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
    console.log(`Server is running at https://0.0.0.0:${port}`);
})