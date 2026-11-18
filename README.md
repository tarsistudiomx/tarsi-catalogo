# Catálogo TARSI

GitHub Pages aloja el catálogo público. La tienda consulta las funciones de Netlify para completar la dirección y cotizar el envío. Los pedidos siguen las opciones manuales del carrito. El cliente ve el subtotal promocional, el envío y el total después de cotizar.

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
