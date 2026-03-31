import { sendWhatsApp }        from '../lib/twilio.js';
import { generateMedReminder } from '../lib/claude.js';
import {
  getAllActiveMedications,
  getAppointmentsForReminder,
  markAppointmentReminder,
  logReminder, alreadyRemindedToday,
  getProfile
} from '../lib/db.js';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Hora actual en Panamá (UTC-5)
  const now    = new Date();
  const hourPA = ((now.getUTCHours() - 5) + 24) % 24;
  const minPA  = now.getUTCMinutes();
  const timeStr = `${String(hourPA).padStart(2,'0')}:00`;
  const results = { medications: 0, appointments: 0, exercise: 0 };

  try {
    // ── 1. MEDICAMENTOS ─────────────────────────────────
    const meds = await getAllActiveMedications();
    for (const med of meds) {
      if (!med.reminder_on !== false) continue;
      const match = (med.schedule_times || []).some(t => {
        const [h] = t.split(':');
        return `${String(parseInt(h)).padStart(2,'0')}:00` === timeStr;
      });
      if (!match) continue;
      const already = await alreadyRemindedToday(med.phone, 'medication', med.id);
      if (already) continue;
      const { name, botName } = await getProfile(med.phone);
      const msg = generateMedReminder(med, name, botName);
      await sendWhatsApp(`whatsapp:${med.phone}`, msg);
      await logReminder(med.phone, 'medication', med.id);
      results.medications++;
    }

    // ── 2. CITAS — 2 días, 1 día, mismo día (7am Panamá) ─
    if (hourPA === 7) {
      for (const daysAhead of [2, 1, 0]) {
        const { data: appts, col } = await getAppointmentsForReminder(daysAhead);
        for (const appt of appts) {
          const { name, botName } = await getProfile(appt.phone);
          const dateStr = new Date(appt.date_time).toLocaleDateString('es-PA', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: '2-digit', minute: '2-digit', timeZone: 'America/Panama'
          });
          const prefixes = {
            2: `📅 Oye ${name}, pasado mañana tienes cita:`,
            1: `📅 ¡${name}! Mañana tienes cita, no te olvides:`,
            0: `🌅 Buenos días ${name}! Hoy tienes cita:`
          };
          const msg = `${prefixes[daysAhead]}\n\n`
            + `👨‍⚕️ ${appt.specialty || 'Cita médica'}${appt.doctor ? ` — Dr(a). ${appt.doctor}` : ''}\n`
            + `🕐 ${dateStr}\n`
            + (appt.location ? `📍 ${appt.location}\n` : '')
            + `\n_No olvides llevar tu carnet del seguro_ 🪪`;
          await sendWhatsApp(`whatsapp:${appt.phone}`, msg);
          await markAppointmentReminder(appt.id, col);
          results.appointments++;
        }
      }
    }

    // ── 3. EJERCICIOS MENTALES (10am Panamá) ──────────────
    if (hourPA === 10) {
      const phones = [...new Set(meds.map(m => m.phone))];
      const ejercMsgs = [
        (n) => `🧠 ¡Buenos días ${n}! Ya es hora de tus ejercicios mentales.\n\nAbre el Gimnasio Mental y haz aunque sea un jueguito hoy. ¡Tu mente te lo agradecerá! 💪`,
        (n) => `☀️ ¡${n}! ¿Lista para ejercitar la mente?\n\nTu Gimnasio Mental te está esperando 🧠✨`,
        (n) => `🌸 ¡Hola ${n}! Recuerda hacer tus ejercicios mentales hoy. Un poquito cada día hace una gran diferencia 💛`
      ];
      for (const phone of phones) {
        const already = await alreadyRemindedToday(phone, 'exercise', null);
        if (already) continue;
        const { name } = await getProfile(phone);
        const msg = ejercMsgs[Math.floor(Math.random() * ejercMsgs.length)](name);
        await sendWhatsApp(`whatsapp:${phone}`, msg);
        await logReminder(phone, 'exercise');
        results.exercise++;
      }
    }

    res.json({ ok: true, time: `${timeStr} Panamá`, ...results });
  } catch (err) {
    console.error('Cron error:', err);
    res.status(500).json({ error: err.message });
  }
}
