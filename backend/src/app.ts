import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { HttpError } from './errors';
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
export function createApp(db: PrismaClient, log: (error: unknown) => void = console.error) {
  const app = express();
  app.use((request, response, next) => { response.locals.requestId = randomUUID(); response.setHeader('X-Request-Id', response.locals.requestId); next(); });
  app.use(cors()); app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/api/products', productRoutes(db)); app.use('/api/orders', orderRoutes(db));
  app.use((_request, _response, next) => next(new HttpError(404, 'Route not found.')));
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    let status = 500; let message = 'The database operation could not be completed.';
    if (error instanceof HttpError) { status = error.status; message = error.message; }
    else if (error instanceof ZodError) { status = 400; message = error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '); }
    else if (error?.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON.'; }
    else if (error?.type === 'entity.too.large') { status = 413; message = 'Request body is too large.'; }
    else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2002', 'P2034'].includes(error.code)) {
      status = 409; message = error.code === 'P2003' ? 'This product is referenced by order history and cannot be deleted.' : 'A conflicting database change occurred. Refresh and retry.';
    }
    else log(error);
    response.status(status).json({ error: { message, requestId: response.locals.requestId } });
  };
  app.use(errors); return app;
}
