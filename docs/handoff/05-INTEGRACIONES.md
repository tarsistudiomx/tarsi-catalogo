# Integraciones

- Netlify → Floot por HTTPS mediante `TARSI_DASHBOARD_URL` y `TARSI_DASHBOARD_TOKEN`. Una huella SHA-256 de preview permite crear solo pedidos de prueba. La integración pública se habilita tras aprobar y publicar Floot antes de la tienda.
- Skydropx conserva origen 76099, 0.35 kg por playera, FedEx/Estafeta/Paquetexpress/DHL y margen del mayor de $30 o 20%, redondeado al siguiente múltiplo de $10. Netlify sella destino, cantidad y precio en un token cifrado de corta duración.
- Floot → Resend con `TARSI_RESEND_API_KEY` de envío, `TARSI_RESEND_FROM` verificado y `TARSI_RESEND_TEST_TO` para pruebas. El destinatario real es `tarsi.studiomx@gmail.com`. La conexión requiere intervención segura del dueño. El endpoint conserva el pedido si falta configuración o falla el proveedor.
- PostgreSQL conserva un registro único de notificación y Resend recibe una clave de idempotencia por pedido. Después de 23 horas sin confirmación se requiere revisión manual para evitar reenviar una notificación cuya aceptación fue incierta.

## Alternativa sin costo para la vista previa #6

El handler de Netlify envía cotización y pedido al sandbox Floot solo para el hostname del PR #6. Floot valida el domicilio contra SEPOMEX, obtiene la tarifa real de Skydropx mediante el servicio existente, sella la tarifa con una clave derivada y guarda exclusivamente pedidos marcados `is_test=true`. El encabezado del proxy identifica el flujo y no es un secreto. Los límites del sandbox son diarios y separados para cotizaciones, nuevas órdenes y avisos. La tabla `tarsi_preview_checkout_config` conserva los datos de transferencia de prueba sin incluir sus valores en Git. El backend productivo sigue pendiente de un mecanismo de despliegue autorizado que conserve costo cero.

Producción preparada y desactivada. El endpoint de Floot productivo es un formulario de compra público cuando se activa. El encabezado del proxy no autentica y no autoriza operaciones administrativas. Floot usa límites diarios separados para cotizaciones, pedidos nuevos y avisos; el proxy de Netlify también declara límites por IP. La recuperación requiere la UUID aleatoria del carrito y devuelve importe e instrucciones sin datos de contacto. La cotización se firma con una clave derivada distinta de la de vista previa. Los datos de pago productivos no se agregan hasta recibir autorización.
