import express from 'express';
import swaggerUi from 'swagger-ui-dist';
import { createOpenApiSpec } from './openapi.js';

export function mountApiDocs(app, config) {
  const spec = createOpenApiSpec(config);
  app.get('/api/openapi.json', (_req, res) => res.json(spec));
  app.get('/api/docs', (_req, res) => {
    res.set('X-Robots-Tag', 'noindex').type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golden Events API</title><link rel="stylesheet" href="/api/docs/assets/swagger-ui.css">
<link rel="icon" href="/api/docs/assets/favicon-32x32.png"></head>
<body><div id="swagger-ui"></div><script src="/api/docs/assets/swagger-ui-bundle.js"></script>
<script src="/api/docs/init.js"></script></body></html>`);
  });
  app.get('/api/docs/init.js', (_req, res) => {
    res.type('application/javascript').send(`window.ui = SwaggerUIBundle({
      url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true,
      validatorUrl: null, persistAuthorization: false,
      supportedSubmitMethods: ${JSON.stringify(config.production ? [] : ['get', 'post', 'put', 'delete'])},
      displayRequestDuration: true, defaultModelsExpandDepth: -1
    });`);
  });
  // Serve only the assets used here, never Swagger's example initializer or specs.
  const assets = new Set(['swagger-ui.css', 'swagger-ui-bundle.js', 'favicon-32x32.png']);
  app.use(
    '/api/docs/assets',
    (req, res, next) => {
      if (!assets.has(req.path.slice(1)))
        return res.status(404).json({ error: 'Asset not found.' });
      next();
    },
    express.static(swaggerUi.getAbsoluteFSPath(), { index: false, dotfiles: 'deny' }),
  );
}
