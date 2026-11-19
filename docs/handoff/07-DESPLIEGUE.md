# Despliegue

La modalidad local en Querétaro cobra solo las prendas; TARSI cotiza el delivery y contacta al cliente cuando esté listo. El remitente para producción es Gmail por OAuth de Floot. El administrador debe autorizar tarsi.studiomx@gmail.com desde Pedidos → Conectar Gmail. Resend conserva su función de pruebas y se confirmó recepción en Gmail.

Node 22+, `npm ci`, `npm run build`. En Netlify, GitHub genera Deploy Preview al abrir un PR. Producción requiere aprobación explícita.

Variables de Functions: `TARSI_QUOTE_SECRET` (secreto aleatorio independiente por contexto), `TARSI_DASHBOARD_URL` (endpoint Floot), `TARSI_DASHBOARD_TOKEN` (256 bits aleatorios en hexadecimal). Configurar solo en Functions. En Floot se guarda solo el SHA-256 del token como fingerprint; utilizar credenciales distintas para preview y producción. La URL de preview de Floot usa el subdominio sandbox del proyecto y la ruta `/_api/tarsi_web_order`; producción usa el dominio publicado. Para transferencia usar `TARSI_BANK_NAME`, `TARSI_BANK_HOLDER` y `TARSI_BANK_CLABE` con datos oficiales. El checkout requiere `TARSI_LOCAL_DELIVERY_MXN` para emitir un total de entrega local, incluido 0 solo si TARSI lo aprueba.

Conservar las variables existentes `SKYDROPX_CLIENT_ID`, `SKYDROPX_CLIENT_SECRET`, `SKYDROPX_ENV`, `TARSI_ORIGIN_CP`, `TARSI_ORIGIN_COLONY` y el catálogo en Netlify Blobs. La preview consulta el cotizador de producción cuando carece de credenciales de Skydropx. Producción debe cotizar directamente.

Para repetir la prueba real desde un checkout local, inyecta las tres variables `TARSI_QUOTE_SECRET`, `TARSI_DASHBOARD_TOKEN`, `TARSI_DASHBOARD_URL` de staging por un gestor seguro y ejecuta `node scripts/smoke-checkout.js` (añade `--use-env-proxy` si necesitas el proxy del entorno). Usa solo el token marcado como prueba en Floot. El comando imprime el número para verificar la fila en PostgreSQL.

## Despliegue coordinado de ventas integrales

Tras aprobación, crea un token aleatorio de 32 bytes en hexadecimal y una clave propia para las cotizaciones de producción con un gestor de secretos. Guarda el token en Netlify Functions como `TARSI_DASHBOARD_TOKEN`, su SHA-256 en `productionFingerprint` en Floot, y configura `TARSI_DASHBOARD_URL` al endpoint publicado. Configura transferencia y costo local aprobado en el contexto de producción. Completa Resend desde el conector seguro de Floot. Comprueba un look-up sin efectos con autenticación, publica Floot primero y luego integra la rama de tienda. Verifica las URLs y conserva los ID de despliegue anteriores. Para revertir, restaura primero Netlify al despliegue anterior y después restaura la publicación previa de Floot. Conserva las tablas, historial y pedidos recibidos; no deshagas las migraciones sobre datos activos.

## Ruta de producción sin costo (vigente)

La rama prepara `/_api/tarsi_live_checkout` en Floot con activación por fila. El modo de prueba conserva su endpoint sandbox, llaves de cotización derivadas por separado y `is_test=true`. Netlify solo reenvía solicitudes de su propia tienda. Mantener `shipping-quote` en Netlify para el cotizador real de Skydropx; el navegador usa `checkout-quote` para recibir la prueba de tarifa de Floot. Esta separación evita recursión.

Después de aprobación expresa: (1) comprobar el checkpoint de Floot, el Gmail conectado y el respaldo/rollback; (2) publicar Floot y comprobar que sin activación responde 503 a un POST de checkout válido y no crea pedidos; (3) insertar la configuración oficial en `tarsi_live_checkout_config` por un canal seguro con `enabled=true` y verificar la ruta de cotización y una recuperación inexistente sin generar ventas; (4) fusionar el PR #6 y observar el despliegue de Netlify; (5) confirmar que la tienda visible sirve el nuevo checkout y puede cotizar. No requiere subir el plan de Netlify ni colocar claves en el navegador. Para revertir, restaurar primero el deploy anterior de Netlify, desactivar la fila de activación y después revertir Floot cuando corresponda. Los pedidos persistidos se conservan.
