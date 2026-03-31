import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

export async function sendWhatsApp(to, message) {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  await client.messages.create({
    from: FROM,
    to:   toFormatted,
    body: message
  });
}

// Descarga imagen de Twilio y la convierte a base64
export async function downloadMedia(mediaUrl) {
  const accountSid  = process.env.TWILIO_ACCOUNT_SID;
  const authToken   = process.env.TWILIO_AUTH_TOKEN;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${credentials}` }
  });

  if (!res.ok) throw new Error(`Error descargando imagen: ${res.status}`);

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer      = await res.arrayBuffer();
  const base64      = Buffer.from(buffer).toString('base64');

  return { base64, mediaType: contentType.split(';')[0] };
}
