# EntreLíneas · Inglés → español en vivo

Web estática para Windows y Chrome actualizado. Muestra la transcripción original en inglés y la traducción progresiva al español del audio de Meet, Zoom web o del audio del sistema que Chrome permita compartir.

## Publicar en GitHub Pages

1. Crea un repositorio público, por ejemplo `entrelineas`.
2. Sube el contenido de esta carpeta conservando `docs/` y sus archivos.
3. En **Settings → Pages → Build and deployment**, selecciona **Deploy from a branch**, rama **main**, carpeta **/docs** y pulsa **Save**.
4. Abre la dirección HTTPS que GitHub confirme en esa misma página. La primera publicación puede tardar unos minutos.

No necesita compilación, servidor propio, base de datos, claves de API ni paquetes de npm. No coloques claves en este repositorio.

## Usar con Zoom y Meet

1. Abre la web con **Chrome de escritorio actualizado en Windows**.
2. Deja seleccionado **En este equipo** para el reconocimiento local. Pulsa **Preparar idiomas**. Si el botón cambia a **Preparar voz en inglés**, púlsalo de nuevo para completar la descarga local con una nueva acción del usuario. La disponibilidad depende del navegador, sus políticas y el dispositivo.
3. Abre Meet o Zoom web en otra pestaña.
4. Pulsa **Conectar reunión**, selecciona la pestaña y activa **Compartir audio de la pestaña**.
5. Si usas Zoom instalado, selecciona **Audio de Windows / Zoom instalado**, comparte una pantalla completa y activa audio del sistema si Chrome lo ofrece. También puede captar notificaciones y otro sonido del sistema. Si no está disponible, utiliza Zoom web.
6. Pulsa **Detener** al terminar. **Copiar** y **Descargar** permiten conservar el texto bajo tu control.

El selector de Chrome puede pedir compartir una superficie de pantalla para acceder a su audio. La aplicación utiliza la pista de audio y no graba ni procesa imágenes de esa superficie. No se sustituye silenciosamente el audio de la reunión por el micrófono.

## Alternativa de voz en línea

Si Chrome no ofrece reconocimiento local, puedes seleccionar explícitamente **Servicio de voz de Chrome** y preparar otra vez. En ese modo el audio se envía al proveedor de reconocimiento del navegador. La traducción de texto sigue usando el traductor local de Chrome. El servicio depende de internet y de su disponibilidad; esta aplicación no usa una API facturada ni promete disponibilidad ilimitada del proveedor.

## Compatibilidad y velocidad

- La traducción utiliza `Translator` con origen `en` y destino `es`.
- El reconocimiento utiliza Web Speech con `en-US`, resultados provisionales y `continuous: true`.
- La entrada desde una pista de audio necesita Chrome de escritorio 135 o posterior; el reconocimiento local necesita las funciones y paquetes disponibles a partir de Chrome 139. Se recomienda la versión estable más reciente.
- **No se garantiza latencia inferior a un segundo.** El texto provisional puede cambiar al llegar más contexto. La RAM por sí sola no determina la velocidad.
- El indicador **Texto → español** cuenta desde la recepción de texto reconocido hasta que se devuelve su traducción, incluida la espera de la cola. **No mide el retraso del reconocimiento ni la latencia completa desde el audio.**
- **Medir traducción** calcula el promedio de tres frases de texto en el equipo del usuario. Tampoco mide el reconocimiento de voz.
- Chrome puede suspender o limitar la web en segundo plano. Para el uso inicial, mantén visibles la reunión y esta página.
- El historial de pantalla conserva hasta 250 fragmentos para evitar crecimiento indefinido de memoria. Descárgalo antes de alcanzar ese límite si necesitas conservar una conversación más larga.

## Privacidad

La web no usa analítica, cookies de sesión, almacenamiento persistente de transcripciones ni un backend. En modo local, Chrome realiza el reconocimiento y la traducción en el dispositivo, sujeto a su soporte y sus paquetes. La descarga inicial de modelos requiere internet. En modo de voz en línea el audio se envía al proveedor del navegador, como se indica antes de conectar. GitHub aloja los archivos de la web; la aplicación no envía audio ni transcripciones a GitHub. Los botones Copiar y Descargar solo se activan por una acción del usuario.

## Verificación de desarrollo

Con Node.js instalado:

```sh
npm run check
npm test
```

Las pruebas comprueban la cola de traducción con voz cambiante, la conservación de frases finales, la recuperación tras errores y el descarte de resultados obsoletos. Los permisos reales, la instalación de paquetes y la velocidad de reconocimiento deben verificarse en Chrome del equipo de destino.

## Fuentes técnicas

- [Translator API de Chrome](https://developer.chrome.com/docs/ai/translator-api)
- [Reconocimiento local en Chrome 139](https://developer.chrome.com/blog/new-in-chrome-139)
- [Entrada MediaStreamTrack para SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start)
- [Captura y límites del audio de pantalla](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
