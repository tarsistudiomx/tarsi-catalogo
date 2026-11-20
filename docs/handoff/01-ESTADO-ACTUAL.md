# Estado actual

## Entrega con folios cortos, reservas y reportes de transferencia

Lee primero [el flujo vigente y la verificación de producción](10-FLUJO-RESERVAS.md). Las notas anteriores se conservan como historial.

La modalidad local en Querétaro cobra solo las prendas; TARSI cotiza el delivery y contacta al cliente cuando esté listo. El remitente para producción es Gmail por OAuth de Floot. El administrador debe autorizar tarsi.studiomx@gmail.com desde Pedidos → Conectar Gmail. Resend conserva su función de pruebas y se confirmó recepción en Gmail.

Rama de tienda: `feat/tarsi-checkout-dashboard`, basada en la actualización de fotos y zoom del PR #4. Floot encontrado como Tarsi — Control de Ventas (66f62c32-15c0-4546-ba6e-bce0efe72d71). No hay tabla de pedidos web previa. Floot no habilita ramas para esta cuenta. Producción sujeta a aprobación.

PR borrador [#5](https://github.com/tarsistudiomx/tarsi-catalogo/pull/5). [Deploy Preview](https://deploy-preview-5--tarsi-skydropx.netlify.app/) protegida por sesión. Se configuraron URL y credenciales nuevas únicamente para deploy-preview. Los endpoints de Floot están en su editor, con persistencia en la base real y modo separado de prueba. No se publicó el Dashboard ni se mezcló la tienda.

El Dashboard de Floot recibió un pedido de prueba por su endpoint de editor. La base PostgreSQL real devolvió una sola fila con total $579, inicialmente pendiente de pago. En un segundo paso se probó el flujo de estados hasta Entregado con una guía de prueba. La URL de Netlify protegida y la interfaz del administrador requieren aún la comprobación en sesión. Faltan los datos bancarios oficiales y el costo local aprobado.

## Ventas integrales

La rama vigente es `feat/tarsi-ventas-integrales`, basada en el PR #5. Storefront y Dashboard público continúan en versiones anteriores. Los tres nuevos componentes de persistencia se agregaron de forma aditiva en la base existente y el código se cargó solo en el editor Floot. La prueba integral de API registra y confirma pedidos de prueba; el envío real de correo está bloqueado por la conexión Resend.

Vista previa vigente: https://deploy-preview-6--tarsi-skydropx.netlify.app/ · PR borrador https://github.com/tarsistudiomx/tarsi-catalogo/pull/6 · implementación `62657b8`. Netlify informó SUCCESS; solicitudes anónimas a la vista previa reciben HTTP 401. Checkpoint Floot `23ce5d79-8e18-4e87-8539-cad2ef1beb17`. El PR #6 incluye el trabajo de #4 y #5; no fusionarlos por separado.
