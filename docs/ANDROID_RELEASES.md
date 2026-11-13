# APK de Android en GitHub Releases

El workflow `Android APK release` compila en un runner de GitHub Actions con
`eas build --local`. No encarga una compilación a la nube de Expo, pero sí usa
Expo para autenticar el proyecto, recuperar su firma y administrar `versionCode`.
El uso de runners está sujeto a las condiciones y cuotas de GitHub Actions.

Genera un APK de producción (no un development client ni un AAB), con el paquete
`co.usecroma.paradero`. Adjunta `paradero-vX.Y.Z.apk` y su checksum SHA-256 a una
release **estable ya publicada**. No crea releases ni publica en Google Play.
El CI existente de pull requests continúa sin acceso a credenciales de firma.

## Configuración inicial: solo mantenedores

1. Vincular el repositorio al proyecto Expo **oficial**, no al proyecto personal
   de quien contribuye:

   ```sh
   npx eas-cli@27.7.1 login
   npx eas-cli@27.7.1 init
   ```

   Revisar y versionar los cambios de configuración (`extra.eas.projectId` y,
   si corresponde, `owner` en `app.json`). No inventar un ID ni crear otro proyecto
   si ya existe uno del equipo.

2. Configurar o importar la **clave Android permanente** para el perfil
   `github-release` con `npx eas-cli@27.7.1 credentials --platform android`.
   La configuración debe estar completa antes de ejecutar CI: el build es no
   interactivo y no puede resolver preguntas de credenciales.
   Respaldar el keystore y sus contraseñas fuera del repositorio.
   **Nunca generar una clave nueva en cada ejecución.** Si ya se distribuyó un
   APK, reutilizar su certificado para poder actualizarlo sin desinstalar.

3. Si Android ya tiene versiones distribuidas, inicializar el contador remoto con
   `npx eas-cli@27.7.1 build:version:set --platform android` para que los próximos
   `versionCode` superen los existentes. El perfil hereda `autoIncrement: true` y
   `cli.appVersionSource: remote`; no usa el número de ejecución de GitHub.
   Coordinar también otras compilaciones Android que compartan este contador:
   publicar una versión más vieja después de una más nueva no permite actualizar.

4. Crear el environment de GitHub **`android-release`**:
   - Secret **`EXPO_TOKEN`**: token del equipo con permisos para este proyecto.
   - Variable **`ANDROID_CERT_SHA256`**: huella SHA-256 del certificado de firma
     aprobado (con o sin `:`). Obtenerla del keystore de confianza con
     `keytool -list -v -keystore /ruta/al/keystore`, o de un APK de confianza con
     `apksigner verify --print-certs /ruta/al/apk`.
   - Restringir el environment a los tags de release y, cuando el plan de GitHub
     lo permita, exigir revisión de un mantenedor. Para ejecución manual, permitir
     también la rama desde la que se lanza el workflow. Proteger los tags contra
     cambios y limitar quién puede publicar releases.

   El certificado se comprueba antes de publicar para detectar una rotación
   accidental. Su huella es pública; la clave privada y `EXPO_TOKEN` no lo son.
   No configurar estos secretos en forks ni proporcionarlos a pull requests.

5. Confirmar que `https://paradero.expo.app` está desplegado y accesible: es el
   backend configurado en Expo Router. El APK no necesita `CROMA_API_KEY` ni
   `GITHUB_REPORTS_TOKEN`; ambos pertenecen al servidor, no al cliente Android.
   No incluirlos en variables `EXPO_PUBLIC_*` ni en artefactos.

El perfil de la tienda y el de GitHub comparten configuración de producción,
pero Play App Signing puede usar un certificado distinto al del keystore de
subida de EAS. No prometer actualizaciones cruzadas Play ↔ GitHub sin comparar
los certificados reales. Una firma distinta puede exigir desinstalar primero,
lo que elimina los datos locales.

## Publicar una versión

