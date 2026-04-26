import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// System prompt para Damaris (usuario final)
function getUserPrompt(userName, botName) {
  const nowPA = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const dateStr = nowPA.toLocaleDateString('es-PA', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const timeStr = nowPA.toLocaleTimeString('es-PA', { hour:'2-digit', minute:'2-digit' });

  return `Eres ${botName}, el asistente personal de ${userName}. Vives dentro de WhatsApp.
Fecha y hora actual en Panamá: ${dateStr}, ${timeStr}

IDIOMA: SIEMPRE responde en español, sin excepción alguna.

LO QUE PUEDES HACER:
- Guardar medicamentos y enviar recordatorios automáticos a esas horas exactas ✅
- Guardar citas médicas y avisar 2 días antes, 1 día antes y el mismo día ✅
- Guardar recordatorios personales para cualquier fecha y hora ✅
- Enviar verificaciones periódicas preguntando por medicamentos, citas y actividades ✅
- Responder preguntas y conversar ✅

INSTRUCCIONES ESPECIALES (invisibles para ${userName}):
Para guardar medicamento: [SAVE_MED:{"name":"","dose":"","frequency":"","schedule_times":["08:00"],"instructions":""}]
Para guardar cita: [SAVE_APPT:{"specialty":"","doctor":"","date_time":"ISO8601","location":""}]
Para guardar recordatorio: [SAVE_REMINDER:{"message":"","remind_at":"ISO8601 Panamá"}]

REGLA DE HONESTIDAD:
Nunca prometas algo que no puedes cumplir. Si la fecha u hora no está clara, pregunta antes de confirmar.
Si no sabes algo médico importante, sugiere consultar al médico.

PERSONALIDAD:
- Tuteas siempre a ${userName} — es fundamental para la confianza
- Cálido, paciente, cariñoso — como un familiar de confianza
- Frases cortas y claras
- Positivo y alentador
- Emojis con moderación 💊 📅 ❤️ 🌸

NOMBRE: Si ${userName} dice "a partir de ahora te llamaré [nombre]", confirma y añade [BOT_RENAME:nombre].`;
}

// System prompt para Sam (cuidador)
function getCaregiverPrompt(userName, botName, damarisName, caregiverTimezone = 'Europe/Madrid', caregiverTzLabel = 'España') {
  const nowPA  = new Date();
  const nowCG  = new Date();
  const datePA = nowPA.toLocaleDateString('es-PA', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/Panama' });
  const timePA = nowPA.toLocaleTimeString('es-PA', { hour:'2-digit', minute:'2-digit', timeZone:'America/Panama' });
  const dateCG = nowCG.toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone: caregiverTimezone });
  const timeCG = nowCG.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit', timeZone: caregiverTimezone });

  // Calculate UTC offset for caregiver timezone explicitly
  const offsetMs = nowCG - new Date(nowCG.toLocaleString('en-US', { timeZone: caregiverTimezone }));
  // More reliable: use Intl to get offset
  const cgDate = new Date();
  const cgFormatter = new Intl.DateTimeFormat('en-US', { timeZone: caregiverTimezone, hour: 'numeric', minute: 'numeric', hour12: false, timeZoneName: 'shortOffset' });
  const cgParts = cgFormatter.formatToParts(cgDate);
  const tzNamePart = cgParts.find(p => p.type === 'timeZoneName')?.value || '';

  return `Eres ${botName}, el asistente de ${damarisName}. Estás hablando con ${userName}, que es el cuidador de ${damarisName}.

HORA ACTUAL AHORA MISMO:
- En ${caregiverTzLabel} (${userName}): ${dateCG} a las ${timeCG} ${tzNamePart}
- En Panamá (Damaris): ${datePA} a las ${timePA} UTC-5

REGLA CRÍTICA PARA RECORDATORIOS:
Cuando ${userName} diga "en X minutos" o "a las Y", usa SIEMPRE su hora en ${caregiverTzLabel}.
Para convertir a ISO 8601: la hora ${caregiverTzLabel} mostrada arriba incluye el offset (${tzNamePart}).
Ejemplo: si son las 18:36 ${tzNamePart} y pide "en 10 minutos" → remind_at = "2026-04-25T18:46:00${tzNamePart === 'GMT+2' ? '+02:00' : '+01:00'}"
NUNCA uses UTC-5 ni hora de Panamá para los recordatorios de ${userName}.

IDIOMA: SIEMPRE responde en español.

COMO CUIDADOR, ${userName} PUEDE:
- Crear recordatorios para SÍ MISMO: "recuérdame mañana a las 10am llamar a AIRA" → se lo envías a ${userName} a esa hora
- Crear recordatorios para ${damarisName}: "recuérdale a ${damarisName} mañana a las 9am tomar la pastilla"
- Ver el estado de ${damarisName}: "¿cómo ha respondido ${damarisName} últimamente?"
- Programar una verificación inmediata: "verifica las citas de ${damarisName}"
- Añadir medicamentos o citas para ${damarisName}

INSTRUCCIONES ESPECIALES:
Para recordatorio a ${userName} mismo: [SAVE_REMINDER:{"message":"texto","remind_at":"ISO8601 Panamá"}]
Para recordatorio a ${damarisName}: [REMINDER_FOR_DAMARIS:{"message":"","remind_at":"ISO8601 Panamá"}]
Para verificación inmediata de citas: [TRIGGER_CHECK:{"type":"appointment"}]
Para verificación inmediata de medicamentos: [TRIGGER_CHECK:{"type":"medication"}]

TONO: Directo y cercano con ${userName}. Él es el administrador y también merece su asistente. 😊`;
}

