const connection = document.querySelector("#connection-label");
const connectionIndicator = document.querySelector(".connection");
const voiceState = document.querySelector("#voice-state");
const heroCopy = document.querySelector("#hero-copy");
const micButton = document.querySelector("#mic-button");
const micLabel = document.querySelector("#mic-label");
const privacyNote = document.querySelector("#privacy-note");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messagesElement = document.querySelector("#messages");
const clearButton = document.querySelector("#clear-button");
const emptyState = document.querySelector("#empty-state");
const wakeWord = JSON.parse(document.querySelector("#app-config").textContent).wakeWord;
const hasSpeechRecognition = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
const canCaptureAudio = Boolean(navigator.mediaDevices?.getUserMedia && window.AudioContext);

const conversation = [];
let recognition;
let listening = false;
let awaitingCommand = false;
let busy = false;
let speaking = false;
let voiceSupported = hasSpeechRecognition || canCaptureAudio;
let audioFallback = !hasSpeechRecognition && canCaptureAudio;
let recognitionRunning = false;
let audioStarting = false;
let audioPaused = false;
let audioProcessing = false;
let audioStream;
let audioContext;
let audioProcessor;
let silentGain;
let preRollFrames = [];
let speechFrames = [];
let speechStartedAt = 0;
let lastSpeechAt = 0;
let voicedDuration = 0;
let commandTimer;

function startRecognition() {
  if (!listening || busy || speaking) return;
  if (audioFallback) {
    audioPaused = false;
    void startGeminiAudioCapture();
    return;
  }
  if (recognitionRunning || !recognition) return;
  try {
    recognitionRunning = true;
    recognition.start();
  } catch {
    recognitionRunning = false;
    setTimeout(() => {
      if (listening && !busy && !speaking) startRecognition();
    }, 350);
  }
}

function pauseVoiceInput() {
  if (audioFallback) {
    audioPaused = true;
    return;
  }
  try {
    recognition?.stop();
  } catch {
    // El reconocimiento puede haberse detenido justo antes de comenzar a hablar.
  }
}

function resumeVoiceInput() {
  if (listening && !busy && !speaking) startRecognition();
}

function setState(state, label) {
  document.body.classList.remove("is-listening", "is-thinking", "is-speaking");
  if (state) document.body.classList.add(`is-${state}`);
  voiceState.textContent = label;
}

function addMessage(role, text, isError = false) {
  emptyState.hidden = true;
  clearButton.hidden = false;

  const article = document.createElement("article");
  article.className = `message message-${role}${isError ? " message-error" : ""}`;
  const label = document.createElement("p");
  label.className = "message-label";
  label.textContent = role === "user" ? "TÚ" : "JARVIS";
  const bubble = document.createElement("p");
  bubble.className = "message-bubble";
  bubble.textContent = text;
  article.append(label, bubble);
  messagesElement.append(article);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return bubble;
}

function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  speaking = true;
  if (listening) pauseVoiceInput();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  utterance.rate = 1;
  utterance.onstart = () => setState("speaking", "JARVIS ESTÁ HABLANDO");
  utterance.onend = () => {
    speaking = false;
    setState(listening ? "listening" : "", listening ? "ESCUCHANDO «JARVIS»" : "ASISTENTE EN ESPERA");
    resumeVoiceInput();
  };
  utterance.onerror = () => {
    speaking = false;
    resumeVoiceInput();
  };
  window.speechSynthesis.speak(utterance);
}

function setListening(active) {
  listening = active;
  micButton.setAttribute("aria-pressed", String(active));
  micLabel.textContent = active ? "Desactivar escucha" : "Activar escucha";
  heroCopy.innerHTML = active
    ? 'Estoy pendiente. Di <strong>«Jarvis»</strong> y haz tu pregunta.'
    : 'Di <strong>«Jarvis»</strong> y después haz tu pregunta.';
  if (active) {
    setState("listening", "CONECTANDO EL MICRÓFONO");
    privacyNote.textContent = "Permite el acceso al micrófono si el navegador lo solicita.";
    startRecognition();
  } else {
    clearTimeout(commandTimer);
    awaitingCommand = false;
    speaking = false;
    window.speechSynthesis?.cancel();
    recognitionRunning = false;
    pauseVoiceInput();
    stopGeminiAudioCapture();
    privacyNote.textContent = "Micrófono desactivado.";
    setState("", "ASISTENTE EN ESPERA");
  }
}

