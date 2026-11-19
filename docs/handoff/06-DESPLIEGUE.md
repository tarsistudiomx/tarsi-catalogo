# Despliegue

Node 22+, `npm ci`, `npm run build`. En Netlify, GitHub genera Deploy Preview al abrir un PR. Producción requiere aprobación explícita.

Variables de Functions: `TARSI_QUOTE_SECRET` (secreto aleatorio independiente por contexto), `TARSI_DASHBOARD_URL` (endpoint Floot), `TARSI_DASHBOARD_TOKEN` (256 bits aleatorios en hexadecimal). Configurar solo en Functions. En Floot se guarda solo el SHA-256 del token como fingerprint; utilizar credenciales distintas para preview y producción. La URL de preview de Floot usa el subdominio sandbox del proyecto y la ruta `/_api/tarsi_web_order`; producción usa el dominio publicado. Para transferencia usar `TARSI_BANK_NAME`, `TARSI_BANK_HOLDER` y `TARSI_BANK_CLABE` con datos oficiales. El checkout requiere `TARSI_LOCAL_DELIVERY_MXN` para emitir un total de entrega local, incluido 0 solo si TARSI lo aprueba.

Conservar las variables existentes `SKYDROPX_CLIENT_ID`, `SKYDROPX_CLIENT_SECRET`, `SKYDROPX_ENV`, `TARSI_ORIGIN_CP`, `TARSI_ORIGIN_COLONY` y el catálogo en Netlify Blobs. La preview consulta el cotizador de producción cuando carece de credenciales de Skydropx. Producción debe cotizar directamente.
