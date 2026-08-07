import express from 'express';
import cors from 'cors';
import './types/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import photosRouter from './routes/photos.js';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

/**
 * Liveness. No auth, no database.
 *
 * It answers whether this process is up, and deliberately nothing else — a health check
 * that queries the database goes red during a database blip and takes the process down
 * with it, turning a degraded read path into an outage.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cat-frame' });
});

app.use('/photos', photosRouter);

// Last, always: everything above reaches error responses by calling next(err).
app.use(errorHandler);
