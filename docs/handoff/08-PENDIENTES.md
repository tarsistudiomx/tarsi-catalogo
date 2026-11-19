# Pendientes de ventas integrales

La modalidad local en Querétaro cobra solo las prendas; TARSI cotiza el delivery y contacta al cliente cuando esté listo. El remitente para producción es Gmail por OAuth de Floot. El administrador debe autorizar tarsi.studiomx@gmail.com desde Pedidos → Conectar Gmail. Resend conserva su función de pruebas y se confirmó recepción en Gmail.

1. Conectar Resend con remitente verificado y buzón autorizado de prueba. Verificar aceptación, repetir con la misma clave y comprobar que solo hay una notificación aceptada. El destinatario operativo es tarsi.studiomx@gmail.com.
2. Confirmar tarifa de entrega en Querétaro. Una vez configurada, validar el importe antes de ordenar y comprobar salida y entrega local sin guía.
3. Recorrer tienda y Dashboard con sesiones autorizadas. Probar Safari físico y la secuencia de despacho/entrega nacional de la revisión actual.
4. Implementar gestión administrativa de devoluciones y ajustes parciales/superiores con eventos de auditoría y métricas netas, y ampliar paginación de pedidos y actividades. Para pagos parciales o superiores actualmente se bloquea la confirmación y se requiere resolución manual. Los cambios de talla requieren intervención de TARSI; no se reescribe el importe aceptado.
5. Verificar que Netlify aplica el límite de solicitudes de checkout, y validar idempotencia entre pestañas en Safari físico. El navegador usa Web Locks cuando están disponibles y PostgreSQL deduplica las solicitudes que comparten clave.
6. Presentar el resultado completo para aprobación y aplicar el procedimiento coordinado de publicación. La huella productiva todavía está vacía.

Actualización: ya se verificaron Gmail, la tarifa local diferida, despacho y entrega por API, y las devoluciones y cobros adicionales. La vista de Pedidos fue aprobada. Falta validar el recorrido desde la URL protegida en un navegador con sesión de Netlify y autorizar explícitamente la publicación. Los pendientes históricos de arriba deben leerse con esta actualización.

Ruta sin costo para producción preparada en el PR #6 y en el borrador de Floot. Antes de activarla, recibir autorización explícita y seguir «Ruta de producción sin costo» de [despliegue](07-DESPLIEGUE.md). La URL privada de Netlify aún requiere sesión de navegador para validar allí; la verificación automatizada del storefront local con el backend real Floot se ejecutó por separado.