export async function chat(messages, userName, botName, role = 'user', damarisName = 'Damaris', caregiverTimezone = 'Europe/Madrid', caregiverTzLabel = 'España') {
  const system = role === 'caregiver'
    ? getCaregiverPrompt(userName, botName, damarisName, caregiverTimezone, caregiverTzLabel)
    : getUserPrompt(userName, botName);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system,
    messages
  });
  return response.content[0].text;
}

export async function analyzeImage(imageBase64, mediaType, userText = '') {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: `Analiza esta imagen médica. Responde SOLO con JSON:
{"type":"receta"|"medicamento"|"cita"|"otro","medications":[{"name":"","dose":"","frequency":"","schedule_times":["08:00"],"instructions":""}],"appointments":[{"doctor":"","specialty":"","date_time":null,"location":""}],"summary":"resumen tuteado 2-3 líneas"}
${userText ? `Usuario escribió: "${userText}"` : ''}` }
    ]}]
  });
  try { return JSON.parse(response.content[0].text.replace(/```json|```/g,'').trim()); }
  catch { return { type:'otro', medications:[], appointments:[], summary: response.content[0].text }; }
}

// Genera mensaje proactivo de verificación
export async function generateProactiveCheck(checkType, payload, userName, botName) {
  const prompts = {
    medication: () => {
      const med = payload.medication;
      const opts = [
        `💊 Hola ${userName}, ¿cómo estás hoy? Quería preguntarte: ¿ya tomaste el ${med.name}${med.dose ? ` (${med.dose})` : ''}?`,
        `🌸 ¡${userName}! ¿Qué tal te ha ido hoy? Por cierto, ¿tomaste el ${med.name} como te toca?`,
        `❤️ Hola ${userName}, estaba pensando en ti. ¿Cómo te sientes? ¿Ya te tomaste el ${med.name}?`,
      ];
      return opts[Math.floor(Math.random() * opts.length)];
    },
    appointment: () => {
      const appt = payload.appointment;
      const dateStr = new Date(appt.date_time).toLocaleDateString('es-PA', {
        weekday:'long', day:'numeric', month:'long',
        hour:'2-digit', minute:'2-digit', timeZone:'America/Panama'
      });
      return `📅 ${userName}, estaba revisando tu agenda y veo que tienes una cita con ${appt.specialty || 'el médico'}${appt.doctor ? ` — Dr(a). ${appt.doctor}` : ''} el ${dateStr}${appt.location ? ` en ${appt.location}` : ''}. ¿Es correcto?`;
    },
    wellbeing: () => {
      const opts = [
        `🌸 Hola ${userName}, ¿cómo estás hoy? ¿Has podido descansar bien? Cuéntame. ❤️`,
        `☀️ ¡${userName}! ¿Qué tal el día? ¿Necesitas algo? Aquí estoy. 😊`,
        `🌻 Hola ${userName}, solo quería saber cómo te encuentras hoy. ¿Todo bien?`,
      ];
      return opts[Math.floor(Math.random() * opts.length)];
    }
  };
  return prompts[checkType] ? prompts[checkType]() : `Hola ${userName}, ¿cómo estás? ❤️`;
}

export function generateMedReminder(med, userName) {
  const opts = [
    `💊 ¡Hola ${userName}! Es la hora de tomar ${med.name}${med.dose ? ` (${med.dose})` : ''}.${med.instructions ? `\n📝 Recuerda: ${med.instructions}` : ''}\n\nCuando lo hayas tomado dime "ya tomé" ✅`,
    `🔔 ${userName}, no te olvides de tu ${med.name}${med.dose ? ` — ${med.dose}` : ''}. ¡Vamos! 💊`,
    `⏰ Hora del ${med.name}${med.dose ? ` ${med.dose}` : ''}, ${userName}. ¡Cuídate! 🌸`
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}
