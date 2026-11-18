# Catálogo TARSI

El catálogo estático y las funciones de compra se publican juntos en Netlify. El build copia solo el catálogo, sus scripts y sus recursos visuales a `dist`. Se retiró `index 2.html` porque duplicaba la tienda y retenía el flujo anterior. La página conserva el diseño, las fotos, el logotipo y las opciones de pedido manual. El pago con tarjeta se ofrece para envío nacional con una cotización vigente. La entrega local sigue coordinándose con TARSI.

## Ejecutar localmente

Usa Node.js 22 o posterior.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Para probar con Chromium instalado en el sistema, define `TARSI_CHROMIUM` con su ruta. Las pruebas de navegador levantan una tienda local y simulan Skydropx y Stripe. La prueba de integración usa el SDK de Stripe para firmar el webhook local y almacenamiento en memoria para verificar concurrencia y reenvíos.

Con el TXT nacional de Correos de México extraído localmente, ejecuta también:

```sh
TARSI_TEST_POSTAL_FILE=/ruta/privada/CPdescarga.txt npm test
```

## Preparar un ambiente de prueba

1. Vincula una rama de prueba al sitio Netlify autorizado. Configura las variables de [.env.example](.env.example) en el alcance **Functions** de ese ambiente. Define `TARSI_SITE_URL` con el origen exacto, por ejemplo `https://tarsi-ejemplo.netlify.app`. La tienda y el webhook requieren acceso desde el navegador del cliente y desde Stripe, respectivamente.
2. Descarga el ZIP nacional en formato TXT del [Catálogo Nacional de Códigos Postales de Correos de México](https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx) y extrae `CPdescarga.txt`. Mantén ese archivo fuera de Git. El TXT oficial incluye restricciones de distribución. El script importa a almacenamiento privado y la tienda consulta únicamente el C.P. solicitado. Configura `NETLIFY_SITE_ID` y `NETLIFY_AUTH_TOKEN` en la sesión autorizada para importar, y ejecuta:

   ```sh
   npm run postal:import -- /ruta/privada/CPdescarga.txt
   ```

   La importación valida que sea el catálogo nacional de 32 entidades, escribe una versión por SHA-256 y cambia el puntero activo después de completar la carga. Las funciones pueden tardar hasta cinco minutos en usar la versión nueva.
3. Configura `SKYDROPX_ENV=sandbox` y el par de credenciales Sandbox de Skydropx PRO. Verifica el C.P., colonia y embalaje del origen. Las medidas conservan la fórmula original de 30 × 25 × (4 cm por pieza), con 350 g por playera. Haz cotizaciones reales para `01000`, `64000` y `76099` y cruza el resultado con la cotización correspondiente en Skydropx. El costo para el cliente es el `total` válido en MXN más el mayor entre 20% y $30, redondeado hacia arriba a un múltiplo de $10. Registra la evidencia antes de avanzar. [Referencia oficial de Skydropx PRO](https://api-pro.skydropx.com/es-MX/api-docs/legacy).
4. Genera `TARSI_QUOTE_SECRET` con `openssl rand -hex 32`. En un sandbox de Stripe, configura `STRIPE_SECRET_KEY` con la clave `sk_test_` y registra un webhook para `checkout.session.completed` en `/.netlify/functions/stripe-webhook`. Guarda el secreto de ese endpoint en `STRIPE_WEBHOOK_SECRET`. El botón de tarjeta indicará que se trata de una prueba. Completa un pago con la [tarjeta de prueba de Stripe](https://docs.stripe.com/testing), comprueba un rechazo y una cancelación, y reenvía el webhook para verificar un único registro. [Guía oficial de Checkout y confirmación](https://docs.stripe.com/checkout/fulfillment).
5. Comprueba en Netlify Blobs el pedido bajo `tarsi-orders-test` → `paid/<id>`. La tienda muestra el folio cuando el webhook registra el pago. El pedido incluye modelos, tallas, contacto, destino, desglose, cotización y referencia de Stripe. Los intentos sin pago permanecen bajo `pending/`. Revisa periódicamente los intentos vencidos y retira esos registros según la política de retención de la tienda. Configura los recibos en Stripe si TARSI quiere que se envíen por correo.

## Activación de producción

Completa las pruebas conectadas antes de fusionar y publicar. Tras autorización expresa, usa las credenciales de Skydropx PRO para `SKYDROPX_ENV=production`, importa el catálogo al sitio de producción si es otro y configura la URL canónica. Para activar cobros, completa la verificación de la cuenta Stripe, crea el webhook de modo real y limita `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y `TARSI_ENABLE_LIVE_PAYMENTS=true` al contexto de producción. Los pedidos pagados se guardan en `tarsi-orders-live`. El flujo registra pedidos pagados para preparación en TARSI. La compra de guías y la coordinación de entrega forman parte de la operación de TARSI.
