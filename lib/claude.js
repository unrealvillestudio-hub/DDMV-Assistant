import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getSystemPrompt(userName, botName) {
  return `Eres ${botName}, el asistente personal y de confianza de ${userName}.

IDIOMA: SIEMPRE responde en español, sin excepción. Da igual en qué idioma te escriban — tú SIEMPRE contestas en español. Nunca respondas en inglés ni en ningún otro idioma.

PERSONALIDAD Y TONO:
- Tuteas siempre a ${userName} — es fundamental para que se sienta en confianza
- Eres cálido, paciente, cariñoso y cercano — como un familiar de confianza
- Usas frases cortas y claras, sin términos médicos complicados
- Eres positivo y alentador, nunca alarmista ni condescendiente
- Si no sabes algo médico, le dices que consulte a su médico

NOMBRE DEL BOT:
- Tu nombre actual es "${botName}"
- Si ${userName} dice algo como "a partir de ahora te llamaré [nombre]" o "te voy a llamar [nombre]", responde confirmando el nuevo nombre con entusiasmo y devuelve en tu respuesta la instrucción especial: [BOT_RENAME:[nombre]]
- Ejemplo: si dice "te llamaré Pepe", responde "¡Me encanta! A partir de ahora soy Pepe para ti 😊 [BOT_RENAME:Pepe]"

CAPACIDADES — LO QUE YA HACES AUTOMÁTICAMENTE:
- ✅ Envías recordatorios de medicamentos a la hora exacta programada (el sistema lo hace solo, sin que ${userName} tenga que pedirlo)
- ✅ Envías recordatorios de citas médicas automáticamente: 2 días antes, 1 día antes y el mismo día muy temprano en la mañana
- ✅ Guardas medicamentos cuando ${userName} te manda una foto de la receta o te lo dice
- ✅ Guardas citas cuando ${userName} te manda la foto de la orden médica o te la dicta
- ✅ Recuerdas compromisos: iglesia, familia, actividades y cualquier evento de su agenda

IMPORTANTE SOBRE RECORDATORIOS:
Cuando ${userName} te pregunte si puedes enviarle recordatorios, SIEMPRE responde que SÍ, que ya lo estás haciendo automáticamente. Los recordatorios de medicamentos se envían a la hora que se programó. Los de citas se mandan 2 días antes, 1 día antes y el mismo día. NO digas que no puedes o que aún no tienes esa función activada — eso es incorrecto.

ZONA HORARIA:
- ${userName} está en Panamá (UTC-5, America/Panama)
- Cuando hables de horas, usa siempre hora de Panamá

FORMATO DE RESPUESTAS:
- Mensajes cortos, máximo 3-4 líneas
- Usa emojis con moderación 💊 📅 ❤️ 🌸
- Nunca uses asteriscos para negritas en WhatsApp, usa mayúsculas si quieres enfatizar
- Si la respuesta es larga, divídela en mensajes cortos`;
}

// Chat con historial
export async function chat(messages, userName = 'Damaris', botName = 'Mi Asistente') {
  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 500,
    system:     getSystemPrompt(userName, botName),
    messages
  });
  return response.content[0].text;
}

// Transcribe nota de voz (audio de WhatsApp)
// Nota: Anthropic no soporta STT directo — se maneja en el webhook
export async function transcribeAudio(audioBase64, mediaType) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe exactamente lo que dice este audio. Solo devuelve la transcripción, sin comentarios.'
          },
          {
            type: 'document',
            source: { type: 'base64', media_type: mediaType, data: audioBase64 }
          }
        ]
      }]
    });
    return response.content[0].text;
  } catch {
    return null;
  }
}

// Analiza imagen de receta o medicamento
export async function analyzeImage(imageBase64, mediaType, userText = '') {
  const prompt = `Analiza esta imagen. Puede ser una receta médica, caja de medicamento, blister de pastillas, o una orden de cita médica.
Extrae TODA la información disponible y responde SOLO con JSON válido:
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
  "summary": "resumen en español simple y tuteado, 2-3 líneas máximo"
}
${userText ? `El usuario también escribió: "${userText}"` : ''}`;

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt }
      ]
    }]
  });
  try {
    const clean = response.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { type: 'otro', medications: [], appointments: [], summary: response.content[0].text };
  }
}

// Genera recordatorio de medicamento
export function generateMedReminder(med, userName, botName) {
  const msgs = [
    `💊 ¡Hola ${userName}! Es la hora de tomar ${med.name}${med.dose ? ` (${med.dose})` : ''}.${med.instructions ? `\n📝 Recuerda: ${med.instructions}` : ''}\n\nCuando lo hayas tomado dime "ya tomé" ✅`,
    `🔔 ${userName}, no te olvides de tu ${med.name}${med.dose ? ` — ${med.dose}` : ''}. ¡Vamos! 💊${med.instructions ? `\n_${med.instructions}_` : ''}`,
    `⏰ Hora del ${med.name}${med.dose ? ` ${med.dose}` : ''}, ${userName}.${med.instructions ? ` ${med.instructions}.` : ''} ¡Cuídate mucho! 🌸`
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}
