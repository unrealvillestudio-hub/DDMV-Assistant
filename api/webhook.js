import { sendWhatsApp, downloadMedia } from '../lib/twilio.js';
import { analyzeImage, chat } from '../lib/claude.js';
import {
  getProfile, saveProfile,
  saveMedication, getMedications, deactivateMedication,
  saveAppointment, getAppointments, deactivateAppointment,
  saveReminder, getReminders,
  createFlow, getActiveFlow, resolveFlow, updateFlow,
  scheduleNextCheck
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

const WELCOME = (name, botName) =>
`¡Hola! Por ahí me dijeron que te llamas ${name} 🌸

Me presento: soy tu asistente y me llamo "${botName}". Pero puedes llamarme como quieras — solo dime "a partir de ahora te llamaré..." y me lo grabo.

Estoy aquí para ayudarte con:
💊 Medicamentos — te recuerdo a la hora exacta
📅 Citas médicas — te aviso 2 días antes, 1 día antes y el mismo día
⏰ Recordatorios — "recuérdame mañana a las 10am hacer X" y te escribo
🏥 Compromisos — iglesia, familia, lo que sea
❤️ Simplemente conversar cuando quieras

De vez en cuando te voy a preguntar cómo estás y a verificar tu agenda para mantenerte al día. ¡Aquí estaré siempre! ❤️`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = await parseBody(req);
  const { From, Body, MediaUrl0, MediaContentType0, NumMedia } = body;

  if (!From) return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');

  const phone    = From.replace('whatsapp:', '');
  const text     = (Body || '').trim();
  const hasMedia = parseInt(NumMedia || '0') > 0;
  const isAudio  = MediaContentType0?.startsWith('audio/');
  const isImage  = MediaContentType0?.startsWith('image/');

  try {
    const { messages, name, botName, welcomed, role, linkedPhone } = await getProfile(phone);

    // ── BIENVENIDA ─────────────────────────────────────────
    if (!welcomed || /^join\s+/i.test(text)) {
      await sendWhatsApp(From, WELCOME(name, botName));
      await saveProfile(phone, { welcomed: true, messages: [] });
      return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
    }

    // ── AUDIO ──────────────────────────────────────────────
    if (hasMedia && isAudio) {
      await sendWhatsApp(From, `🎤 ¡${name}! Solo puedo leer texto por ahora. ¿Me lo escribes? 😊`);
      return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
    }

    // ── IMAGEN ─────────────────────────────────────────────
    if (hasMedia && isImage && MediaUrl0) {
      await sendWhatsApp(From, `🔍 Revisando la imagen... un momento, ${name}.`);
      const { base64, mediaType } = await downloadMedia(MediaUrl0);
      const result = await analyzeImage(base64, mediaType, text);
      const targetPhone = role === 'caregiver' ? linkedPhone : phone;
      let reply = `📋 Encontré esto:\n${result.summary}\n\n`;
      if (result.medications?.length > 0) {
        for (const med of result.medications) await saveMedication(targetPhone, med);
        reply += `✅ Guardé ${result.medications.length} medicamento(s).\n¡Enviaré recordatorios a las horas indicadas! 🔔`;
      }
      if (result.appointments?.length > 0) {
        for (const a of result.appointments) if (a.date_time) await saveAppointment(targetPhone, a);
        reply += `\n📅 Cita(s) guardada(s) — avisaré con anticipación 🗓️`;
      }
      await sendWhatsApp(From, reply);
      await saveProfile(phone, { messages:[...messages,{role:'user',content:'[Foto]'},{role:'assistant',content:reply}] });
      return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
    }

    // ── FLUJO ACTIVO (conversación con estado) ─────────────
    if (text) {
      const activeFlow = await getActiveFlow(phone);
      if (activeFlow) {
        await handleFlowResponse(phone, From, text, name, botName, activeFlow, messages);
        return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
      }
    }

    // ── TEXTO ──────────────────────────────────────────────
    if (text) {
      if (role === 'caregiver') {
        await processCaregiverText(phone, From, text, name, botName, messages, linkedPhone);
      } else {
        await processUserText(phone, From, text, name, botName, messages, role);
      }
    }

  } catch (err) {
    console.error('Webhook error:', err);
    await sendWhatsApp(From, `⚠️ Tuve un problemita. Intenta de nuevo en un momento.`).catch(()=>{});
  }

  return res.status(200).setHeader('Content-Type','text/xml').end('<Response></Response>');
}

