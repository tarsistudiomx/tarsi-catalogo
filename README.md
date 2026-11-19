# Catálogo TARSI

Netlify sirve la tienda TARSI y las funciones de dirección, cotización y registro. GitHub Pages también puede consultar las funciones públicas de Netlify. El servidor valida y registra pedidos en el Dashboard de Floot antes de mostrar una confirmación. La versión en la rama de desarrollo requiere la configuración descrita en el handoff.

El cotizador solicita únicamente FedEx, Estafeta, Paquetexpress y DHL a Skydropx PRO. El carrito muestra la paquetería y el servicio de la tarifa elegida. La referencia de cotización se conserva internamente y el cliente recibe el número público de TARSI.

## Pruebas

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Para probar con Chromium instalado localmente, define `TARSI_CHROMIUM` con su ruta. Las pruebas de integración y navegador simulan Skydropx. Para verificar el catálogo oficial, ejecuta `TARSI_TEST_POSTAL_FILE=/ruta/privada/CPdescarga.txt npm test`.

## Configuración del envío

1. Configura las variables de [.env.example](.env.example) en el alcance **Functions** de Netlify. Verifica el código postal, la colonia y las medidas del embalaje de origen. Las medidas conservan la fórmula original de 30 × 25 × (4 cm por pieza), con 350 g por playera.
2. Descarga el ZIP nacional TXT del [Catálogo Nacional de Códigos Postales de Correos de México](https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx) y extrae `CPdescarga.txt` fuera de Git. El importador guarda el catálogo en Netlify Blobs privado y la tienda devuelve los datos del C.P. solicitado.
3. Con `NETLIFY_SITE_ID` y `NETLIFY_AUTH_TOKEN` en una sesión autorizada, ejecuta `npm run postal:import -- /ruta/privada/CPdescarga.txt`. El script valida 32 entidades, versiona por SHA-256 y activa la versión después de completar la importación.
4. Las funciones públicas de cotización y consulta postal deben aceptar las solicitudes del origen `https://tarsistudiomx.github.io`. Verifica que las cotizaciones reales se obtengan antes de anunciar el cambio. Compara ejemplos de una y cuatro prendas con el [total de Skydropx PRO](https://api-pro.skydropx.com/es-MX/api-docs/legacy). El costo al cliente suma el mayor entre $30 y 20% de la tarifa y redondea hacia arriba a un múltiplo de $10.

## Continuidad del proyecto TARSI

- [Estado actual](docs/handoff/01-ESTADO-ACTUAL.md)
- [Arquitectura](docs/handoff/02-ARQUITECTURA.md)
- [Cambios](docs/handoff/03-CAMBIOS-TIENDA.md)
- [Integración con el Dashboard](docs/handoff/04-CAMBIOS-DASHBOARD.md)
- [Integraciones](docs/handoff/05-INTEGRACIONES.md)
- [Pruebas](docs/handoff/06-PRUEBAS.md)
- [Despliegue](docs/handoff/07-DESPLIEGUE.md)
- [Pendientes](docs/handoff/08-PENDIENTES.md)
- [Contexto para ChatGPT](docs/handoff/09-CONTEXTO-PARA-CHATGPT.md)
