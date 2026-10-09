import { makeConfig } from './config.js';
import { openDatabase } from './db.js';
import { seedDemo } from './seed.js';
import { createApp } from './app.js';
import { startWorker } from './providers.js';

const config = makeConfig();
const db = openDatabase(config.dataDir);
seedDemo(db, config);
const stopWorker = startWorker(db, config);
const server = createApp(db, config).listen(config.port, '0.0.0.0', () =>
  console.log(
    `Golden Events API: http://localhost:${config.port} | payments: ${config.paymentDriver}`,
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    stopWorker();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