// ── MANEJO DE FLUJOS CONVERSACIONALES ──────────────────────

async function handleFlowResponse(phone, From, text, name, botName, flow, messages) {
  const lower = text.toLowerCase().trim();
  const yes = /^(sí|si|yes|correcto|ok|está bien|claro|por supuesto|afirmativo)$/i.test(lower);
  const no  = /^(no|incorrecto|falso|negativo|no es así)$/i.test(lower);

  if (flow.flow_type === 'verify_appointment') {
    const appt = flow.payload.appointment;

    if (flow.payload.step === 'confirm') {
      if (yes) {
        // Confirmar — programar siguiente verificación
        await resolveFlow(flow.id);
        await scheduleNextCheck(phone, 'appointment', appt.id);
        await sendWhatsApp(From, `✅ Perfecto, ${name}. La cita está confirmada en mi agenda. ¡Te avisaré con anticipación! 📅`);
      } else if (no) {
        // Negar — preguntar si eliminar
        await updateFlow(flow.id, { payload: { ...flow.payload, step: 'delete_confirm' } });
        const dateStr = fmtDate(appt.date_time);
        await sendWhatsApp(From, `Entendido. ¿Entonces elimino la cita del ${dateStr}?`);
      } else {
        await sendWhatsApp(From, `Perdona ${name}, no entendí bien. ¿La cita es correcta? Responde "sí" o "no". 😊`);
      }
    } else if (flow.payload.step === 'delete_confirm') {
      if (yes) {
        await deactivateAppointment(appt.id);
        await resolveFlow(flow.id);
        // Preguntar por más citas
        const remaining = await getAppointments(phone);
        const month = new Date(appt.date_time).toLocaleDateString('es-PA', { month:'long' });
        if (remaining.length === 0) {
          await sendWhatsApp(From, `🗑️ Listo, eliminé esa cita. No tienes más citas agendadas. ¿Tienes alguna pendiente que quieras que anote? 📅`);
        } else {
          await sendWhatsApp(From, `🗑️ Listo, eliminé esa cita. No tengo más citas en ${month}. ¿Tienes alguna otra que quieras que anote?`);
        }
      } else {
        await resolveFlow(flow.id);
        await scheduleNextCheck(phone, 'appointment', appt.id);
        await sendWhatsApp(From, `De acuerdo ${name}, dejo la cita como está. ✅`);
      }
    }
    return;
  }

  if (flow.flow_type === 'verify_medication') {
    const med = flow.payload.medication;

    if (flow.payload.step === 'taken') {
      if (yes) {
        await resolveFlow(flow.id);
        await scheduleNextCheck(phone, 'medication', med.id);
        await sendWhatsApp(From, `¡Muy bien, ${name}! ✅ Cuídate mucho. 💛`);
      } else if (no) {
        // Ofrecer recordatorio en 30 minutos
        await updateFlow(flow.id, { payload: { ...flow.payload, step: 'schedule_reminder' } });
        await sendWhatsApp(From, `Tranquila, ${name}. ¿Quieres que te recuerde en 30 minutos? ⏰`);
      } else {
        await sendWhatsApp(From, `${name}, ¿tomaste el ${med.name}? Responde "sí" o "no". 😊`);
      }
    } else if (flow.payload.step === 'schedule_reminder') {
      if (yes) {
        const in30 = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await saveReminder(phone, `💊 Hora de tomar el ${med.name}${med.dose ? ` (${med.dose})` : ''}`, in30);
        await resolveFlow(flow.id);
        await scheduleNextCheck(phone, 'medication', med.id);
        await sendWhatsApp(From, `⏰ Perfecto, te recuerdo en 30 minutos. ¡Cuídate! 💛`);
      } else {
        await resolveFlow(flow.id);
        await scheduleNextCheck(phone, 'medication', med.id);
        await sendWhatsApp(From, `De acuerdo ${name}. Recuerda tomarlo cuando puedas. ❤️`);
      }
    }
    return;
  }

  if (flow.flow_type === 'verify_wellbeing') {
    // Respuesta libre — guardar en historial y continuar conversación
    await resolveFlow(flow.id);
    await scheduleNextCheck(phone, 'wellbeing');
    await processUserText(phone, From, text, name, botName, messages, 'user');
  }
}

