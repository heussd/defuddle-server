import buildApp from './app.js';
import { noNetworks } from './fetch-html.js';

const port = Number(process.env.PORT) || 3000;
const allowPrivateNetworks = process.env.ALLOW_PRIVATE_NETWORKS === 'true';

const app = await buildApp({
  logger: true,
  blockedNetworks: allowPrivateNetworks ? noNetworks : undefined,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => app.close());
}

await app.listen({ host: '0.0.0.0', port });