async function askJarvis(question) {
  const text = question.trim();
  if (!text || busy) return;

  busy = true;
  window.speechSynthesis?.cancel();
  pauseVoiceInput();
  privacyNote.textContent = "Consultando a Gemini…";
  addMessage("user", text);
  conversation.push({ role: "user", content: text });
  setState("thinking", "JARVIS ESTÁ PENSANDO");
  sendButton.disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation.slice(-20) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No pude procesar tu pregunta.");

    conversation.push({ role: "assistant", content: result.answer });
    addMessage("assistant", result.answer);
    if (listening) speak(result.answer);
    else setState("", "ASISTENTE EN ESPERA");
  } catch (error) {
    addMessage("assistant", error.message, true);
    if (listening) speak(error.message);
    else setState("", "ASISTENTE EN ESPERA");
  } finally {
    busy = false;
    sendButton.disabled = false;
    resumeVoiceInput();
  }
}

function cleanWakeWord(text) {
  const expression = new RegExp(`\\b${wakeWord}\\b[,\\s:;.!?—-]*`, "iu");
  return text.replace(expression, "").trim();
}

function handleRecognizedText(text) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es");
  if (awaitingCommand) {
    clearTimeout(commandTimer);
    awaitingCommand = false;
    if (new RegExp(`\\b${wakeWord}\\b`, "iu").test(normalized)) {
      const question = cleanWakeWord(text);
      if (question) askJarvis(question);
      else waitForCommand();
    } else {
      askJarvis(text);
    }
    return;
  }

  if (!new RegExp(`\\b${wakeWord}\\b`, "iu").test(normalized)) {
    if (audioFallback) {
      privacyNote.textContent = `Te oí decir «${text}». Para responder, di «Jarvis» y después tu pregunta.`;
    }
    return;
  }
  const question = cleanWakeWord(text);
  if (question) {
    askJarvis(question);
    return;
  }
  waitForCommand();
}

function waitForCommand() {
  awaitingCommand = true;
  setState("listening", "TE ESTOY ESCUCHANDO");
  privacyNote.textContent = "Te escucho. Haz tu pregunta antes de 12 segundos.";
  speak("Te escucho.");
  commandTimer = setTimeout(() => {
    awaitingCommand = false;
    setState("listening", "ESCUCHANDO «JARVIS»");
  }, 12_000);
}

function resetSpeechFrames() {
  speechFrames = [];
  speechStartedAt = 0;
  lastSpeechAt = 0;
  voicedDuration = 0;
}

function encodeWav(frames, sampleRate) {
  const sampleCount = frames.reduce((total, frame) => total + frame.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const frame of frames) {
    for (const sample of frame) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function transcribeAudio(frames, sampleRate) {
  if (audioProcessing || frames.length === 0) return;
  audioProcessing = true;
  setState("thinking", "ENTENDIENDO TU VOZ");
  privacyNote.textContent = "Enviando el fragmento de voz a Gemini para transcribirlo.";
  try {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: "audio/wav", audio: encodeWav(frames, sampleRate) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No pude transcribir el audio.");
    if (!listening) return;
    if (result.transcript) {
      handleRecognizedText(result.transcript.trim());
    } else {
      privacyNote.textContent = "No entendí esas palabras. Di «Jarvis» seguido de tu pregunta.";
    }
  } catch (error) {
    privacyNote.textContent = error.message;
    setState("listening", "ESCUCHANDO «JARVIS»");
  } finally {
    audioProcessing = false;
    if (listening && !busy && !speaking && !awaitingCommand) {
      setState("listening", "ESCUCHANDO «JARVIS»");
    }
  }
}

function processAudioFrame(event) {
  if (!listening || audioPaused || audioProcessing || busy || speaking) return;
  const samples = new Float32Array(event.inputBuffer.getChannelData(0));
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  const now = performance.now();
  const threshold = 0.015;

  if (speechStartedAt === 0) {
    preRollFrames.push(samples);
    const maxPreRollFrames = Math.ceil((audioContext.sampleRate * 0.35) / samples.length);
    if (preRollFrames.length > maxPreRollFrames) preRollFrames.shift();
    if (rms < threshold) return;
    speechFrames = [...preRollFrames];
    speechStartedAt = now;
  } else {
    speechFrames.push(samples);
  }

  if (rms >= threshold) {
    lastSpeechAt = now;
    voicedDuration += (samples.length / audioContext.sampleRate) * 1000;
  }
  if (now - speechStartedAt >= 12_000 || (lastSpeechAt && now - lastSpeechAt >= 850)) {
    const frames = speechFrames;
    const sampleRate = audioContext.sampleRate;
    const spokenDuration = voicedDuration;
    resetSpeechFrames();
    preRollFrames = [];
    if (spokenDuration >= 180) void transcribeAudio(frames, sampleRate);
  }
}

async function startGeminiAudioCapture() {
  if (!listening || audioStarting || audioProcessor || !canCaptureAudio) return;
  audioStarting = true;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!listening) {
      audioStream.getTracks().forEach((track) => track.stop());
      audioStream = undefined;
      return;
    }
    audioContext = new AudioContext();
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(audioStream);
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    audioProcessor.onaudioprocess = processAudioFrame;
    source.connect(audioProcessor);
    audioProcessor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    setState("listening", "ESCUCHANDO «JARVIS»");
    privacyNote.textContent =
      "Micrófono activo. Di «Jarvis» seguido de tu pregunta; tu voz se transcribe con Gemini.";
  } catch (error) {
    setListening(false);
    privacyNote.textContent =
      error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
        ? "Permite el acceso al micrófono en los ajustes del navegador y vuelve a activar la escucha."
        : `No pude iniciar el micrófono (${error.message}). Comprueba que esté conectado y que ninguna otra aplicación lo esté usando.`;
  } finally {
    audioStarting = false;
  }
}

