import { sendWhatsApp }          from '../lib/twilio.js';
import { generateMedReminder }   from '../lib/claude.js';
import {
  getAllActiveMedications,
  getUpcomingAppointments,
  markAppointmentReminded,
  logReminder, alreadyRemindedToday,
  getHistory
} from '../lib/db.js';

// Vercel llama a este endpoint cada hora (configurado en vercel.json)
export default async function handler(req, res) {
  // Solo Vercel Cron puede llamar esto
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now     = new Date();
  const hourUTC = now.getUTCHours();
  // Panamá es UTC-5
  const hourPA  = ((hourUTC - 5) + 24) % 24;
  const timeStr = `${String(hourPA).padStart(2, '0')}:00`;

  const results = { medications: 0, appointments: 0, exercise: 0 };

  try {
    // ── 1. RECORDATORIOS DE MEDICAMENTOS ───────────────────
    const meds = await getAllActiveMedications();

    for (const med of meds) {
      const times = med.schedule_times || [];
      const match = times.some(t => {
        const [h, m] = t.split(':');
        const mHour = `${String(parseInt(h)).padStart(2,'0')}:00`;
        return mHour === timeStr;
      });

      if (!match) continue;

      const alreadySent = await alreadyRemindedToday(med.phone, 'medication', med.id);
      if (alreadySent) continue;

      const { name } = await getHistory(med.phone);
      const message  = await generateMedReminder(med, name || 'Damaris');

      await sendWhatsApp(`whatsapp:${med.phone}`, message);
      await logReminder(med.phone, 'medication', med.id);
      results.medications++;
    }

    // ── 2. RECORDATORIO DE CITAS (24h antes) ───────────────
    const appts = await getUpcomingAppointments(24);

    for (const appt of appts) {
      const { name } = await getHistory(appt.phone);
      const userName = name || 'Damaris';
      const dateStr  = new Date(appt.date_time).toLocaleDateString('es-PA', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit'
      });

      const message = `📅 *Recordatorio de cita, ${userName}*\n\n`
        + `Mañana tiene cita con:\n`
        + `👨‍⚕️ *${appt.specialty || 'Médico'}*${appt.doctor ? ` — Dr(a). ${appt.doctor}` : ''}\n`
        + `🕐 *${dateStr}*\n`
        + (appt.location ? `📍 *${appt.location}*\n` : '')
        + `\n_No olvide llevar su carnet del seguro_ 🪪`;

      await sendWhatsApp(`whatsapp:${appt.phone}`, message);
      await markAppointmentReminded(appt.id);
      results.appointments++;
    }

    // ── 3. RECORDATORIO DIARIO DE EJERCICIOS MENTALES ──────
    // Se envía a las 10am hora Panamá
    if (hourPA === 10) {
      const meds2 = await getAllActiveMedications();
      const phones = [...new Set(meds2.map(m => m.phone))];

      const ejerciciosMsgs = [
        `🧠 ¡Buenos días! Ya es hora de sus ejercicios mentales.\n\nAbra el Gimnasio Mental y haga aunque sea un jueguito hoy. ¡Su mente se lo agradecerá! 💪`,
        `☀️ ¡Buen día! ¿Lista para ejercitar la mente hoy?\n\nSu Gimnasio Mental la está esperando 🧠✨`,
        `🌸 ¡Hola! Recuerde hacer sus ejercicios mentales hoy. Un poquito cada día hace una gran diferencia 💛`
      ];

      for (const phone of phones) {
        const { name } = await getHistory(phone);
        const userName = name || 'Damaris';
        const msg = ejerciciosMsgs[Math.floor(Math.random() * ejerciciosMsgs.length)]
          .replace('¡Buenos días!', `¡Buenos días, ${userName}!`)
          .replace('¡Buen día!', `¡Buen día, ${userName}!`)
          .replace('¡Hola!', `¡Hola, ${userName}!`);

        const alreadySent = await alreadyRemindedToday(phone, 'exercise', null);
        if (!alreadySent) {
          await sendWhatsApp(`whatsapp:${phone}`, msg);
          await logReminder(phone, 'exercise');
          results.exercise++;
        }
      }
    }

    res.json({ ok: true, time: timeStr, ...results });

  } catch (err) {
    console.error('Cron error:', err);
    res.status(500).json({ error: err.message });
  }
}