1. Integrar el workflow y completar la configuración anterior en `main`.
2. Actualizar `expo.version` en `app.json` a `X.Y.Z`. Mantener la versión de
   `package.json` y su lockfile alineadas como parte de la preparación de versión.
3. Ejecutar `npm ci` y `npm run check`, integrar los cambios y crear el tag
   **`vX.Y.Z` sobre ese commit**. No mover tags ya publicados.
4. Crear y publicar una release estable con ese tag y sus notas.
5. GitHub comprueba tag/versión y ejecuta `npm run check` sobre el commit del tag;
   después solicita acceso al environment, compila, verifica firma, paquete,
   versión y que no sea debuggable, y adjunta APK y checksum. Solo el job que
   adjunta los archivos tiene `contents: write`.
6. Instalar el primer APK en un dispositivo y comprobar mapas, ubicación y API.
   En la siguiente release comprobar también una actualización sin desinstalar.

La release queda visible mientras se compila; Obtainium solo podrá descargarla
cuando termine la subida del APK. No existe garantía de builds reproducibles:
se fija EAS CLI, pero el runner y algunas herramientas/dependencias pueden cambiar.

### Fallos y reintentos

- Ver `Actions → Android APK release`. Una compilación fallida no publica APK.
- Se puede volver a ejecutar el workflow fallido o usar `Run workflow` desde
  `main`, indicando el tag de una release estable existente. Siempre se compila
  el commit del tag, **no** el último commit de `main`.
- Tags cuyo código no incluya el perfil `github-release` y el enlace al proyecto
  Expo no pueden usar este flujo sin cambios. No se rellenan automáticamente las
  releases históricas.
- No se sobrescriben APK publicados: si la release ya tiene un APK, se rechaza
  antes de compilar. Para corregir un binario distribuido, publicar otra versión.
- Si falló solamente la subida, reejecutar **solo los jobs fallidos** mientras el
  artefacto de Actions esté disponible (7 días). Si quedó una subida parcial,
  revisar los assets manualmente; no borrar un APK ya distribuido para reemplazarlo.
- Cada nueva compilación puede consumir otro `versionCode`; los saltos son normales.
- La concurrencia serializa este workflow y no cancela un build en curso. GitHub
  puede sustituir ejecuciones pendientes si se lanzan varias releases juntas;
  publicar una por vez y verificar su resultado antes de continuar.

## Instalar y actualizar con Obtainium

Una vez publicada la primera release con APK:

1. Instalar [Obtainium](https://obtainium.imranr.dev/).
2. En **Agregar aplicación**, pegar `https://github.com/croma-labs/paradero`.
3. Guardar e instalar. Hay un solo APK por release: no hace falta elegir
   arquitectura ni usar un filtro especial. Mantener desactivadas las prereleases.
4. Autorizar a Obtainium a instalar aplicaciones cuando Android lo solicite.

Obtainium consulta las releases de GitHub; no necesita acceso a artefactos de
Actions ni una cuenta de Expo. Android exige el mismo paquete, firma compatible
y un `versionCode` creciente para actualizar sin desinstalar.
Si aparece una release histórica sin APK, revisar las releases disponibles en
GitHub: este flujo solo adjunta APK a nuevas versiones configuradas para ello.

Para verificar una descarga en un ordenador, descargar ambos archivos y ejecutar:

```sh
sha256sum --check paradero-vX.Y.Z.apk.sha256
```

El checksum detecta corrupción; no sustituye la verificación de la firma ni
constituye por sí solo una prueba independiente de autenticidad.

## Referencias

- [EAS en CI](https://docs.expo.dev/build/building-on-ci/)
- [Compilar con EAS --local y sus limitaciones](https://docs.expo.dev/build-reference/local-builds/)
- [Perfiles de APK](https://docs.expo.dev/build-reference/apk/)
- [Versiones remotas e incremento automático](https://docs.expo.dev/build-reference/app-versions/)
- [Credenciales administradas](https://docs.expo.dev/app-signing/managed-credentials/)
- [Obtainium](https://wiki.obtainium.imranr.dev/)
