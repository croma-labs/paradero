# Diseño

Paradero tiene un solo sistema de diseño. Cada medida, color y tipo de letra sale de `src/theme`, y `npm run check` falla si alguien escribe un número o un color suelto en una pantalla o un componente. Así la app se ve igual en cada pantalla, y quien llegue nuevo al código no tiene que adivinar.

## Tokens

Todo vive en `src/theme/tokens.ts` y `src/theme/colors.ts`.

| Token | Para qué | Ejemplo |
| --- | --- | --- |
| `space[n]` | Cuadrícula de 4 puntos. La llave es el paso: `space[4]` son 16 | `gap: space[3]` |
| `radius` | Esquinas: `xs` 4 · `sm` 6 · `md` 10 · `lg` 16 · `xl` 20 · `sheet` 20 · `pill` | `borderRadius: radius.lg` |
| `size.icon` | Íconos: `xs` 12 · `sm` 16 · `md` 20 · `lg` 24 | `<Icon size="sm" />` |
| `size.control` | Alto de botones y campos: `sm` 36 · `md` 48 · `lg` 56 | `height: size.control.lg` |
| `size.tile`, `size.glyph` | Cuadros con glifo y el glifo que cabe en cada uno | `<Tile tier="lg" />` |
| `size.dot`, `size.line` | Puntos de estado y líneas | `borderWidth: size.line.rule` |
| `layout` | Medidas de pantalla: margen lateral, espacio para la barra de pestañas, mapa de detalle | `paddingBottom: layout.tabBarClearance` |
| `type` | Escala tipográfica: `poster`, `hero`, `heading`, `display`, `title`, `headline`, `body`, `callout`, `caption`, `eyebrow`, `chrome` | `<Text variant="title" />` |
| `usePalette()` | Colores del tema claro u oscuro | `p.text`, `p.surface`, `p.shadow` |
| `signal`, `systems`, `lineText`, `photo` | Puntos de estado, color de línea e insignia de cada parte del sistema, texto sobre insignias y fotos | `systems.troncal.fill` |

## Identidad

Paradero se viste con **Trazo**: la red de Bogotá dibujada como un mapa de metro. Papel, tinta y el color de cada línea. El color en pantalla siempre significa "una línea"; todo lo demás es papel y tinta.

- **Claro y oscuro.** Sigue al teléfono por defecto; en Bien público → Apariencia se puede fijar en Clara u Oscura (`src/lib/appearance.ts`). Claro es papel de mapa (`#F0ECE2`) con tinta `#1F1F23`; oscuro es el mismo mapa de noche (`#16171B`), donde papel y tinta se cambian y las líneas no.
- **Títulos como letreros.** `poster`, `hero`, `heading`, `display` y `title` van en Familjen Grotesk, sólidos y apretados, como el nombre de una estación. No se desvanecen.
- **Etiquetas en mono.** `eyebrow` es DM Mono en mayúsculas con espaciado ancho. Rutas, minutos y precios también van en mono, para que los dígitos no salten.
- **El marco.** `chrome` sigue siendo Victor Mono en mayúsculas: `+ Infraestructura de datos públicos`, `usecroma.com +`.
- **Rutas sobre su línea.** `RouteBadge` lleva el código sobre el tono profundo de su parte del sistema (`systems[x].fill`) con una marca de forma, así se lee sin color. La próxima en llegar va en tinta con la marca en el color brillante de la línea (`systems[x].dot`).
- **Paraderos como estaciones del mapa.** `StopTile` dibuja un aro de tinta para un paradero SITP y un cuadro de tinta para una estación de TransMilenio, con el mismo trazo de 3 puntos que el mapa.
- **Bordes antes que sombras.** Las tarjetas se separan con un borde fino; el botón secundario y los chips llevan borde de tinta o de papel.

| Parte del sistema | Línea (`dot`) | Insignia (`fill`) |
| --- | --- | --- |
| TransMilenio | `#E2403A` | `#B42A25` |
| Dual | `#F2892B` | `#A3500F` |
| SITP zonal | `#2F6BD6` | `#1F4FA8` |
| Alimentador | `#3FA45B` | `#2A7A41` |
| Complementario | `#F2C230` | `#7A5A00` |
| Especial | `#7B52C1` | `#5E3A9E` |
| TransMiCable | `#1D9C9C` | `#12706F` |
| Otro | `#8A8778` | `#5E5C55` |

