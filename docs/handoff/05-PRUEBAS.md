# Pruebas

- Automatizadas: `TARSI_TEST_POSTAL_FILE=/tmp/tarsi-sepomex.txt npm test`. `TARSI_CHROMIUM=/usr/bin/chromium npm run test:browser`. El servidor de prueba local necesita permiso para escuchar en loopback.
- Floot: typecheck limpio en la página, el componente y los dos endpoints tras escribirlos en el editor.
- Verificación remota y dispositivos físicos: documentar resultados aquí antes de solicitar publicación.

- 13/13 pruebas automatizadas con el TXT real de SEPOMEX (31 862 códigos postales).
- 3/3 escenarios Chromium, incluidos carrito móvil, correo Gmail Web con parámetros correctos, doble clic, fallo de red, misma clave en reintento, conservación del carrito, confirmación, portapapeles y enlace de Instagram. Las respuestas del Dashboard y datos bancarios en esas pruebas son fixtures locales.
- GitHub y Netlify confirmaron la Deploy Preview del PR #5. La URL retorna 401 a un cliente HTTP sin sesión de Netlify. No se cambió la protección.
- En Floot se probó el endpoint borrador remoto: 403 sin token, 200 con credencial de prueba. La primera prueba integrada detectó transformación de claves por CamelCasePlugin y serialización doble de JSONB. Se corrigió el adaptador, se reparó exclusivamente esa fila de prueba y se agregó una restricción JSONB de tipo objeto.
