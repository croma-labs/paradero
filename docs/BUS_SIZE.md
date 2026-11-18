# Tamaño del bus por placa

Contribución para [#474](https://github.com/croma-labs/paradero/issues/474), relacionada con [#282](https://github.com/croma-labs/paradero/issues/282).

Las tarjetas de próximo bus y de llegadas muestran «Bus pequeño» o «Bus grande» cuando la placa coincide con el registro oficial de flota. Junto al tamaño se muestra el mes del registro: por ejemplo, «Bus grande · registro de dic de 2024». Los lectores de pantalla reciben la misma información, en los siete idiomas de la app.

El tamaño describe el vehículo registrado. No indica cuántas personas van dentro, si hay espacio para subir o cuándo empezará a operar un bus que todavía no está en ruta. Esos datos no están disponibles en esta contribución.

## Fuente y antigüedad

- Publicador: TRANSMILENIO S.A., en Datos Abiertos Bogotá.
- Conjunto: [Flota Vinculada del SITP](https://datosabiertos.bogota.gov.co/dataset/flota-vinculada-del-sitp).
- Recurso: [Flota vinculada del SITP, diciembre de 2024](https://datosabiertos.bogota.gov.co/dataset/7fb3cb57-761a-4f6b-8a25-99e6de9e1672/resource/0aa8c4ed-b26c-40ce-ac51-2b3fc425cd87/download/flota-vinculada-del-sitp-diciembre-2024.csv).
- Licencia de los datos: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). La licencia MIT del código se mantiene; este extracto de datos conserva su licencia y atribución.
- Se usan `matricula` (placa), `descripcion_tipo` (tipología) y el estado vinculado. El archivo derivado agrupa las placas por tipología, omite las demás columnas y conserva metadatos de procedencia y el SHA-256 del CSV original.

Al preparar esta contribución, el 17 de noviembre de 2026, el último CSV descargable localizado en ese conjunto era el de diciembre de 2024. La fecha mostrada es el mes indicado por el recurso, no la fecha de consulta ni la fecha de una posición en vivo. El registro puede omitir vehículos nuevos o conservar información que ya cambió: una coincidencia no constituye una verificación actual de la flota.

## Clasificación de la app

«Grande» y «pequeño» son etiquetas de la app derivadas de las tipologías; no son campos que publique Croma.

| Tipología del registro | Etiqueta |
| --- | --- |
| BUS (40), BUS (50), ALIMENTADOR (50) | Bus pequeño |
| BUS (80), ALIMENTADOR (80) | Bus grande |
| ARTICULADO, BIARTICULADO, PADRON DUAL | Bus grande |

TransMilenio describe [capacidades de 80 pasajeros para el padrón dual, 160 para el articulado y entre 250 y 270 para el biarticulado](https://www.transmilenio.gov.co/atencion-y-servicio-a-la-ciudadania/preguntas-frecuentes/el-sistema/con-que-capacidad-cuenta-cada-uno-de-los-buses-articulados). Esto respalda la agrupación por tamaño; no informa sobre la ocupación actual.

El cruce es exacto por placa, permitiendo diferencias de mayúsculas, espacios y guiones. No se deduce el tamaño a partir del código de ruta, el número interno, el color o el tipo de servicio. Una placa ausente, desconocida o inválida queda sin etiqueta. Las llegadas basadas solo en horario y TransMiCable tampoco reciben una etiqueta de tamaño.

## Integración

El catálogo se carga únicamente en el servidor. No añade llamadas a la fuente durante cada consulta ni descarga el registro al teléfono. Los endpoints de paradero y ruta añaden `vehicleSize: { size: "small" | "large", asOf: "YYYY-MM" } | null` a cada vehículo; las llegadas sin vehículo confirmado reciben `null`.

El campo es opcional para que una app nueva funcione con un servidor anterior. Hay que actualizar tanto el servidor como la app para ver las etiquetas: un servidor anterior seguirá mostrando las llegadas sin tamaño. No cambia la lógica existente de horarios, frescura o seguimiento del mapa.

El catálogo está en `src/server/data/sitp-fleet.json`; la búsqueda está en `src/server/fleet.ts`. Ejecutar `node scripts/import-sitp-fleet.mjs` descarga el recurso oficial fijado y regenera el extracto; también acepta una ruta local al CSV de diciembre de 2024. El SHA-256 debe coincidir con el original revisado antes de atribuir o reemplazar datos. Antes de actualizarlo a otro recurso, cambiar la fuente, el mes y el hash juntos en el importador, comprobar la licencia, las columnas y las tipologías, y revisar el cambio en los metadatos y el número de placas. No sustituir únicamente la fecha de un archivo antiguo.

## Cuando falta el dato: preguntar a la comunidad

Para una llegada en vivo con placa válida y sin tamaño en el registro, aparece una invitación opcional a indicar si el bus es grande o pequeño. La pregunta no interrumpe la consulta ni aparece para horarios, TransMiCable, datos desactualizados, placas ausentes o servidores antiguos. El servidor habilita esta opción mediante `Arrival.canReportVehicleSize` únicamente cuando está configurado el canal de reportes.

Al abrirla, la persona ve la placa y elige el tamaño, sin una respuesta seleccionada de antemano. Antes de enviar debe confirmar que está viendo ese bus y que la placa coincide. Puede salir con «No lo sé» sin enviar nada. La pantalla advierte que la placa y la respuesta serán públicas.

`POST /api/vehicle-size-reports` acepta solo la placa, el tamaño, la confirmación de observación y la versión/plataforma de la app. No incluye ubicación, ruta, paradero, texto libre ni identificadores de la persona. Revalida la placa y el registro en el servidor: si ya existe una clasificación oficial, rechaza el aporte. Usa `GITHUB_REPORTS_TOKEN`, `REPORTS_REPO` y el límite de frecuencia del canal existente. Este límite es temporal y por instancia del servidor, no una deduplicación global ni un conteo de personas distintas.

La respuesta se publica como **observación comunitaria pendiente de revisión**. El registro oficial y las etiquetas de tamaño permanecen intactos. No se calcula un consenso ni se presenta una observación individual como confirmación; los mantenedores pueden revisar los reportes por placa antes de decidir cómo incorporar información adicional con su propia procedencia. No se deben mezclar esas observaciones con el archivo oficial que verifica el importador.

Tras un envío exitoso, la app oculta nuevas invitaciones para esa placa durante la sesión. Esta lista vive solo en memoria, no se envía ni identifica usuarios, y se pierde al reiniciar la app. Una respuesta fallida permite reintentar; no se muestra como enviada. Hay que desplegar la API y actualizar la app para habilitar el flujo.

## Validación

Ejecutar `npm run check`, que incluye las comprobaciones de flota y de reportes comunitarios, con Node 24 o una versión reciente de Node 22 con ejecución de TypeScript habilitada. Las pruebas de reportes simulan GitHub y no publican issues. Comprobar también las tarjetas y el formulario con texto grande y VoiceOver/TalkBack en iOS o Android antes de publicar.

Como comprobación de viabilidad, una consulta pública al paradero `52762` del reporte #474 el 17 de noviembre de 2026 encontró coincidencias para sus 18 placas distintas entre llegadas y buses cercanos. Incluía buses de 40, 50 y 80 pasajeros según el registro. Es una muestra puntual, no una medición de cobertura de toda Bogotá ni una garantía de vigencia.
