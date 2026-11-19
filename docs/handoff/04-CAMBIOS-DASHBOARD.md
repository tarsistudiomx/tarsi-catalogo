# Integración con el Dashboard

Floot, proyecto **Tarsi — Control de Ventas** (66f62c32-15c0-4546-ba6e-bce0efe72d71). Su Dashboard publicado está en https://tarsi-control-ventas.floot.app. Antes del cambio guardaba pedidos manuales, tareas y métricas en el JSON `tarsi_state`, por usuario, con autenticación por sesión.

La migración aditiva `floot/migration.sql` crea `tarsi_web_orders` y `tarsi_web_order_history`. La restricción única es `(is_test,idempotency_key)`. Las transacciones guardan el pedido y el primer evento juntos; un reintento devuelve el mismo número público y los mismos importes. Un digest distinto con la misma clave devuelve 409. El contrato completo está en `floot/endpoints/tarsi_web_order_POST.schema.ts`. El endpoint es `POST /_api/tarsi_web_order` con JSON, Bearer y acción `lookup` o `create`. El token se guarda en Netlify y solo su SHA-256 en Floot. El fingerprint de preview identifica pedidos de prueba. El de producción se configura por separado antes de publicar.

`POST /_api/tarsi_web_admin`, sesión Floot con rol admin y mismo origen, lista y cambia pedidos con estado esperado. Confirmar pago fija `paid_at`; los reportes excluyen pruebas y pedidos sin `paid_at`. Enviar requiere guía. El historial conserva fecha y responsable. Las referencias de Skydropx quedan en PostgreSQL; no salen en el recibo ni en las acciones al cliente.

## Ventas integrales

`floot/sales-migration.sql` añade `tarsi_verified_payments`, `tarsi_production_work` y `tarsi_order_notifications` a la base existente. `confirm-payment` exige sesión admin, importe exacto en centavos, referencia y verificación. Una transacción con bloqueo de fila registra pago, estado, historial y trabajo. La referencia normalizada es única por entorno de prueba/real. Pedidos por hacer y Mis actividades proyectan el mismo trabajo enlazado al pedido.

La sección Pedidos registrados usa filas expandibles por cliente y filtros Pendientes de pago y Pagados. Los cancelados y la conexión Gmail están en paneles plegables. Las actividades de producción siguen en Checklist y abren directamente el pedido correspondiente.

Los pedidos pagados incluyen un formulario plegable para registrar devoluciones y cobros adicionales ya confirmados en el banco. La tabla `tarsi_order_adjustments` guarda importe, motivo, referencia, fecha y responsable. Los ingresos web reflejan el neto; monto original e historial se conservan. La migración aditiva se aplicó en Floot.
