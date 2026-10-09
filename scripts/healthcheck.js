import { request } from 'node:http';

const req = request(
  {
    hostname: '127.0.0.1',
    port: Number(process.env.PORT || 3001),
    path: '/api/ready',
    headers: { Host: process.env.BASE_DOMAIN || 'goldencreation.localhost' },
    timeout: 4000,
  },
  (res) => {
    res.resume();
    res.on('end', () => process.exit(res.statusCode === 200 ? 0 : 1));
  },
);
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
req.on('error', () => process.exit(1));
req.end();
