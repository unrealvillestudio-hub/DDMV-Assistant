import { sendWhatsApp, downloadMedia } from '../lib/twilio.js';
import { analyzeImage, chat }          from '../lib/claude.js';
import {
  getHistory, saveHistory,
  saveMedication, getMedications,
  saveAppointment, getAppointments
} from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Responde a Twilio inmediatamente para evitar timeout
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send('<Response></Response>');

  const { From, Body, MediaUrl0, MediaContentType0, NumMedia } = req.body;
  const phone   = From.replace('whatsapp:', '');
  const text    = (Body || '').trim();
  const hasMedia = parseInt(NumMedia || '0') > 0;

  try {
    const { messages: history, name } = await getHistory(phone);
    const userName = name || 'Damaris';

    // ── IMAGEN: receta o medicamento ───────────────────────
    if (hasMedia && MediaUrl0) {
      await sendWhatsApp(From, `🔍 Revisando la imagen, ${userName}... un momento.`);

      const { base64, mediaType } = await downloadMedia(MediaUrl0);
      const result = await analyzeImage(base64, mediaType, text);

      let reply = `📋 *Encontré esto:*\n${result.summary}\n\n`;

      // Guardar medicamentos detectados
      if (result.medications?.length > 0) {
        for (const med of result.medications) {
          await saveMedication(phone, med);
        }
        reply += `✅ *${result.medications.length} medicamento(s) guardado(s):*\n`;
        result.medications.forEach(m => {
          reply += `• *${m.name}* ${m.dose || ''} — ${m.frequency || ''}\n`;
          if (m.schedule_times?.length > 0) {
            reply += `  ⏰ Horarios: ${m.schedule_times.join(', ')}\n`;
          }
        });
        reply += `\n_Le enviaré recordatorios a esas horas_ 🔔`;
      }

      // Guardar citas detectadas
      if (result.appointments?.length > 0) {
        for (const appt of result.appointments) {
          if (appt.date_time) await saveAppointment(phone, appt);
        }
        reply += `\n📅 *Cita(s) encontrada(s):*\n`;
        result.appointments.forEach(a => {
          reply += `• Dr(a). ${a.doctor || '?'} — ${a.specialty || ''}\n`;
          if (a.date_time) reply += `  📆 ${formatDate(a.date_time)}\n`;
          if (a.location)  reply += `  📍 ${a.location}\n`;
        });
      }

      await sendWhatsApp(From, reply);

      // Actualizar historial
      const updated = [...history,
        { role: 'user', content: '[Envió una imagen de receta/medicamento]' },
        { role: 'assistant', content: reply }
      ];
      await saveHistory(phone, updated, userName);
      return;
    }

    // ── COMANDOS RÁPIDOS ───────────────────────────────────
    const lower = text.toLowerCase();

    if (lower.includes('mis medicamentos') || lower.includes('qué tomo') || lower.includes('pastillas')) {
      const meds = await getMedications(phone);
      if (meds.length === 0) {
        await sendWhatsApp(From, `💊 ${userName}, aún no tiene medicamentos registrados.\n\nEnvíeme una foto de su receta y los agrego automáticamente 📸`);
      } else {
        let msg = `💊 *Sus medicamentos activos, ${userName}:*\n\n`;
        meds.forEach((m, i) => {
          msg += `${i + 1}. *${m.name}* ${m.dose || ''}\n`;
          if (m.frequency) msg += `   📋 ${m.frequency}\n`;
          if (m.schedule_times?.length > 0) msg += `   ⏰ ${m.schedule_times.join(', ')}\n`;
          if (m.instructions)  msg += `   📝 ${m.instructions}\n`;
        });
        await sendWhatsApp(From, msg);
      }
      return;
    }

    if (lower.includes('mis citas') || lower.includes('próxima cita') || lower.includes('citas')) {
      const appts = await getAppointments(phone);
      if (appts.length === 0) {
        await sendWhatsApp(From, `📅 ${userName}, no tiene citas próximas registradas.\n\nEnvíeme una foto de su orden médica y la agrego 📸`);
      } else {
        let msg = `📅 *Sus próximas citas, ${userName}:*\n\n`;
        appts.forEach((a, i) => {
          msg += `${i + 1}. *${a.specialty || 'Cita médica'}*\n`;
          if (a.doctor)    msg += `   👨‍⚕️ Dr(a). ${a.doctor}\n`;
          if (a.date_time) msg += `   📆 ${formatDate(a.date_time)}\n`;
          if (a.location)  msg += `   📍 ${a.location}\n`;
        });
        await sendWhatsApp(From, msg);
      }
      return;
    }

    if (lower === 'tomé' || lower === 'tome' || lower === 'tomé ✅' || lower.startsWith('ya tomé') || lower.startsWith('ya tome')) {
      await sendWhatsApp(From, `¡Muy bien, ${userName}! ✅ Anotado. Cuídese mucho. 💛`);
      const updated = [...history,
        { role: 'user', content: text },
        { role: 'assistant', content: `¡Muy bien, ${userName}! Anotado. ✅` }
      ];
      await saveHistory(phone, updated, userName);
      return;
    }

    if (lower === 'ayuda' || lower === 'menu' || lower === 'menú' || lower === 'hola') {
      const msg = `👋 Hola ${userName}! Soy su asistente de salud. Le puedo ayudar con:\n\n`
        + `📸 *Foto de receta* → la analizo y guardo sus medicamentos\n`
        + `💊 *"Mis medicamentos"* → ver todo lo que toma\n`
        + `📅 *"Mis citas"* → ver sus próximas citas\n`
        + `❓ *Cualquier pregunta* → la respondo con gusto\n\n`
        + `_También le enviaré recordatorios a la hora de sus medicamentos_ 🔔`;
      await sendWhatsApp(From, msg);
      return;
    }

    // ── CHAT GENERAL CON CLAUDE ─────────────────────────────
    const meds  = await getMedications(phone);
    const appts = await getAppointments(phone);

    // Contexto de salud para Claude
    const contextMsg = meds.length > 0
      ? `[Contexto: ${userName} toma: ${meds.map(m => `${m.name} ${m.dose || ''} ${m.frequency || ''}`).join('; ')}. Próximas citas: ${appts.length > 0 ? appts.map(a => `${a.specialty} el ${formatDate(a.date_time)}`).join('; ') : 'ninguna'}]`
      : '';

    const messages = [
      ...history,
      { role: 'user', content: contextMsg ? `${contextMsg}\n\n${text}` : text }
    ];

    const reply = await chat(messages, userName);
    await sendWhatsApp(From, reply);

    const updated = [...history,
      { role: 'user',      content: text  },
      { role: 'assistant', content: reply }
    ];
    await saveHistory(phone, updated, userName);

  } catch (err) {
    console.error('Webhook error:', err);
    await sendWhatsApp(From, '⚠️ Tuve un pequeño problema. Por favor intente de nuevo en un momento.').catch(() => {});
  }
}

function formatDate(iso) {
  if (!iso) return 'fecha por confirmar';
  const d = new Date(iso);
  return d.toLocaleDateString('es-PA', {
    weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
