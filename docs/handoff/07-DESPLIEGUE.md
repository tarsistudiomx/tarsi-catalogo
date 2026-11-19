# Despliegue

La modalidad local en Querétaro cobra solo las prendas; TARSI cotiza el delivery y contacta al cliente cuando esté listo. El remitente para producción es Gmail por OAuth de Floot. El administrador debe autorizar tarsi.studiomx@gmail.com desde Pedidos → Conectar Gmail. Resend conserva su función de pruebas y se confirmó recepción en Gmail.

Node 22+, `npm ci`, `npm run build`. En Netlify, GitHub genera Deploy Preview al abrir un PR. Producción requiere aprobación explícita.

Variables de Functions: `TARSI_QUOTE_SECRET` (secreto aleatorio independiente por contexto), `TARSI_DASHBOARD_URL` (endpoint Floot), `TARSI_DASHBOARD_TOKEN` (256 bits aleatorios en hexadecimal). Configurar solo en Functions. En Floot se guarda solo el SHA-256 del token como fingerprint; utilizar credenciales distintas para preview y producción. La URL de preview de Floot usa el subdominio sandbox del proyecto y la ruta `/_api/tarsi_web_order`; producción usa el dominio publicado. Para transferencia usar `TARSI_BANK_NAME`, `TARSI_BANK_HOLDER` y `TARSI_BANK_CLABE` con datos oficiales. El checkout requiere `TARSI_LOCAL_DELIVERY_MXN` para emitir un total de entrega local, incluido 0 solo si TARSI lo aprueba.

Conservar las variables existentes `SKYDROPX_CLIENT_ID`, `SKYDROPX_CLIENT_SECRET`, `SKYDROPX_ENV`, `TARSI_ORIGIN_CP`, `TARSI_ORIGIN_COLONY` y el catálogo en Netlify Blobs. La preview consulta el cotizador de producción cuando carece de credenciales de Skydropx. Producción debe cotizar directamente.

Para repetir la prueba real desde un checkout local, inyecta las tres variables `TARSI_QUOTE_SECRET`, `TARSI_DASHBOARD_TOKEN`, `TARSI_DASHBOARD_URL` de staging por un gestor seguro y ejecuta `node scripts/smoke-checkout.js` (añade `--use-env-proxy` si necesitas el proxy del entorno). Usa solo el token marcado como prueba en Floot. El comando imprime el número para verificar la fila en PostgreSQL.

## Despliegue coordinado de ventas integrales

Tras aprobación, crea un token aleatorio de 32 bytes en hexadecimal y una clave propia para las cotizaciones de producción con un gestor de secretos. Guarda el token en Netlify Functions como `TARSI_DASHBOARD_TOKEN`, su SHA-256 en `productionFingerprint` en Floot, y configura `TARSI_DASHBOARD_URL` al endpoint publicado. Configura transferencia y costo local aprobado en el contexto de producción. Completa Resend desde el conector seguro de Floot. Comprueba un look-up sin efectos con autenticación, publica Floot primero y luego integra la rama de tienda. Verifica las URLs y conserva los ID de despliegue anteriores. Para revertir, restaura primero Netlify al despliegue anterior y después restaura la publicación previa de Floot. Conserva las tablas, historial y pedidos recibidos; no deshagas las migraciones sobre datos activos.
