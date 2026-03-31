import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── CONVERSACIONES ──────────────────────────────────────────

export async function getHistory(phone) {
  const { data } = await supabase
    .from('conversations')
    .select('messages, name')
    .eq('phone', phone)
    .single();
  return { messages: data?.messages || [], name: data?.name || null };
}

export async function saveHistory(phone, messages, name = null) {
  const trimmed = messages.slice(-20); // máx 20 para no exceder contexto
  const update = { phone, messages: trimmed, updated_at: new Date().toISOString() };
  if (name) update.name = name;
  await supabase
    .from('conversations')
    .upsert(update, { onConflict: 'phone' });
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
      schedule_times: med.schedule_times, // ['08:00','16:00','00:00']
      instructions:   med.instructions,
      duration_days:  med.duration_days,
      start_date:     med.start_date || new Date().toISOString().split('T')[0],
      active:         true
    })
    .select()
    .single();
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

export async function deactivateMedication(id) {
  await supabase.from('medications').update({ active: false }).eq('id', id);
}

// Todos los medicamentos activos (para el cron)
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
    .insert({
      phone,
      doctor:    appt.doctor,
      specialty: appt.specialty,
      date_time: appt.date_time,
      location:  appt.location,
      notes:     appt.notes,
      active:    true
    })
    .select()
    .single();
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

export async function getUpcomingAppointments(withinHours = 24) {
  const now = new Date();
  const limit = new Date(now.getTime() + withinHours * 60 * 60 * 1000);
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('active', true)
    .eq('reminded', false)
    .gte('date_time', now.toISOString())
    .lte('date_time', limit.toISOString());
  return data || [];
}

export async function markAppointmentReminded(id) {
  await supabase.from('appointments').update({ reminded: true }).eq('id', id);
}

// ── REGISTRO DE RECORDATORIOS ───────────────────────────────

export async function logReminder(phone, type, referenceId = null) {
  await supabase.from('reminder_log').insert({ phone, type, reference_id: referenceId });
}

// Verifica si ya se envió un recordatorio de medicamento en la última hora
export async function alreadyRemindedToday(phone, type, referenceId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('reminder_log')
    .select('id')
    .eq('phone', phone)
    .eq('type', type)
    .eq('reference_id', referenceId)
    .gte('sent_at', oneHourAgo)
    .limit(1);
  return data && data.length > 0;
}
