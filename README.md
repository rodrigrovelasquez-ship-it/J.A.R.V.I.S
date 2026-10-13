# Jarvis — asistente personal web

Aplicación web en español para conversar con un modelo de IA y hablar con Jarvis mediante el navegador. Jarvis permanece en silencio hasta que activas el micrófono y dices **«Jarvis»**; también puedes escribirle.

## Requisitos

- Windows y Node.js 20 o posterior.
- Una clave API de Gemini y conexión a internet para obtener respuestas de IA.
- Chrome o Edge para el reconocimiento de voz. Abre la aplicación desde `localhost` y acepta el permiso del micrófono cuando lo solicite el navegador.

## Preparación

1. Abre PowerShell en esta carpeta.
2. Crea tu archivo local de configuración:

   ```powershell
   notepad .env
   ```

3. Revoca cualquier clave que hayas publicado o compartido en un chat. Crea una clave nueva en [Google AI Studio](https://aistudio.google.com/apikey), pégala después de `GEMINI_API_KEY=` y guarda el archivo. Puedes cambiar el modelo y el puerto desde ese mismo archivo. **No compartas ni publiques `.env` ni pegues tu clave en el chat.**
4. Inicia Jarvis:

   ```powershell
   npm start
   ```

5. Abre [http://localhost:3000](http://localhost:3000) en Chrome o Edge, concede acceso al micrófono y pulsa **Activar escucha**. Ahora puedes decir «Jarvis, ¿qué tiempo hace?»; si solo dices «Jarvis», espera a que te conteste «Te escucho» antes de hacer la pregunta.

Sin una clave configurada puedes abrir la interfaz, pero Gemini no podrá responder. También puedes utilizar el chat de texto, aunque las solicitudes siguen necesitando dicha clave.

## Voz y privacidad

- La escucha solo comienza después de que pulses el botón; puedes detenerla cuando quieras.
- Mientras escuchas, Jarvis espera a detectar «Jarvis». Si el servicio de reconocimiento del navegador no está disponible, usa el micrófono directamente, detecta cuándo terminas de hablar y envía solo ese fragmento de audio a Gemini para transcribirlo. En ese modo, puedes decir «Jarvis, ¿cuánto es dos más dos?» en una sola frase.
- En el modo de transcripción directa, cada fragmento hablado se envía a Gemini; no se transmiten los silencios. El audio se procesa para detectar el nombre de activación y la pregunta.
- Para probarlo, pulsa **Activar escucha** y di en una sola frase «Jarvis, ¿cuánto es dos más dos?». También puedes decir «Jarvis», esperar a oír «Te escucho» y hacer la pregunta antes de que pasen 12 segundos. El texto bajo el botón muestra lo que el micrófono está reconociendo o el error que impide escuchar.
- El texto de cada pregunta y el contexto reciente de la conversación se envían a la API de Gemini. La clave API permanece en el servidor local y no se entrega al navegador.
- La voz necesita Chrome o Edge, permiso de micrófono y acceso a internet. La aplicación sigue ofreciendo chat escrito en otros navegadores.
- Jarvis puede equivocarse; verifica cualquier información importante.

## Pruebas

```powershell
npm test
```
