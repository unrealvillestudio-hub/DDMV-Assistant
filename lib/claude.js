import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres el asistente personal de salud de una señora mayor llamada Damaris, que vive en Panamá. 
La ayudas con sus medicamentos, citas médicas y bienestar general.

PERSONALIDAD:
- Hablas con cariño, paciencia y simplicidad — como lo haría una hija o nieta
- Usas frases cortas y claras, sin términos médicos complicados
- Siempre la llamas por su nombre: Damaris
- Eres positiva y alentadora, nunca alarmista
- Si no sabes algo médico, le dices que consulte a su médico

CAPACIDADES:
- Recordarle sus medicamentos y horarios
- Informarle sobre sus próximas citas
- Responder preguntas simples sobre sus medicamentos (para qué sirve, cómo tomarlo)
- Registrar nuevos medicamentos o citas cuando ella te lo diga

FORMATO DE RESPUESTAS:
- Mensajes cortos, máximo 3-4 líneas por respuesta
- Usa emojis con moderación para que sea más amigable 💊 📅 ❤️
- Si la respuesta es larga, divídela en partes pequeñas

Cuando el usuario te diga que tomó un medicamento, confírmalo con entusiasmo.
Cuando pregunte por sus medicamentos del día, lista solo los de hoy de forma clara.`;

// Chat con historial
export async function chat(messages, userName = 'Damaris') {
  const systemWithName = SYSTEM_PROMPT.replace(/Damaris/g, userName || 'Damaris');
  
  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 500,
    system:     systemWithName,
    messages:   messages
  });
  return response.content[0].text;
}

// Analiza imagen de receta o medicamento
export async function analyzeImage(imageBase64, mediaType, userText = '') {
  const prompt = `Analiza esta imagen. Puede ser una receta médica, caja de medicamento, o blister de pastillas.

Extrae TODA la información disponible y responde SOLO con un JSON válido con esta estructura:
{
  "type": "receta" | "medicamento" | "cita" | "otro",
  "medications": [
    {
      "name": "nombre del medicamento",
      "dose": "dosis (ej: 500mg)",
      "frequency": "frecuencia en texto (ej: cada 8 horas, 3 veces al día)",
      "schedule_times": ["08:00", "14:00", "20:00"],
      "instructions": "instrucciones especiales (ej: con comida, en ayunas)",
      "duration_days": 7
    }
  ],
  "appointments": [
    {
      "doctor": "nombre del doctor",
      "specialty": "especialidad",
      "date_time": "ISO 8601 si hay fecha, null si no",
      "location": "lugar o clínica",
      "notes": "notas adicionales"
    }
  ],
  "summary": "resumen en español simple de lo que encontraste, en 2-3 líneas máximo"
}

Si es un medicamento sin receta, llena solo el array medications.
Si no puedes leer algo claramente, omite ese campo.
${userText ? `El usuario también escribió: "${userText}"` : ''}`;

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        {
          type:   'image',
          source: { type: 'base64', media_type: mediaType, data: imageBase64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const raw = response.content[0].text;
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { type: 'otro', medications: [], appointments: [], summary: raw };
  }
}

// Genera mensaje de recordatorio de medicamento
export async function generateMedReminder(med, userName = 'Damaris') {
  const msgs = [
    `💊 Hola ${userName}! Ya es hora de tomar su *${med.name}*${med.dose ? ` (${med.dose})` : ''}.${med.instructions ? `\n📝 Recuerde: ${med.instructions}` : ''}\n\n_Responda "tomé" cuando lo haya tomado_ ✅`,
    `🔔 ${userName}, es la hora del *${med.name}*${med.dose ? ` — ${med.dose}` : ''}. ¡No se le olvide! 💊${med.instructions ? `\n_${med.instructions}_` : ''}`,
    `⏰ Recordatorio para ${userName}: *${med.name}*${med.dose ? ` ${med.dose}` : ''}${med.instructions ? ` — ${med.instructions}` : ''}. ¡Cuídese mucho! 🌸`
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}
