/**
 * API unificada del dashboard — protegida con ADMIN_SECRET
 * Rutas: GET/POST /api/admin?resource=conversations|medications|appointments|settings
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function auth(req) {
  const token = req.headers['x-admin-secret'] || req.query.secret;
  return token === process.env.ADMIN_SECRET;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!auth(req)) return res.status(401).json({ error: 'No autorizado' });

  const { resource, id } = req.query;

  try {
    // ── CONVERSACIONES ──────────────────────────────────
    if (resource === 'conversations') {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false });
      return res.json(data || []);
    }

    // ── MEDICAMENTOS ────────────────────────────────────
    if (resource === 'medications') {
      if (req.method === 'GET') {
        const { data } = await supabase
          .from('medications')
          .select('*')
          .order('created_at', { ascending: false });
        return res.json(data || []);
      }
      if (req.method === 'PUT' && id) {
        const { data } = await supabase
          .from('medications')
          .update(req.body)
          .eq('id', id)
          .select()
          .single();
        return res.json(data);
      }
      if (req.method === 'DELETE' && id) {
        await supabase.from('medications').update({ active: false }).eq('id', id);
        return res.json({ ok: true });
      }
    }

    // ── CITAS ───────────────────────────────────────────
    if (resource === 'appointments') {
      if (req.method === 'GET') {
        const { data } = await supabase
          .from('appointments')
          .select('*')
          .eq('active', true)
          .order('date_time', { ascending: true });
        return res.json(data || []);
      }
      if (req.method === 'DELETE' && id) {
        await supabase.from('appointments').update({ active: false }).eq('id', id);
        return res.json({ ok: true });
      }
    }

    // ── CONFIGURACIÓN DE NOTIFICACIONES ─────────────────
    if (resource === 'settings') {
      const phone = req.query.phone;
      if (req.method === 'GET') {
        const { data } = await supabase
          .from('notification_settings')
          .select('*')
          .eq('phone', phone)
          .single();
        return res.json(data || {
          exercise_reminder_on:    true,
          exercise_hour:           10,
          med_reminder_on:         true,
          appointment_reminder_on: true,
          appointment_hours_before: 24
        });
      }
      if (req.method === 'POST') {
        const { data } = await supabase
          .from('notification_settings')
          .upsert({ phone, ...req.body, updated_at: new Date().toISOString() },
                  { onConflict: 'phone' })
          .select()
          .single();
        return res.json(data);
      }
    }

    // ── ENVIAR MENSAJE MANUAL ───────────────────────────
    if (resource === 'send' && req.method === 'POST') {
      const { to, message } = req.body;
      const { sendWhatsApp } = await import('../lib/twilio.js');
      await sendWhatsApp(`whatsapp:${to}`, `👨‍👦 *Sam:* ${message}`);
      return res.json({ ok: true });
    }

    res.status(404).json({ error: 'Recurso no encontrado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
