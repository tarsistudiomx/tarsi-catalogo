# Pruebas

La modalidad local en Querétaro cobra solo las prendas; TARSI cotiza el delivery y contacta al cliente cuando esté listo. El remitente para producción es Gmail por OAuth de Floot. El administrador debe autorizar tarsi.studiomx@gmail.com desde Pedidos → Conectar Gmail. Resend conserva su función de pruebas y se confirmó recepción en Gmail.

- Automatizadas: `TARSI_TEST_POSTAL_FILE=/tmp/tarsi-sepomex.txt npm test`. `TARSI_CHROMIUM=/usr/bin/chromium npm run test:browser`. El servidor de prueba local necesita permiso para escuchar en loopback.
- Floot: typecheck limpio en la página, el componente y los dos endpoints tras escribirlos en el editor.
- Verificación remota y dispositivos físicos: documentar resultados aquí antes de solicitar publicación.

- 13/13 pruebas automatizadas con el TXT real de SEPOMEX (31 862 códigos postales).
- 3/3 escenarios Chromium, incluidos carrito móvil, correo Gmail Web con parámetros correctos, doble clic, fallo de red, misma clave en reintento, conservación del carrito, confirmación, portapapeles y enlace de Instagram. Las respuestas del Dashboard y datos bancarios en esas pruebas son fixtures locales.
- GitHub y Netlify confirmaron la Deploy Preview del PR #5. La URL retorna 401 a un cliente HTTP sin sesión de Netlify. No se cambió la protección.
- En Floot se probó el endpoint borrador remoto: 403 sin token, 200 con credencial de prueba. La primera prueba integrada detectó transformación de claves por CamelCasePlugin y serialización doble de JSONB. Se corrigió el adaptador, se reparó exclusivamente esa fila de prueba y se agregó una restricción JSONB de tipo objeto.
- Verificación real con `node --use-env-proxy scripts/smoke-checkout.js`, credenciales de preview y fixture postal 01000. El handler de cotización local consultó la tarifa Skydropx real por el relay de producción; el handler de pedidos local llamó por HTTPS al sandbox Floot real. Pedido `TARSI-E81C761A1364458E876E0F5F20F8FEE3`: Paquetexpress, Nacional Sin Recolección, $399 de subtotal y $180 de envío, $579 total, Pendiente de pago al registrarse. Dos solicitudes concurrentes devolvieron el mismo número; el reintento sin cotización devolvió el mismo recibo y un cambio de talla con la misma clave devolvió 409. Consulta de PostgreSQL confirmó una copia, `is_test=true`, un evento inicial, una referencia privada y `paid_at=NULL`.
- En el editor de Floot se ejecutó el handler administrativo con el mecanismo real de sesiones y dos cuentas temporales de prueba. Rechazó sesión ausente, rol no admin y otro origen. El pedido anterior recorrió los seis estados, rechazó un salto directo, un estado esperado desactualizado y Enviado sin guía; con guía y usuario autorizado terminó Entregado. Se comprobaron las fechas, actores y la exclusión de la prueba de los ingresos. Se eliminaron el endpoint auxiliar, las cuentas y sus sesiones. La fila quedó claramente identificada como prueba.
- Pendiente: interfaz de Netlify autenticada hasta Floot, renderizado del Dashboard con administrador real, Gmail con sesión y Safari físico. No se enviaron correos, comprobantes, cobros ni guías reales.

Seguimiento: se comprobó que la página pública todavía sirve el checkout anterior y que la vista previa devuelve 401 a solicitudes sin sesión. El nuevo enlace vuelve a usar navegación nativa hacia Gmail Web. La prueba de Chromium captura esa navegación y verifica destinatario, asunto y contenido; no inicia sesión ni envía correo.

## Ventas integrales

- 14 pruebas Node con SEPOMEX oficial y 3 pruebas Chromium (móvil emulado y escritorio). Cubren total manipulado, recuperación sin PII, cotización, doble clic, red, modales, enlace de Instagram y fallo de correo con pedido conservado.
- Pedido real de prueba `TARSI-30475F2F61484CEF92034454F84C97A6`, $399 + $180 Paquetexpress = $579. Dos solicitudes concurrentes devolvieron el mismo recibo. Floot rechazó el pago sin sesión (403) y un monto distinto (422). Dos confirmaciones concurrentes dieron 200/409, una fila de pago y una actividad; inicio de preparación y preparado dieron 200. Fechas calculadas 2026-11-23 a 2026-11-25. Los ingresos reales no cambiaron. Se usó un endpoint temporal de sandbox, retirado después, y una identidad de auditoría de prueba revocada.
- Pendientes: navegador autenticado en Netlify y Dashboard, Safari físico, aceptación de Resend, tarifa local comercial, flujo completo de envío y entrega sobre esta versión.
