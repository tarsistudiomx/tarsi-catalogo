# Integración con el Dashboard

Floot, proyecto **Tarsi — Control de Ventas** (66f62c32-15c0-4546-ba6e-bce0efe72d71). Su Dashboard publicado está en https://tarsi-control-ventas.floot.app. Antes del cambio guardaba pedidos manuales, tareas y métricas en el JSON `tarsi_state`, por usuario, con autenticación por sesión.

La migración aditiva `floot/migration.sql` crea `tarsi_web_orders` y `tarsi_web_order_history`. La restricción única es `(is_test,idempotency_key)`. Las transacciones guardan el pedido y el primer evento juntos; un reintento devuelve el mismo número público y los mismos importes. Un digest distinto con la misma clave devuelve 409. El contrato completo está en `floot/endpoints/tarsi_web_order_POST.schema.ts`. El endpoint es `POST /_api/tarsi_web_order` con JSON, Bearer y acción `lookup` o `create`. El token se guarda en Netlify y solo su SHA-256 en Floot. El fingerprint de preview identifica pedidos de prueba. El de producción se configura por separado antes de publicar.

`POST /_api/tarsi_web_admin`, sesión Floot con rol admin y mismo origen, lista y cambia pedidos con estado esperado. Confirmar pago fija `paid_at`; los reportes excluyen pruebas y pedidos sin `paid_at`. Enviar requiere guía. El historial conserva fecha y responsable. Las referencias de Skydropx quedan en PostgreSQL; no salen en el recibo ni en las acciones al cliente.
