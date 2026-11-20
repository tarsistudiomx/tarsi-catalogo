# Solicitudes de compra, reservas y transferencias

Rama `feat/tarsi-reservas-y-pagos`, base `66db94c`. Actualización del 19 de noviembre de 2026. Este documento prevalece sobre instrucciones de publicación de entregas anteriores. El cambio requiere aprobación explícita para producción.

## Auditoría y alcance

- Netlify conserva cálculo de SEPOMEX, cotización de Skydropx, menú, catálogo y promociones. Floot ya persistía pedidos, verificaba pagos de manera manual y compartía la cola de producción con Mis actividades. La entrega en Querétaro conserva el costo local por cotizar con el cliente el día de la entrega.
- El 20 de noviembre se creó la rama de Floot **TARSI v2 — pruebas**, con ID `87615c19-5c95-461f-b331-944107b3c509`. Partió del esquema con tablas vacías. Se aplicó la migración y se sembraron inventario y datos bancarios ficticios. La rama principal y producción de Netlify conservan sus versiones anteriores.
- [PR borrador #7](https://github.com/tarsistudiomx/tarsi-catalogo/pull/7) y [Deploy Preview](https://deploy-preview-7--tarsi-skydropx.netlify.app/). La URL de Netlify requiere iniciar sesión. Una solicitud anónima obtuvo HTTP 401. El registro se examinó con un navegador local que ejecuta el mismo proxy y consulta el Blob privado y el backend reales.

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

- Netlify, únicamente para el Deploy Preview #7, usa el Blob privado `tarsi-preview-integration` (campos `origin` y `key`) en el store de cada deploy, región `us-east-1`. Cada rebuild crea un deploy nuevo y requiere cargar ese Blob de nuevo. El plan gratuito rechazó el alcance Functions exclusivo para una variable marcada como secreta. El ámbito por deploy evita inyectar la clave en producción. Si el plan permite variables seguras del servidor, siguen disponibles `TARSI_FLOOT_PREVIEW_ORIGIN` y `TARSI_PREVIEW_STOREFRONT_KEY`.
- Rama Floot: `JWT_SECRET` de Floot. La fila de `tarsi_preview_integration` guarda solo las huellas SHA-256 de los encabezados de autorización y la URL del PR. El correo de la rama aislada se captura en la bandeja de prueba de Floot. El Gmail de producción permanece separado y depende del OAuth de `tarsi.studiomx@gmail.com` con permiso de envío.
- Para producción, configurar dos credenciales distintas, separadas de las de prueba. Floot admite las huellas SHA-256 del valor completo de cada cabecera Bearer en `tarsi_live_integration`. Netlify admite la variable segura `TARSI_STOREFRONT_KEY` o el Blob `tarsi-live-integration` con el campo `key`, en la región `us-east-1` y restringido a ese deploy. GitHub Actions requiere el secreto `TARSI_MAIL_WORKER_KEY`. Habilitar la variable del repositorio `TARSI_MAIL_SCHEDULER_ENABLED=true` solo después de validar el endpoint publicado. GitHub ejecuta programas en la rama predeterminada. La acción del repositorio se entrega desactivada por defecto. No compartir las claves en el chat.
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
npx playwright install webkit
TARSI_BROWSER=webkit npm run test:browser
```

- 20 pruebas de Node aprobadas en el comando completo con concurrencia, con 31,862 códigos postales del TXT oficial. Incluyen ejecución de la migración dos veces en PGlite, PostgreSQL aislado, con los handlers de Floot transpilados. Incluyen XS histórico, rechazo de XS nuevo, folio corto, mismo intento dos veces, stock por talla compartido entre diseños, falta de inventario, prueba de importes manipulados y cotización nacional, recuperación a las 12 horas simuladas, renovación, reporte tardío, rechazo de referencia repetida, autorización del proxy, permiso administrativo, confirmación y cálculo de métricas. Gmail, credencial administrativa y respuestas logísticas externas fueron sustituidos por fixtures. Además, una prueba en PostgreSQL 18 con conexiones independientes confirmó que dos diseños compitiendo por la última prenda obtienen una sola reserva y que una doble asignación no descuenta el stock dos veces. Aún se requiere comprobarlo en el sandbox de Floot.
- Cuatro pruebas aprobadas en Chromium y las mismas cuatro en WebKit de Playwright, en escritorio y viewport móvil. El entorno Linux de WebKit requirió librerías Debian en una carpeta temporal. Incluyen doble clic, respuesta perdida, reintento, enlace en un contexto nuevo, reportar, renovar, modal y copia. La prueba optativa `TARSI_TEST_FLOOT_V2=1` pasó en Chromium con la base real de la rama aislada a través del proxy Netlify ejecutado localmente. `TARSI_TEST_NETLIFY_BLOBS_CONTEXT_FILE` permite leer la configuración de un deploy real desde un archivo privado externo al repositorio. Safari en dispositivo físico, entrega real de correos y la programación de producción siguen pendientes.
- TypeScript estricto del backend y los componentes modificados verificado localmente con stubs de Floot. Falta typecheck y revisión visual en la plataforma.

### Evidencia en la rama de Floot

- `TARSI-000001`, pedido local sintético de $399. Reintento y recuperación conservaron folio sin devolver datos personales. El reporte lo dejó listo para verificar. Un administrador sintético rechazó monto incorrecto (422) y doble confirmación (409). Sin sesión se rechazó la confirmación (403). El pago válido generó una sola actividad y un único movimiento de inventario. Ingresos reales en cero.
- `TARSI-000002`, envío nacional sintético a CP 01000. Skydropx devolvió $180 de envío y el pedido registró $579. Quedó pendiente de pago.
- `TARSI-000003`, pedido sintético desde Chromium, validó modal bancario y reporte contra el backend aislado. La bandeja test de Floot capturó registros, reportes y confirmación. La entrega externa por Gmail queda para el entorno autorizado. Se sustituyó la comparación de timestamps del worker por identificadores UUID de toma de trabajo, porque Floot había dejado notificaciones de prueba sin procesar.

## Continuar, aprobar y revertir

1. Para recrear este entorno, crear una rama de `Tarsi — Control de Ventas` con copia **solo del esquema**, sin datos de clientes. En esa rama cargar el diff de `floot/`. Ejecutar `floot/order-flow-v2.sql` en su base aislada. Si se usa `floot_execute_sql`, omitir el envoltorio `BEGIN/COMMIT` del archivo porque dicha herramienta ya abre una transacción. Configurar el endpoint, el destinatario de prueba y su Blob privado descritos arriba. Usar datos bancarios ficticios claramente identificados para ese sandbox y no hacer transferencias.
2. Vincular solo el Deploy Preview de este PR, cargar stock ficticio en su modo de prueba, ejecutar el typecheck nativo y probar un pedido nacional Skydropx y uno local desde la vista previa. Confirmar que aparecen en sus bandejas. Simular una transferencia desde el enlace, verificar el depósito ficticio desde el Dashboard y comprobar inventario, Mis actividades, producción, métricas aisladas y los tres correos al buzón de pruebas. Dejar pendiente otro pedido 20 minutos, esperar el worker y verificar exactamente un recordatorio. Probar dos clientes con conexiones independientes contra la última prenda y validar Safari de iPhone o iPad.
3. Registrar resultados en este documento y presentar el enlace funcional y el commit para aprobación. Probar el límite de pedidos por IP, la cuota diaria y paginación de pedidos bajo la carga prevista. El listado actual devuelve hasta 100 coincidencias y admite búsquedas por folio. Probar revocación y reemisión desde el Dashboard. Definir si se requieren cambios de precio o talla autoservicio antes del lanzamiento.
4. Con autorización explícita, respaldar la base y verificar diferencias con el código actual de Floot. Aplicar primero la migración aditiva y publicar Floot con ambos endpoints compatibles. Configurar el inventario real y validar el worker. Antes de fusionar para un deploy que use Blob privado, pausar la publicación automática de Netlify, preparar el candidato y verificar su configuración y credenciales. Publicar Netlify solo después de que el endpoint v2 esté disponible y preparado. Verificar la tienda pública y vigilar métricas y correos.
5. Si falla, restaurar el deploy anterior de Netlify, pausar el worker en GitHub y mantener la migración aditiva y sus filas. Los pedidos v2 ya creados y los reportes necesitan seguir accesibles para conciliación; conservar endpoints v2 o gestionar esos folios con el equipo durante la reversión. No eliminar tablas, reiniciar la secuencia ni restaurar una copia que sobreescriba pedidos nuevos.

## Revisión del comprobante y bandeja de pagos

El pedido sintético `TARSI-000006` figura como `Pago por verificar` en la rama de Floot. El reporte del cliente se había guardado con éxito. Se cambió la vista previa del Dashboard para abrir en **Pagos por verificar** y cargar pedidos de prueba al abrir su dominio sandbox. El folio es visible en cada fila y la búsqueda de una coincidencia abre su detalle en la bandeja correspondiente. El Dashboard actualiza los pedidos cuando la ventana recupera el foco o el administrador pulsa Actualizar.

En el checkout, el paso **Envía tu comprobante** aparece arriba del resumen después de reportar la transferencia. Instagram y correo son alternativas. Correo copia `tarsi.studiomx@gmail.com` y da el asunto `Comprobante de pago · TARSI-000006` como ejemplo de folio. El cliente adjunta su captura. El reporte va a verificación y la confirmación en Nu sigue siendo exclusiva del administrador.

### Regreso después de la transferencia

El encabezado de la tienda muestra **Continuar mi pedido** cuando hay un pedido recuperable guardado en ese navegador. El modal permite copiar un enlace privado para volver desde otro dispositivo. Safari conserva el pedido guardado mientras conserve sus datos del sitio. Si se borra ese almacenamiento, se necesita el enlace. La reserva vence según su fecha original y un reporte tardío sigue siendo posible.

En vista previa, los correos quedan en la bandeja de pruebas de Floot. Se verificó ahí el correo de registro de `TARSI-000009`. La prueba de entrega a Gmail requiere el transporte de producción en un entorno autorizado.

### Verificación de Gmail y preparación de producción

Gmail aceptó por su API un correo con asunto `[PRUEBA TARSI] Verificacion de Gmail` enviado desde y hacia el buzón operativo del negocio. La validación se hizo en la vista previa del proyecto principal con su conexión Gmail existente y el endpoint temporal fue retirado. El resultado verificable es aceptación del proveedor. La activación en línea queda condicionada al conteo real de S, M, L, XL y XXL y a la comprobación de la publicación coordinada.