`npm run check` mide el texto de las insignias (`lineText`) sobre cada `fill`: todas pasan AA.

## Web

Las pestañas nativas no existen en web, así que `src/app/(tabs)/_layout.web.tsx` las dibuja: barra inferior en pantallas angostas y, desde `layout.wide` (900), barra lateral de `layout.rail` con las etiquetas siempre visibles y la pestaña abierta en tinta. El contenido de cada pestaña se queda en una columna de hasta `layout.content` (720) y el onboarding en una de `layout.column` (560), para que nada se estire de borde a borde en una pantalla grande.

## Movimiento

Nada rebota. Todo entra con una curva que se asienta (`src/theme/motion.ts`): `motion.enter` para contenido que llega, `motion.appear` para superficies, `motion.layout` para filas que cambian de lugar. Sin resortes. Y con "Reducir movimiento" activo, nada se mueve.

## Accesibilidad

Paradero es para todas las personas de Bogotá, así que la accesibilidad no es un modo aparte: es el diseño. La meta es WCAG 2.2 AA, la que exige la Resolución 1519 de 2020 a los servicios digitales del Estado, y AAA en alto contraste.

| Ajuste del teléfono | Qué hace Paradero | Dónde |
| --- | --- | --- |
| Más contraste (iOS) / Texto de alto contraste (Android) | Cambia a la paleta de alto contraste: negro y blanco puros, bordes visibles. También se puede activar solo en Paradero | `usePalette`, `HIGH_LIGHT`, `HIGH_DARK` |
| Tamaño de texto | Todo el texto crece. Desde los tamaños de accesibilidad, las filas se apilan en vez de apretarse | `useLargeText`, `NextBus`, `ArrivalRow` |
| Texto en negrita | Cada peso sube un paso, porque las fuentes propias no lo hacen solas | `Text` |
| Reducir movimiento | Sin pulsos, sin dígitos que ruedan, sin animaciones de entrada | `Dot`, `Minutes`, Reanimated |
| Reducir transparencia | El vidrio se vuelve una superficie sólida | `Glass` |
| VoiceOver / TalkBack | Frases completas, títulos marcados como encabezados, el mapa se oculta porque la lista dice lo mismo, avisos al guardar | `accessibilityLabel`, `announce` |

Reglas:

- `npm run check` mide el contraste de cada paleta. Un color que falle no pasa.
- Todo lo que se toca mide al menos 44 puntos, aunque se vea más pequeño (`hitSlop`).
- Botones y chips crecen con el texto (`minHeight`, nunca `height`).
- El color nunca es la única señal: cada punto de estado va con su texto.

## Tipografía

**Familjen Grotesk** para los títulos, **Instrument Sans** para todo lo que se lee o se toca, **DM Mono** para etiquetas, rutas y minutos, **Victor Mono** para el marco. Todas vienen con la SIL Open Font License. Los títulos toman su familia de `displayFonts` cuando el estilo tiene `display: true` en `type`.

## Componentes

Antes de escribir estilos, usa lo que ya existe:

| Componente | Uso |
| --- | --- |
| `Text` | Todo texto. Nunca `fontSize` a mano |
| `Button` | `primary`, `secondary`, `quiet`; alto `md` o `lg` |
| `Chip` | Filtros y sugerencias |
| `Tile` | Cuadro con un glifo o ícono; `StopTile` para paraderos |
| `Rail` | Fila horizontal de tarjetas, con espacio para que la sombra no se corte |
| `DetailScreen` | Mapa arriba y hoja de detalle encima, para paraderos y rutas |
| `Minutes` | Minutos que ruedan; `sm`, `md`, `lg`, alineados a la línea base |
| `RouteBadge`, `Dot`, `Icon`, `Bone`, `SkeletonList`, `Empty`, `FeedStatus` | Piezas pequeñas compartidas |

## Reglas

- Si una medida no existe, se agrega al token con un nombre de rol, no se escribe en la pantalla.
- Las sombras necesitan espacio: dentro de un `ScrollView` horizontal usa `Rail`.
- El texto nunca tiene alto fijo; las tarjetas crecen con su contenido.
- Lo que carga ocupa el mismo espacio que lo que llega (`Bone`), para que nada salte.
- Cada elemento que se toca tiene `accessibilityRole` y una etiqueta completa en español.
