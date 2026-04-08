import { sendWhatsApp, downloadMedia } from '../lib/twilio.js';
import { analyzeImage, chat } from '../lib/claude.js';
import {
  getProfile, saveProfile,
  saveMedication, getMedications,
  saveAppointment, getAppointments
} from '../lib/db.js';

export const config = { api: { bodyParser: false } };

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      const params = {};
      new URLSearchParams(data).forEach((v, k) => { params[k] = v; });
      resolve(params);
    });
  });
}

// ── WHITELIST — números autorizados ──────────────────────────────────────────
// Solo estos números pueden interactuar con el agente.
// El bot Twilio (service_role) bypassa esto — solo aplica a mensajes entrantes.
const ALLOWED_NUMBERS = [
  'whatsapp:+50767146920', // Mamá
  'whatsapp:+34654246333', // Sam
];
// ─────────────────────────────────────────────────────────────────────────────

const WELCOME_MSG = (name, botName) =>
`¡Hola! Por ahí me dijeron que te llamas ${name} 🌸
Me presento: soy tu asistente y me llamo "${botName}". Pero si quieres puedes llamarme como tú quieras — solo dime "a partir de ahora te llamaré..." y me lo grabo.
Estoy aquí para ayudarte con tus medicamentos, tus citas médicas, tus ejercicios mentales y con lo que necesites — incluso tus compromisos con la iglesia o cualquier actividad de tu agenda.
Cuando estés lista — hoy, mañana o cuando quieras — puedes enviarme una foto de tus recetas y las guardo automáticamente. Y si ya tomas medicamentos, dímelo y los anoto.
Te enviaré recordatorios dos días antes, un día antes y el mismo día temprano para tus citas. Y a la hora exacta de cada medicamento.
Puedes escribirme o mandarme una nota de voz cuando quieras. ¡Aquí estaré! ❤️`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 1. Parsear body PRIMERO
  const body = await parseBody(req);
  const { From, Body, MediaUrl0, MediaContentType0, NumMedia } = body;

  if (!From) {
    return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
  }

  // 2. Verificar whitelist — rechazar silenciosamente números no autorizados
  if (!ALLOWED_NUMBERS.includes(From)) {
    console.warn(`[BLOCKED] Número no autorizado: ${From}`);
    return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
  }

  const phone    = From.replace('whatsapp:', '');
  const text     = (Body || '').trim();
  const hasMedia = parseInt(NumMedia || '0') > 0;
  const isAudio  = MediaContentType0?.startsWith('audio/');
  const isImage  = MediaContentType0?.startsWith('image/');

  // 3. Procesar mensaje COMPLETAMENTE antes de responder a Twilio
  try {
    const { messages, name, botName, welcomed } = await getProfile(phone);

    // Bienvenida (primer contacto o código join)
    const isJoinCode = /^join\s+/i.test(text);
    if (!welcomed || isJoinCode) {
      await sendWhatsApp(From, WELCOME_MSG(name, botName));
      await saveProfile(phone, { welcomed: true, messages: [] });
      return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
    }

    // Nota de voz — Claude API no soporta audio directamente
    if (hasMedia && isAudio && MediaUrl0) {
      await sendWhatsApp(From, `🎤 ¡Hola ${name}! Escuché que me mandaste un audio, pero por ahora solo puedo leer mensajes de texto. ¿Me lo escribes? Así te entiendo mejor 😊`);
      return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
    }

    // Imagen
    if (hasMedia && isImage && MediaUrl0) {
      await sendWhatsApp(From, `🔍 Revisando la imagen... un momento, ${name}.`);
      const { base64, mediaType } = await downloadMedia(MediaUrl0);
      const result = await analyzeImage(base64, mediaType, text);
      let reply = `📋 Encontré esto:\n${result.summary}\n\n`;
      if (result.medications?.length > 0) {
        for (const med of result.medications) await saveMedication(phone, med);
        reply += `✅ Guardé ${result.medications.length} medicamento(s):\n`;
        result.medications.forEach(m => {
          reply += `• ${m.name} ${m.dose || ''} — ${m.frequency || ''}\n`;
          if (m.schedule_times?.length) reply += `  ⏰ ${m.schedule_times.join(', ')}\n`;
        });
        reply += `\nTe avisaré a esas horas 🔔`;
      }
      if (result.appointments?.length > 0) {
        for (const a of result.appointments) if (a.date_time) await saveAppointment(phone, a);
        reply += `\n📅 Cita(s) guardada(s):\n`;
        result.appointments.forEach(a => {
          reply += `• ${a.specialty || 'Cita'} — Dr(a). ${a.doctor || '?'}\n`;
          if (a.date_time) reply += `  📆 ${fmtDate(a.date_time)}\n`;
        });
      }
      await sendWhatsApp(From, reply);
      await saveProfile(phone, { messages: [...messages,
        { role: 'user', content: '[Foto de receta]' },
        { role: 'assistant', content: reply }]
      });
      return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
    }

    // Texto normal
    if (text) {
      await processText(phone, From, text, name, botName, messages);
    }

  } catch (err) {
    console.error('Webhook error:', err);
    try {
      await sendWhatsApp(From, `⚠️ Tuve un problemita. Intenta de nuevo en un momento.`);
    } catch {}
  }

  // 4. Responder a Twilio AL FINAL (después de todo el procesamiento)
  return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
}

