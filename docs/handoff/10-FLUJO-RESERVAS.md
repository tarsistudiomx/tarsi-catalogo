# Solicitudes de compra, reservas y transferencias

Rama `feat/tarsi-reservas-y-pagos`, base `66db94c`. Actualización del 19 de noviembre de 2026. Este documento prevalece sobre instrucciones de publicación de entregas anteriores. El cambio requiere aprobación explícita para producción.

## Auditoría y alcance

- Netlify conserva cálculo de SEPOMEX, cotización de Skydropx, menú, catálogo y promociones. Floot ya persistía pedidos, verificaba pagos de manera manual y compartía la cola de producción con Mis actividades. La entrega en Querétaro conserva el costo local por cotizar con el cliente el día de la entrega.
- Floot reportó activa la versión `17950721601277f031b9d-67f4-439a-8597-973f5da3aa45`. Su cuenta gratuita alcanzó el límite de acciones. Se comprobó el bloqueo en una lectura de código el 19 a las 21:40 UTC. Reinicio de cuota: 20 de noviembre a las 06:00 UTC. Quedaron pendientes la preparación de la rama de Floot y las pruebas en su entorno real.
- El código compartido, la migración y las pruebas están en la rama Git. Producción de Netlify y Floot permanece en su versión anterior. El avance se puede revisar en el [PR borrador #7](https://github.com/tarsistudiomx/tarsi-catalogo/pull/7) y su [Deploy Preview](https://deploy-preview-7--tarsi-skydropx.netlify.app/). Netlify protege la URL con inicio de sesión. La vista previa de la tienda requiere vincular el backend de prueba antes de poder comprar.

## Archivos y modelo

| Área | Archivos | Comportamiento |
|---|---|---|
| Checkout | `shop.js`, `checkout.js`, `index.html`, `netlify/functions/submit-order.js`, `netlify/lib/floot-checkout.js` | Quita XS de compras nuevas y conserva S, M, L, XL y XXL. Correo del cliente requerido. Enlace, recibo, copias, reserva y formulario de transferencia. |
| Floot público | `floot/helpers/storefrontCheckout.tsx`, `persistWebOrder.tsx`, `orderFlow.tsx`, endpoints `tarsi_*_checkout_v2_POST*` | Registro en una transacción, importe y cotización comprobados, reporte y recuperación. Endpoints anteriores conservados durante el cambio coordinado. |
| Floot administrativo | `floot/endpoints/tarsi_web_admin_POST*`, `tarsi_inventory_POST*`, `floot/components/WebOrders.tsx`, `TarsiInventory.tsx`, `floot/pages/_index.tsx` | Cuatro bandejas, búsqueda y filtros, discrepancias, verificación manual, producción, inventario, trazabilidad. |
| Datos | `floot/order-flow-v2.sql` | Migración aditiva. Agrega secuencia, metadatos de recuperación y reserva, stock y movimientos, reportes y bandeja de correo. Mantiene IDs internos y pedidos existentes. |
| Correo | `floot/helpers/orderFlowMail.tsx`, `floot/endpoints/tarsi_mail_worker_POST*`, `.github/workflows/tarsi-order-mail.yml` | Bandeja persistente para registro, recordatorio, aviso de reporte y confirmación. OAuth Gmail existente. |

Los folios v2 usan una secuencia de PostgreSQL y la restricción única del número completo. Se admiten saltos, incluidos reintentos y transacciones fallidas. Los folios largos y tallas XS históricos conservan sus valores. El registro, reserva y encolado inicial se confirman juntos. La reserva agrega cantidades por talla entre todos los diseños. Vence por tiempo, por lo que una consulta nueva libera disponibilidad sin esperar una tarea programada. Hay hasta dos renovaciones. Si Skydropx cambia el precio o servicio, la renovación pide revisión con el mismo folio. Cuando falta una talla, indica las tallas con existencias y TARSI debe acordar el cambio; el cliente todavía no puede elegir y recalcular un reemplazo dentro de ese pedido.

## Estados y recuperación

- **Sin reporte de pago**. Pedido guardado. Sin ingresos ni tareas. Muestra la transferencia mientras la reserva sea válida.
- **Pago reportado · Por verificar**. Guarda banco, fecha, monto y referencia o datos de localización. Suspende el recordatorio. La referencia normalizada se coteja por entorno. Un reporte tardío no convierte el pedido en venta ni extiende la reserva.
- **Pago verificado**. Un administrador confirma el monto exacto y la referencia después de comprobar el depósito en Nu. Pago, asignación definitiva, cola de preparación e historial se guardan juntos. Si falta stock, se abre una discrepancia y el pedido no pasa a producción. Preparación estimada de 3 a 5 días hábiles desde la verificación. Los estados de producción y envío conservan sus transiciones.
- **Historial y excepciones**. Reservas vencidas, cancelaciones, discrepancias y ajustes. Los pagos de pedidos cancelados se investigan desde la bandeja; no reabren ni confirman la venta automáticamente. Los abandonos no cuentan como ingresos.

El enlace usa un identificador UUID v4 aleatorio en el fragmento de la URL con expiración de 30 días y revocación desde el Dashboard. La respuesta omite nombre, teléfono y dirección. La web limpia el fragmento al abrirlo. El folio no permite recuperar el pedido. Si el enlace vence o fue revocado, TARSI puede verificar la solicitud y reemitirlo desde el Dashboard al correo original. La reemisión invalida el enlace anterior y conserva el mismo folio.

## Correo y operación

El alta encola el correo inicial y un recordatorio con vencimiento de 20 minutos. El procesador revisa el estado al enviar y suprime recordatorios de pedidos reportados, verificados, cancelados o revocados. El worker de GitHub Actions revisa aproximadamente cada cinco minutos y el servicio puede iniciar tarde; el recordatorio no se garantiza en el segundo exacto. Una recuperación tras una caída no depende de que el navegador quede abierto. La confirmación encola su propio correo y también intenta el envío inmediato. El outbox registra aceptación de Gmail, reintentos de fallos identificables y revisión si el resultado fue incierto. Para un resultado incierto, buscar el `Message-ID` en Enviados antes de decidir un reintento. Aceptación de Gmail no acredita entrega al destinatario.

- Netlify, únicamente en Deploy Previews de esta rama: `TARSI_FLOOT_PREVIEW_ORIGIN`, origen HTTPS del sandbox de la rama Floot. Configurar también `TARSI_PREVIEW_STOREFRONT_KEY` en el alcance Functions y con el mismo valor en la rama de Floot. El proxy permanece cerrado hasta configurar el origen y esa clave.
- Rama Floot: `JWT_SECRET` de Floot, `TARSI_TEST_STOREFRONT_URL` con la Deploy Preview de este PR, `TARSI_TEST_MAIL_WORKER_KEY` para probar envío diferido. OAuth de `tarsi.studiomx@gmail.com` con permiso de envío. En modo de prueba los correos se dirigen al buzón operativo.
- Después de aprobar, configurar `TARSI_STOREFRONT_KEY` en producción Netlify y Floot con el mismo valor y distinto a pruebas. Floot y GitHub Actions necesitan `TARSI_MAIL_WORKER_KEY` con el mismo valor. Habilitar la variable del repositorio `TARSI_MAIL_SCHEDULER_ENABLED=true` solo después de validar el endpoint publicado. GitHub ejecuta programas en la rama predeterminada. La acción del repositorio se entrega desactivada por defecto. No compartir las claves en el chat.
- Capturar conteos de blanks para **S, M, L, XL y XXL** desde Inventario. Permite cero. Los avisos de stock bajo y fechas de reposición dependen de esa captura. La venta v2 queda bloqueada antes de guardar y mostrar banco mientras este inventario esté sin activar. No hay existencias ni fechas reales sembradas por la migración.

## Pruebas y evidencia

Ambiente aislado:

```sh
npm ci
lab="$(mktemp -d)"
npm install --prefix "$lab" --no-audit --no-fund @electric-sql/pglite kysely zod typescript@5.9.3
TARSI_FLOOT_TEST_MODULES="$lab/node_modules" TARSI_TEST_POSTAL_FILE=/ruta/CPdescarga.txt npm test
npm install --prefix "$lab" --no-audit --no-fund embedded-postgres pg
TARSI_FLOOT_TEST_MODULES="$lab/node_modules" TARSI_FLOOT_TEST_CONCURRENCY=1 node --test --experimental-test-isolation=none --test-name-pattern='concurrent connections' tests/floot-order-flow.test.js
TARSI_CHROMIUM=/usr/bin/chromium npm run test:browser
```

- 19 pruebas de Node aprobadas, con 31,862 códigos postales del TXT oficial. Incluyen ejecución de la migración dos veces en PGlite, PostgreSQL aislado, con los handlers de Floot transpilados. Incluyen XS histórico, rechazo de XS nuevo, folio corto, mismo intento dos veces, stock por talla compartido entre diseños, falta de inventario, prueba de importes manipulados y cotización nacional, recuperación a las 12 horas simuladas, renovación, reporte tardío, rechazo de referencia repetida, autorización del proxy, permiso administrativo, confirmación y cálculo de métricas. Gmail, credencial administrativa y respuestas logísticas externas fueron sustituidos por fixtures. Además, una prueba en PostgreSQL 18 con conexiones independientes confirmó que dos diseños compitiendo por la última prenda obtienen una sola reserva y que una doble asignación no descuenta el stock dos veces. Aún se requiere comprobarlo en el sandbox de Floot.
- Cuatro pruebas Chromium aprobadas con navegador real en escritorio y viewport móvil. Incluyen doble clic, respuesta perdida, reintento, enlace en un contexto nuevo, reportar, renovar, modal y copia. La prueba remota de integración quedó omitida. Safari en dispositivo físico, OAuth real del sandbox, Skydropx real, entrega real y disparo programado durante 20 minutos siguen pendientes.
- TypeScript estricto del backend verificado localmente con stubs tipados de Floot. Falta typecheck y revisión visual de los componentes en dicha plataforma.

## Continuar, aprobar y revertir

1. Al regresar la cuota de Floot, crear una rama de `Tarsi — Control de Ventas` con copia **solo del esquema**, sin datos de clientes. En esa rama cargar el diff de `floot/`. Ejecutar `floot/order-flow-v2.sql` en su base aislada. Si se usa `floot_execute_sql`, omitir el envoltorio `BEGIN/COMMIT` del archivo porque dicha herramienta ya abre una transacción. Configurar destinatario, OAuth, endpoint y URL de prueba descritos arriba. Usar datos bancarios ficticios claramente identificados para ese sandbox y no hacer transferencias.
2. Vincular solo el Deploy Preview de este PR, cargar stock ficticio en su modo de prueba, ejecutar el typecheck nativo y probar un pedido nacional Skydropx y uno local desde la vista previa. Confirmar que aparecen en sus bandejas. Simular una transferencia desde el enlace, verificar el depósito ficticio desde el Dashboard y comprobar inventario, Mis actividades, producción, métricas aisladas y los tres correos al buzón de pruebas. Dejar pendiente otro pedido 20 minutos, esperar el worker y verificar exactamente un recordatorio. Probar dos clientes con conexiones independientes contra la última prenda y validar Safari de iPhone o iPad.
3. Registrar resultados en este documento y presentar el enlace funcional y el commit para aprobación. Probar el límite de pedidos por IP, la cuota diaria y paginación de pedidos bajo la carga prevista. El listado actual devuelve hasta 100 coincidencias y admite búsquedas por folio. Probar revocación y reemisión desde el Dashboard. Definir si se requieren cambios de precio o talla autoservicio antes del lanzamiento.
4. Con autorización explícita, respaldar la base y verificar diferencias con el código actual de Floot. Aplicar primero la migración aditiva y publicar Floot con ambos endpoints compatibles. Configurar el inventario real y validar el worker. Aprobar el cambio de Netlify solo después de que el endpoint v2 esté disponible; observar métricas y correos.
5. Si falla, restaurar el deploy anterior de Netlify, pausar el worker en GitHub y mantener la migración aditiva y sus filas. Los pedidos v2 ya creados y los reportes necesitan seguir accesibles para conciliación; conservar endpoints v2 o gestionar esos folios con el equipo durante la reversión. No eliminar tablas, reiniciar la secuencia ni restaurar una copia que sobreescriba pedidos nuevos.
