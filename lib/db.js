import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── CONVERSACIONES ──────────────────────────────────────────

export async function getProfile(phone) {
  const { data } = await supabase
    .from('conversations')
    .select('messages, name, bot_name, welcomed')
    .eq('phone', phone)
    .single();
  return {
    messages: data?.messages || [],
    name:     data?.name     || 'Damaris',
    botName:  data?.bot_name || 'Mi Asistente',
    welcomed: data?.welcomed || false
  };
}

export async function saveProfile(phone, updates) {
  const current = updates.messages
    ? { ...updates, messages: updates.messages.slice(-20) }
    : updates;
  await supabase
    .from('conversations')
    .upsert({ phone, ...current, updated_at: new Date().toISOString() },
             { onConflict: 'phone' });
}

// ── MEDICAMENTOS ────────────────────────────────────────────

export async function saveMedication(phone, med) {
  const { data, error } = await supabase
    .from('medications')
    .insert({
      phone,
      name:           med.name,
      dose:           med.dose,
      frequency:      med.frequency,
      schedule_times: med.schedule_times || [],
      instructions:   med.instructions,
      duration_days:  med.duration_days,
      start_date:     med.start_date || new Date().toISOString().split('T')[0],
      active:         true
    })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getMedications(phone) {
  const { data } = await supabase
    .from('medications')
    .select('*')
    .eq('phone', phone)
    .eq('active', true)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getAllActiveMedications() {
  const { data } = await supabase
    .from('medications')
    .select('*')
    .eq('active', true);
  return data || [];
}

// ── CITAS ───────────────────────────────────────────────────

export async function saveAppointment(phone, appt) {
  const { data, error } = await supabase
    .from('appointments')
    .insert({ phone, ...appt, active: true })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getAppointments(phone) {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('phone', phone)
    .eq('active', true)
    .gte('date_time', now)
    .order('date_time', { ascending: true });
  return data || [];
}

// Citas próximas para recordatorios (2 días, 1 día, mismo día)
export async function getAppointmentsForReminder(daysAhead) {
  const now = new Date();
  // Panamá UTC-5
  const panamaOffset = -5 * 60;
  const localNow = new Date(now.getTime() + (panamaOffset - now.getTimezoneOffset()) * 60000);

  const from = new Date(localNow);
  from.setDate(from.getDate() + daysAhead);
  from.setHours(0, 0, 0, 0);

  const to = new Date(from);
  to.setHours(23, 59, 59, 999);

  const col = daysAhead === 2 ? 'reminded_2days' : daysAhead === 1 ? 'reminded_1day' : 'reminded_same';

  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('active', true)
    .eq(col, false)
    .gte('date_time', from.toISOString())
    .lte('date_time', to.toISOString());
  return { data: data || [], col };
}

export async function markAppointmentReminder(id, col) {
  await supabase.from('appointments').update({ [col]: true }).eq('id', id);
}

// ── REMINDER LOG ────────────────────────────────────────────

export async function logReminder(phone, type, referenceId = null) {
  await supabase.from('reminder_log').insert({ phone, type, reference_id: referenceId });
}

export async function alreadyRemindedToday(phone, type, referenceId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const query = supabase
    .from('reminder_log')
    .select('id')
    .eq('phone', phone)
    .eq('type', type)
    .gte('sent_at', oneHourAgo)
    .limit(1);
  if (referenceId) query.eq('reference_id', referenceId);
  const { data } = await query;
  return data && data.length > 0;
}