async function processText(phone, From, text, name, botName, messages, logText = null) {
  const lower = text.toLowerCase().trim();

  // Renombrar bot
  const rename = text.match(/(?:a partir de ahora|de ahora en adelante)?\s*te (?:voy a llamar|llam[ao]r[eé]|llamar[eé]s?)\s+(.+)/i)
    || text.match(/(?:tu nombre es|ahora eres)\s+(.+)/i);
  if (rename) {
    const newName = rename[1].trim().replace(/['".,!?]/g, '');
    await saveProfile(phone, { bot_name: newName });
    return sendWhatsApp(From, `¡Me encanta! A partir de ahora soy ${newName} para ti 😊`);
  }

  // Comandos rápidos
  if (/mis medicamentos|qué tomo|pastillas|medicinas/.test(lower)) {
    const meds = await getMedications(phone);
    if (!meds.length) return sendWhatsApp(From, `💊 Aún no tienes medicamentos registrados, ${name}.\n\nEnvíame una foto de tu receta y los agrego 📸`);
    let msg = `💊 Tus medicamentos, ${name}:\n\n`;
    meds.forEach((m, i) => {
      msg += `${i+1}. ${m.name} ${m.dose || ''}\n`;
      if (m.frequency)              msg += `   📋 ${m.frequency}\n`;
      if (m.schedule_times?.length) msg += `   ⏰ ${m.schedule_times.join(', ')}\n`;
      if (m.instructions)           msg += `   📝 ${m.instructions}\n`;
    });
    return sendWhatsApp(From, msg);
  }

  if (/mis citas|próxima cita|citas médicas/.test(lower)) {
    const appts = await getAppointments(phone);
    if (!appts.length) return sendWhatsApp(From, `📅 No tienes citas próximas, ${name}.\n\nEnvíame la foto de tu orden médica y la agrego 📸`);
    let msg = `📅 Tus próximas citas, ${name}:\n\n`;
    appts.forEach((a, i) => {
      msg += `${i+1}. ${a.specialty || 'Cita médica'}\n`;
      if (a.doctor)    msg += `   👨‍⚕️ Dr(a). ${a.doctor}\n`;
      if (a.date_time) msg += `   📆 ${fmtDate(a.date_time)}\n`;
      if (a.location)  msg += `   📍 ${a.location}\n`;
    });
    return sendWhatsApp(From, msg);
  }

  if (/^(ya tomé|ya tome|tomé|tome|lo tomé)$/i.test(lower)) {
    await sendWhatsApp(From, `¡Muy bien, ${name}! ✅ Anotado. ¡Cuídate mucho! 💛`);
    return saveProfile(phone, { messages: [...messages,
      { role: 'user', content: text },
      { role: 'assistant', content: '¡Muy bien! Anotado ✅' }]
    });
  }

  if (/^(ayuda|menú|menu|hola|buenas|buenos días|buenas tardes|buenas noches)$/i.test(lower)) {
    return sendWhatsApp(From, `¡Hola ${name}! 👋 ¿En qué te puedo ayudar?\n\n`
      + `📸 Foto de receta → la analizo y guardo\n`
      + `💊 "Mis medicamentos" → ver todo lo que tomas\n`
      + `📅 "Mis citas" → ver tus próximas citas\n`
      + `🎤 Nota de voz → te escucho también\n`
      + `❓ Cualquier pregunta → aquí estoy`);
  }

  // Chat general con Claude
  const meds  = await getMedications(phone);
  const appts = await getAppointments(phone);
  const ctx = meds.length
    ? `[Contexto: ${name} toma: ${meds.map(m=>`${m.name} ${m.dose||''} ${m.frequency||''}`).join('; ')}]`
    : '';
  const reply = await chat(
    [...messages, { role: 'user', content: ctx ? `${ctx}\n\n${text}` : text }],
    name, botName
  );
  const renameTag = reply.match(/\[BOT_RENAME:(.+?)\]/);
  const cleanReply = reply.replace(/\[BOT_RENAME:.+?\]/g, '').trim();
  if (renameTag) await saveProfile(phone, { bot_name: renameTag[1].trim() });
  await sendWhatsApp(From, cleanReply);
  await saveProfile(phone, {
    messages: [...messages,
      { role: 'user', content: logText || text },
      { role: 'assistant', content: cleanReply }],
    ...(renameTag ? { bot_name: renameTag[1].trim() } : {})
  });
}

function fmtDate(iso) {
  if (!iso) return 'fecha por confirmar';
  return new Date(iso).toLocaleDateString('es-PA', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Panama'
  });
}
