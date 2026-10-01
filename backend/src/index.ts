import 'dotenv/config';
import { createApp } from './app';
import { prisma } from './db';
const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
const server = createApp(prisma).listen(port, process.env.HOST ?? '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log(`Order API listening on http://${address.address}:${address.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(() => { void prisma.$disconnect(); });
});
