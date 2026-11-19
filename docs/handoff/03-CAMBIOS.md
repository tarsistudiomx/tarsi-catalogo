# Cambios

Base de trabajo `8b0da23` (actualización fotográfica del PR #4). La rama de checkout incorpora tres acciones, confirmación tras persistencia, transferencia configurable, resumen para compartir y un borrador Gmail Web. La función de cotización añade una prueba opaca AES-256-GCM y conserva el motor y los filtros en `netlify/lib/skydropx.js`.

La carpeta `floot/` conserva el SQL y las fuentes de los endpoints, el componente y el control de acceso. El editor Floot contiene también el montaje en `pages/_index.tsx` para el rol admin en Pedidos y la suma de cobros web reales a las estadísticas. Los identificadores exactos de los commits se obtienen con `git log --oneline 8b0da23..HEAD`.

`2915dae` introdujo el checkout y las fuentes Floot. El siguiente commit corrige el intercambio JSON y añade las verificaciones de reintento y regresión. Para recuperar el montaje del Dashboard desde cero, importar `WebOrders` en `pages/_index.tsx`, añadir el callback estable para métricas, montar el componente para admin y mostrarlo en la pestaña Pedidos, y sumar las cifras web al indicador existente de pedidos pagados.
