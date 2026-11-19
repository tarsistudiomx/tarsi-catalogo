# Arquitectura

GitHub contiene el sitio estático. Netlify ejecuta `scripts/build.js` y sirve `dist/`. `index.html` contiene el catálogo y el carrito. `shop.js` comparte el catálogo y las promociones entre navegador y servidor. `shipping-ui.js` valida colonia y maneja la cotización. `checkout.js` controla el envío, los reintentos y la confirmación.

`postal-code.js` consulta SEPOMEX en Blobs. `shipping-quote.js` conserva el cotizador Skydropx con origen 76099, paqueterías permitidas y margen existente. Cuando hay una clave de checkout, agrega una prueba cifrada de la tarifa vigente, vinculada a destino y piezas. `submit-order.js` valida, recalcula y llama a Floot. Floot persiste en PostgreSQL.

En la rama integral, una UUID aleatoria guardada en el navegador permite recuperar un recibo sin PII, incluso si se perdió la respuesta. Esta clave actúa como capacidad privada del navegador. Floot decide la identidad del pedido por clave + ámbito, y una transacción asigna el pago y su trabajo. Dos vistas administrativas leen esa única relación. El correo usa Resend con estado duradero, después de persistir el pedido.
