# Estado actual

Rama de tienda: `feat/tarsi-checkout-dashboard`, basada en la actualización de fotos y zoom del PR #4. Floot encontrado como Tarsi — Control de Ventas (66f62c32-15c0-4546-ba6e-bce0efe72d71). No hay tabla de pedidos web previa. Floot no habilita ramas para esta cuenta. Producción sujeta a aprobación.

PR borrador [#5](https://github.com/tarsistudiomx/tarsi-catalogo/pull/5). [Deploy Preview](https://deploy-preview-5--tarsi-skydropx.netlify.app/) protegida por sesión. Se configuraron URL y credenciales nuevas únicamente para deploy-preview. Los endpoints de Floot están en su editor, con persistencia en la base real y modo separado de prueba. No se publicó el Dashboard ni se mezcló la tienda.

El Dashboard de Floot recibió un pedido de prueba por su endpoint de editor. La base PostgreSQL real devolvió una sola fila con total $579, inicialmente pendiente de pago. En un segundo paso se probó el flujo de estados hasta Entregado con una guía de prueba. La URL de Netlify protegida y la interfaz del administrador requieren aún la comprobación en sesión. Faltan los datos bancarios oficiales y el costo local aprobado.

## Ventas integrales

La rama vigente es `feat/tarsi-ventas-integrales`, basada en el PR #5. Storefront y Dashboard público continúan en versiones anteriores. Los tres nuevos componentes de persistencia se agregaron de forma aditiva en la base existente y el código se cargó solo en el editor Floot. La prueba integral de API registra y confirma pedidos de prueba; el envío real de correo está bloqueado por la conexión Resend.