function stopGeminiAudioCapture() {
  if (audioProcessor) {
    audioProcessor.onaudioprocess = null;
    audioProcessor.disconnect();
    audioProcessor = undefined;
  }
  silentGain?.disconnect();
  silentGain = undefined;
  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = undefined;
  }
  if (audioContext) {
    void audioContext.close();
    audioContext = undefined;
  }
  audioPaused = false;
  audioStarting = false;
  audioProcessing = false;
  preRollFrames = [];
  resetSpeechFrames();
}

micButton.addEventListener("click", () => {
  if (!voiceSupported) {
    privacyNote.textContent = "La voz no está disponible aquí. Usa Chrome o Edge y abre la aplicación en localhost.";
    return;
  }
  setListening(!listening);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question || busy) return;
  input.value = "";
  askJarvis(question);
});

clearButton.addEventListener("click", () => {
  conversation.length = 0;
  for (const message of messagesElement.querySelectorAll(".message")) message.remove();
  emptyState.hidden = false;
  clearButton.hidden = true;
});

if (hasSpeechRecognition) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = "es-ES";
  recognition.continuous = true;
  recognition.interimResults = true;
  voiceSupported = true;

  recognition.onstart = () => {
    if (listening && !busy && !speaking) {
      setState("listening", "ESCUCHANDO «JARVIS»");
      privacyNote.textContent = "Micrófono activo. Di «Jarvis» seguido de tu pregunta.";
    }
  };

  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0].transcript.trim();
      if (result.isFinal) {
        handleRecognizedText(transcript);
      } else if (transcript && listening && !busy && !speaking) {
        privacyNote.textContent = `Te escucho: «${transcript}»`;
      }
    }
  };

  recognition.onnomatch = () => {
    if (listening && !busy && !speaking) {
      privacyNote.textContent = "No entendí esas palabras. Prueba a decir «Jarvis» seguido de una pregunta.";
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      setListening(false);
      privacyNote.textContent = "Permite el acceso al micrófono en el navegador para activar la escucha.";
    } else if (event.error === "audio-capture") {
      setListening(false);
      privacyNote.textContent = "No se encontró un micrófono. Conéctalo o escribe tu pregunta.";
    } else if (event.error === "network") {
      if (canCaptureAudio && listening && !audioFallback) {
        audioFallback = true;
        recognitionRunning = false;
        privacyNote.textContent =
          "El servicio de voz del navegador no responde. Activando transcripción directa con Gemini…";
        startRecognition();
      } else {
        privacyNote.textContent = "El servicio de voz no está disponible. Comprueba internet o escribe tu pregunta.";
      }
    } else if (event.error === "no-speech") {
      if (listening && !busy && !speaking) {
        privacyNote.textContent = "No detecté voz. Comprueba el micrófono y di «Jarvis» seguido de tu pregunta.";
      }
    } else if (event.error !== "aborted") {
      privacyNote.textContent = `Error de reconocimiento de voz: ${event.error}. Puedes escribir tu pregunta.`;
    }
  };

  recognition.onend = () => {
    recognitionRunning = false;
    startRecognition();
  };
} else if (audioFallback) {
  privacyNote.textContent = "La voz se transcribirá con Gemini cuando digas «Jarvis».";
} else {
  micButton.disabled = true;
  micButton.title = "Este navegador no permite acceder al micrófono.";
  privacyNote.textContent = "El micrófono no está disponible en este navegador. Escribe tu pregunta.";
}

fetch("/api/health")
  .then((response) => response.json())
  .then((status) => {
    if (status.configured) {
      connection.textContent = "IA configurada";
      connectionIndicator.classList.add("is-ready");
    } else {
      connection.textContent = "Falta configurar la IA";
      connectionIndicator.classList.add("is-error");
      privacyNote.textContent = "Añade una clave nueva en GEMINI_API_KEY dentro de .env. Consulta el README.";
    }
  })
  .catch(() => {
    connection.textContent = "Sin conexión al servidor";
    connectionIndicator.classList.add("is-error");
  });
