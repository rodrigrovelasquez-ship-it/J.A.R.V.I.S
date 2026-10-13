import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(root, "public");
const maxBodyBytes = 100 * 1024;
const maxVoiceBodyBytes = 2 * 1024 * 1024;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function loadEnvFile() {
  try {
    const contents = await readFile(resolve(root, ".env"), "utf8");
    for (const line of contents.split(/\r?\n/u)) {
      const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/u);
      if (!match || match[1].startsWith("#")) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/u, "$2");
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request, maxBytes = maxBodyBytes) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error("La solicitud es demasiado grande.");
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("El cuerpo de la solicitud no contiene JSON válido.");
    error.statusCode = 400;
    throw error;
  }
}

async function generateGeminiText({
  env,
  fetchImpl,
  contents,
  systemInstruction,
  temperature = 0.7,
}) {
  const model = env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const baseUrl = (env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta")
    .replace(/\/+$/u, "");
  const upstream = await fetchImpl(
    `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        contents,
        generationConfig: { temperature },
      }),
    },
  );

  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message =
      typeof result.error?.message === "string"
        ? result.error.message
        : `Gemini respondió con el estado ${upstream.status}.`;
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }

  const answer = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter((text) => typeof text === "string")
    .join("");
  if (!answer?.trim()) {
    const error = new Error("Gemini devolvió una respuesta vacía.");
    error.statusCode = 502;
    throw error;
  }
  return answer.trim();
}

async function serveStatic(pathname, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: "La ruta no es válida." });
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = resolve(publicRoot, relativePath);
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + sep)) {
    sendJson(response, 404, { error: "No se encontró la página." });
    return;
  }

  try {
    const contents = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    sendJson(response, 404, { error: "No se encontró la página." });
  }
}

export function createServer({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        configured: Boolean(env.GEMINI_API_KEY?.trim()),
        name: "Jarvis",
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        if (!env.GEMINI_API_KEY?.trim()) {
          sendJson(response, 503, {
            error: "Falta configurar GEMINI_API_KEY en el archivo .env. Consulta el README.",
          });
          return;
        }

        const body = await readJson(request);
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          sendJson(response, 400, { error: "Envía al menos un mensaje para que Jarvis responda." });
          return;
        }

        const messages = body.messages.slice(-20);
        if (messages[0]?.role === "assistant") messages.shift();
        if (
          messages.length === 0 ||
          messages.some(
            (message) =>
              !message ||
              !["user", "assistant"].includes(message.role) ||
              typeof message.content !== "string" ||
              message.content.length > 8_000,
          )
        ) {
          sendJson(response, 400, { error: "Hay mensajes con un formato no válido." });
          return;
        }
        if (messages.reduce((total, message) => total + message.content.length, 0) > 24_000) {
          sendJson(response, 400, {
            error: "La conversación es demasiado larga. Pulsa «Limpiar» para empezar una nueva.",
          });
          return;
        }

        const answer = await generateGeminiText({
          env,
          fetchImpl,
          systemInstruction:
            "Eres Jarvis, un asistente personal atento, claro y resolutivo. Habla en español salvo que el usuario pida otro idioma. Responde con honestidad: no inventes datos, reconoce tus límites y pregunta si falta contexto. No afirmes haber realizado acciones en el dispositivo o en internet si no tienes una herramienta para hacerlas. Sé conciso, natural y útil.",
          contents: messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
        });
        sendJson(response, 200, { answer });
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          error: error.statusCode
            ? `No pude obtener respuesta de la IA: ${error.message}`
            : "No pude conectar con el servicio de IA. Comprueba tu conexión e inténtalo de nuevo.",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/voice") {
      try {
        if (!env.GEMINI_API_KEY?.trim()) {
          sendJson(response, 503, { error: "Falta configurar GEMINI_API_KEY en el archivo .env." });
          return;
        }

        const body = await readJson(request, maxVoiceBodyBytes);
        if (
          body.mimeType !== "audio/wav" ||
          typeof body.audio !== "string" ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body.audio)
        ) {
          sendJson(response, 400, { error: "El audio debe enviarse en formato WAV válido." });
          return;
        }
        const audio = Buffer.from(body.audio, "base64");
        if (audio.length < 44 || audio.length > 1_400_000 || audio.toString("ascii", 0, 4) !== "RIFF") {
          sendJson(response, 400, { error: "El archivo WAV está vacío o supera el tamaño permitido." });
          return;
        }

        const transcript = await generateGeminiText({
          env,
          fetchImpl,
          systemInstruction:
            "Transcribe literalmente en español las palabras audibles en el audio. Devuelve solamente la transcripción, sin responder a la pregunta ni añadir explicaciones. Si no se entiende ninguna palabra, devuelve exactamente una cadena vacía.",
          temperature: 0,
          contents: [
            {
              role: "user",
              parts: [
                { text: "Transcribe este audio." },
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: audio.toString("base64"),
                  },
                },
              ],
            },
          ],
        });
        sendJson(response, 200, { transcript });
      } catch (error) {
        sendJson(response, error.statusCode || 502, {
          error: error.statusCode
            ? `No pude reconocer el audio con Gemini: ${error.message}`
            : "No pude enviar el audio a Gemini. Comprueba tu conexión e inténtalo de nuevo.",
        });
      }
      return;
    }

    if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
      try {
        await serveStatic(url.pathname, response);
      } catch {
        sendJson(response, 500, { error: "No se pudo cargar la página." });
      }
      return;
    }

    sendJson(response, 404, { error: "No se encontró la ruta solicitada." });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await loadEnvFile();
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT debe ser un número entre 1 y 65535.");
  }

  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Jarvis está listo en http://localhost:${port}`);
    if (!process.env.GEMINI_API_KEY?.trim()) {
      console.log("Configura GEMINI_API_KEY en .env para activar las respuestas de Gemini.");
    }
  });
}
