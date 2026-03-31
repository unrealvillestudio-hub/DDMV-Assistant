import { sendWhatsApp }        from '../lib/twilio.js';
import { generateMedReminder } from '../lib/claude.js';
import {
  getAllActiveMedications,
  getAppointmentsForReminder,
  markAppointmentReminder,
  logReminder, alreadyRemindedToday,
  getProfile
} from '../lib/db.js';

// Saludos de mañana (9am Panamá)
const MORNING_GREETINGS = [
  n => `🌅 ¡Buenos días, ${n}! ¿Cómo amaneciste hoy? Espero que hayas dormido bien y te sientas con energía. ¡Aquí estoy para lo que necesites! 💛`,
  n => `☀️ ¡Buenos días, ${n}! Un nuevo día lleno de posibilidades. ¿Cómo estás hoy? Ya sabes que puedes contar conmigo para lo que sea. ❤️`,
  n => `🌸 ¡Hola ${n}, buenos días! ¿Qué tal amaneciste? Cuéntame cómo te sientes y si hay algo en lo que pueda ayudarte hoy. 😊`,
  n => `✨ ¡Buenos días, ${n}! Espero que hoy sea un día bonito para ti. ¿Hay algo en lo que quieras que te asista? Ya sabes que aquí estoy. 🌻`,
  n => `🌤️ ¡Buenos días, ${n}! ¿Cómo te encuentras esta mañana? Recuerda que puedes escribirme cuando quieras. ¡Para eso estoy! 💪`,
];

// Saludos de tarde (6pm Panamá)
const EVENING_GREETINGS = [
  n => `🌆 ¡Buenas tardes, ${n}! ¿Cómo fue tu día? Espero que haya sido tranquilo y agradable. ¿Hay algo en lo que pueda ayudarte esta tarde? 💛`,
  n => `🌇 ¡Hola ${n}! Ya es tarde — ¿cómo estás? Si necesitas algo o simplemente quieres contarme algo, aquí estoy con toda la atención del mundo. ❤️`,
  n => `🌼 ¡Buenas tardes, ${n}! ¿Qué tal estuvo tu día? Ya sabes que puedes contar conmigo para lo que necesites. ¡No dudes en escribirme! 😊`,
  n => `🍃 ¡Buenas tardes, ${n}! ¿Todo bien por allá? Espero que hayas tenido un día tranquilo. ¿Hay algo en lo que quieras que te asista? 🌸`,
  n => `🌙 ¡Hola ${n}, buenas tardes! Ya queda poco para la noche. ¿Cómo te sientes hoy? Cuéntame, que para eso estoy aquí. 💕`,
];

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Hora actual en Panamá (UTC-5)
  const now    = new Date();
  const hourPA = ((now.getUTCHours() - 5) + 24) % 24;
  const results = { medications: 0, appointments: 0, greetings: 0, exercise: 0 };

  try {
    const allMeds = await getAllActiveMedications();
    const phones  = [...new Set(allMeds.map(m => m.phone))];

    // ── 1. SALUDO DE MAÑANA (9am Panamá) ───────────────
    if (hourPA === 9) {
      for (const phone of phones) {
        const already = await alreadyRemindedToday(phone, 'greeting_morning', null);
        if (already) continue;
        const { name } = await getProfile(phone);
        const msg = MORNING_GREETINGS[Math.floor(Math.random() * MORNING_GREETINGS.length)](name);
        await sendWhatsApp(`whatsapp:${phone}`, msg);
        await logReminder(phone, 'greeting_morning');
        results.greetings++;
      }
    }

    // ── 2. RECORDATORIO DE EJERCICIOS (10am Panamá) ────
    if (hourPA === 10) {
      const msgs = [
        n => `🧠 ¡${n}! ¿Ya hiciste tus ejercicios mentales hoy? Un ratito en el Gimnasio Mental te hará muy bien. ¡Tu mente te lo agradecerá! 💪`,
        n => `☀️ ¡Hola ${n}! Tu Gimnasio Mental te está esperando. Un jueguito al día mantiene la mente activa y feliz. ¡Tú puedes! 🧠✨`,
        n => `🌸 ¡${n}! Recuerda hacer tus ejercicios mentales hoy. Un poquito cada día hace una gran diferencia. ¡Ánimo! 💛`,
      ];
      for (const phone of phones) {
        const already = await alreadyRemindedToday(phone, 'exercise', null);
        if (already) continue;
        const { name } = await getProfile(phone);
        await sendWhatsApp(`whatsapp:${phone}`, msgs[Math.floor(Math.random()*msgs.length)](name));
        await logReminder(phone, 'exercise');
        results.exercise++;
      }
    }

    // ── 3. MEDICAMENTOS ─────────────────────────────────
    const timeStr = `${String(hourPA).padStart(2,'0')}:00`;
    for (const med of allMeds) {
      if (med.reminder_on === false) continue;
      const match = (med.schedule_times || []).some(t => {
        const [h] = t.split(':');
        return `${String(parseInt(h)).padStart(2,'0')}:00` === timeStr;
      });
      if (!match) continue;
      const already = await alreadyRemindedToday(med.phone, 'medication', med.id);
      if (already) continue;
      const { name, botName } = await getProfile(med.phone);
      await sendWhatsApp(`whatsapp:${med.phone}`, generateMedReminder(med, name, botName));
      await logReminder(med.phone, 'medication', med.id);
      results.medications++;
    }

    // ── 4. CITAS — 2 días, 1 día, mismo día (7am) ──────
    if (hourPA === 7) {
      for (const daysAhead of [2, 1, 0]) {
        const { data: appts, col } = await getAppointmentsForReminder(daysAhead);
        for (const appt of appts) {
          const { name } = await getProfile(appt.phone);
          const dateStr = new Date(appt.date_time).toLocaleDateString('es-PA', {
            weekday:'long', day:'numeric', month:'long',
            hour:'2-digit', minute:'2-digit', timeZone:'America/Panama'
          });
          const prefixes = {
            2: `📅 Oye ${name}, pasado mañana tienes cita:`,
            1: `📅 ¡${name}! Mañana tienes cita, no te olvides:`,
            0: `🌅 ¡Buenos días ${name}! Hoy tienes cita:`
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

    // ── 5. SALUDO DE TARDE (6pm Panamá) ────────────────
    if (hourPA === 18) {
      for (const phone of phones) {
        const already = await alreadyRemindedToday(phone, 'greeting_evening', null);
        if (already) continue;
        const { name } = await getProfile(phone);
        const msg = EVENING_GREETINGS[Math.floor(Math.random() * EVENING_GREETINGS.length)](name);
        await sendWhatsApp(`whatsapp:${phone}`, msg);
        await logReminder(phone, 'greeting_evening');
        results.greetings++;
      }
    }

    res.json({ ok: true, hourPA, ...results });

  } catch (err) {
    console.error('Cron error:', err);
    res.status(500).json({ error: err.message });
  }
}
