# Integraciones

- Netlify → Floot por HTTPS mediante `TARSI_DASHBOARD_URL` y `TARSI_DASHBOARD_TOKEN`. Una huella SHA-256 de preview permite crear solo pedidos de prueba. La integración pública se habilita tras aprobar y publicar Floot antes de la tienda.
- Skydropx conserva origen 76099, 0.35 kg por playera, FedEx/Estafeta/Paquetexpress/DHL y margen del mayor de $30 o 20%, redondeado al siguiente múltiplo de $10. Netlify sella destino, cantidad y precio en un token cifrado de corta duración.
- Floot → Resend con `TARSI_RESEND_API_KEY` de envío, `TARSI_RESEND_FROM` verificado y `TARSI_RESEND_TEST_TO` para pruebas. El destinatario real es `tarsi.studiomx@gmail.com`. La conexión requiere intervención segura del dueño. El endpoint conserva el pedido si falta configuración o falla el proveedor.
- PostgreSQL conserva un registro único de notificación y Resend recibe una clave de idempotencia por pedido. Después de 23 horas sin confirmación se requiere revisión manual para evitar reenviar una notificación cuya aceptación fue incierta.