// ── PROCESAMIENTO TEXTO USUARIO (Damaris) ──────────────────

async function processUserText(phone, From, text, name, botName, messages) {
  const lower = text.toLowerCase().trim();

  // Rename
  const rename = text.match(/(?:a partir de ahora|de ahora en adelante)?\s*te (?:voy a llamar|llam[ao]r[eé])\s+(.+)/i);
  if (rename) {
    const newName = rename[1].trim().replace(/['".,!?]/g,'');
    await saveProfile(phone, { bot_name: newName });
    return sendWhatsApp(From, `¡Me encanta! A partir de ahora soy ${newName} para ti 😊`);
  }

  if (/mis medicamentos|qué tomo|pastillas/.test(lower)) {
    const meds = await getMedications(phone);
    if (!meds.length) return sendWhatsApp(From, `💊 No tienes medicamentos registrados, ${name}.\n\nDime qué tomas o envíame una foto de tu receta 📸`);
    let msg = `💊 Tus medicamentos, ${name}:\n\n`;
    meds.forEach((m,i) => { msg += `${i+1}. ${m.name} ${m.dose||''}\n   ⏰ ${(m.schedule_times||[]).join(', ')}\n`; });
    return sendWhatsApp(From, msg);
  }

  if (/mis citas|próxima cita/.test(lower)) {
    const appts = await getAppointments(phone);
    if (!appts.length) return sendWhatsApp(From, `📅 No tienes citas próximas, ${name}.`);
    let msg = `📅 Tus citas, ${name}:\n\n`;
    appts.forEach((a,i) => { msg += `${i+1}. ${a.specialty||'Cita'}\n   📆 ${fmtDate(a.date_time)}\n`; });
    return sendWhatsApp(From, msg);
  }

  if (/mis recordatorios/.test(lower)) {
    const rems = await getReminders(phone);
    if (!rems.length) return sendWhatsApp(From, `⏰ No tienes recordatorios pendientes, ${name}.`);
    let msg = `⏰ Tus recordatorios, ${name}:\n\n`;
    rems.forEach((r,i) => { msg += `${i+1}. ${r.message}\n   📆 ${fmtDate(r.remind_at)}\n`; });
    return sendWhatsApp(From, msg);
  }

  if (/^(ya tomé|ya tome|tomé|tome)$/i.test(lower)) {
    await sendWhatsApp(From, `¡Muy bien, ${name}! ✅ ¡Cuídate! 💛`);
    return saveProfile(phone, { messages:[...messages,{role:'user',content:text},{role:'assistant',content:'✅'}] });
  }

  if (/^(hola|ayuda|menú|menu|buenas)$/i.test(lower)) {
    return sendWhatsApp(From, `¡Hola ${name}! 👋\n\n💊 "Mis medicamentos"\n📅 "Mis citas"\n⏰ "Mis recordatorios"\n❓ Cualquier pregunta → aquí estoy`);
  }

  // Chat con Claude
  const meds  = await getMedications(phone);
  const appts = await getAppointments(phone);
  const ctx = meds.length ? `[${name} toma: ${meds.map(m=>`${m.name} ${m.dose||''}`).join(', ')}. Citas: ${appts.map(a=>`${a.specialty} el ${fmtDate(a.date_time)}`).join('; ')||'ninguna'}]` : '';

  const reply = await chat(
    [...messages, { role:'user', content: ctx ? `${ctx}\n\n${text}` : text }],
    name, botName, 'user'
  );

  let cleanReply = reply;
  const renameTag = reply.match(/\[BOT_RENAME:(.+?)\]/);
  if (renameTag) { await saveProfile(phone, { bot_name: renameTag[1].trim() }); cleanReply = cleanReply.replace(/\[BOT_RENAME:.+?\]/g,'').trim(); }

  const saveMedTag = reply.match(/\[SAVE_MED:(\{.+?\})\]/s);
  if (saveMedTag) { try { await saveMedication(phone, JSON.parse(saveMedTag[1])); } catch(e){} cleanReply = cleanReply.replace(/\[SAVE_MED:.+?\]/s,'').trim(); }

  const saveApptTag = reply.match(/\[SAVE_APPT:(\{.+?\})\]/s);
  if (saveApptTag) { try { const a=JSON.parse(saveApptTag[1]); if(a.date_time) await saveAppointment(phone,a); } catch(e){} cleanReply = cleanReply.replace(/\[SAVE_APPT:.+?\]/s,'').trim(); }

  const saveRemTag = reply.match(/\[SAVE_REMINDER:(\{.+?\})\]/s);
  if (saveRemTag) { try { const r=JSON.parse(saveRemTag[1]); await saveReminder(phone, r.message, r.remind_at); } catch(e){} cleanReply = cleanReply.replace(/\[SAVE_REMINDER:.+?\]/s,'').trim(); }

  await sendWhatsApp(From, cleanReply);
  await saveProfile(phone, { messages:[...messages,{role:'user',content:text},{role:'assistant',content:cleanReply}], ...(renameTag?{bot_name:renameTag[1].trim()}:{}) });
}

// ── PROCESAMIENTO TEXTO CUIDADOR (Sam) ─────────────────────

async function processCaregiverText(phone, From, text, name, botName, messages, damarisPhone) {
  const lower = text.toLowerCase().trim();

  // "recuérdale a Damaris..."
  const remDamaris = text.match(/recuérda(?:le|la)\s+a\s+\w+\s+(.+)/i)
    || text.match(/dile\s+a\s+\w+\s+que\s+(.+)/i);

  const reply = await chat(
    [...messages, { role:'user', content: text }],
    name, botName, 'caregiver', 'Damaris'
  );

  let cleanReply = reply;

  // Recordatorio para Damaris
  const remTag = reply.match(/\[REMINDER_FOR_DAMARIS:(\{.+?\})\]/s);
  if (remTag && damarisPhone) {
    try {
      const r = JSON.parse(remTag[1]);
      await saveReminder(damarisPhone, r.message, r.remind_at);
      cleanReply = cleanReply.replace(/\[REMINDER_FOR_DAMARIS:.+?\]/s,'').trim();
    } catch(e) { console.error('REMINDER_FOR_DAMARIS error', e); }
  }

  // Trigger verificación inmediata
  const triggerTag = reply.match(/\[TRIGGER_CHECK:(\{.+?\})\]/s);
  if (triggerTag && damarisPhone) {
    try {
      const { type } = JSON.parse(triggerTag[1]);
      if (type === 'appointment') {
        const appts = await getAppointments(damarisPhone);
        if (appts.length > 0) {
          const appt = appts[0];
          const msg = `📅 Damaris, estaba revisando tu agenda y veo que tienes cita con ${appt.specialty||'el médico'}${appt.doctor?` — Dr(a). ${appt.doctor}`:''} el ${fmtDate(appt.date_time)}${appt.location?` en ${appt.location}`:''}.¿Es correcto?`;
          await sendWhatsApp(`whatsapp:${damarisPhone}`, msg);
          await createFlow(damarisPhone, 'verify_appointment', { appointment: appt, step: 'confirm' });
        }
      }
      cleanReply = cleanReply.replace(/\[TRIGGER_CHECK:.+?\]/s,'').trim();
    } catch(e) { console.error('TRIGGER_CHECK error', e); }
  }

  await sendWhatsApp(From, cleanReply);
  await saveProfile(phone, { messages:[...messages,{role:'user',content:text},{role:'assistant',content:cleanReply}] });
}

function fmtDate(iso) {
  if (!iso) return 'fecha por confirmar';
  return new Date(iso).toLocaleDateString('es-PA', {
    weekday:'long', day:'numeric', month:'long',
    hour:'2-digit', minute:'2-digit', timeZone:'America/Panama'
  });
}
