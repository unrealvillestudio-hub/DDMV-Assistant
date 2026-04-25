import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── PERFILES ────────────────────────────────────────────────

export async function getProfile(phone) {
  const { data } = await supabase
    .from('conversations')
    .select('messages, name, bot_name, welcomed, role, linked_phone')
    .eq('phone', phone)
    .single();
  return {
    messages:     data?.messages     || [],
    name:         data?.name         || 'Damaris',
    botName:      data?.bot_name     || 'Mi Asistente',
    welcomed:     data?.welcomed     || false,
    role:         data?.role         || 'user',
    linkedPhone:  data?.linked_phone || null,
  };
}

export async function saveProfile(phone, updates) {
  const payload = updates.messages
    ? { ...updates, messages: updates.messages.slice(-20) }
    : updates;
  await supabase
    .from('conversations')
    .upsert({ phone, ...payload, updated_at: new Date().toISOString() },
             { onConflict: 'phone' });
}

// ── MEDICAMENTOS ────────────────────────────────────────────

export async function saveMedication(phone, med) {
  const { data, error } = await supabase
    .from('medications')
    .insert({ phone, ...med, active: true })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getMedications(phone) {
  const { data } = await supabase
    .from('medications').select('*')
    .eq('phone', phone).eq('active', true)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getAllActiveMedications() {
  const { data } = await supabase.from('medications').select('*').eq('active', true);
  return data || [];
}

export async function deactivateMedication(id) {
  await supabase.from('medications').update({ active: false }).eq('id', id);
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
    .from('appointments').select('*')
    .eq('phone', phone).eq('active', true)
    .gte('date_time', now)
    .order('date_time', { ascending: true });
  return data || [];
}

export async function deactivateAppointment(id) {
  await supabase.from('appointments').update({ active: false }).eq('id', id);
}

export async function getAppointmentsForReminder(daysAhead) {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() + daysAhead); from.setHours(0,0,0,0);
  const to   = new Date(from); to.setHours(23,59,59,999);
  const col  = daysAhead === 2 ? 'reminded_2days' : daysAhead === 1 ? 'reminded_1day' : 'reminded_same';
  const { data } = await supabase.from('appointments').select('*')
    .eq('active', true).eq(col, false)
    .gte('date_time', from.toISOString()).lte('date_time', to.toISOString());
  return { data: data || [], col };
}

export async function markAppointmentReminder(id, col) {
  await supabase.from('appointments').update({ [col]: true }).eq('id', id);
}

// ── RECORDATORIOS PERSONALES ────────────────────────────────

export async function saveReminder(phone, message, remindAt) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({ phone, message, remind_at: remindAt, sent: false })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getReminders(phone) {
  const now = new Date().toISOString();
  const { data } = await supabase.from('reminders').select('*')
    .eq('phone', phone).eq('sent', false).gte('remind_at', now)
    .order('remind_at', { ascending: true });
  return data || [];
}

export async function getPendingReminders() {
  const now     = new Date();
  const start   = new Date(now.getTime() - 5  * 60 * 1000).toISOString();
  const end     = new Date(now.getTime() + 65 * 60 * 1000).toISOString();
  const { data } = await supabase.from('reminders').select('*')
    .eq('sent', false).gte('remind_at', start).lte('remind_at', end);
  return data || [];
}

export async function markReminderSent(id) {
  await supabase.from('reminders').update({ sent: true }).eq('id', id);
}

// ── FLUJOS CONVERSACIONALES ─────────────────────────────────

export async function createFlow(phone, flowType, payload) {
  const { data, error } = await supabase
    .from('conversation_flows')
    .insert({ phone, flow_type: flowType, state: 'waiting_response', payload })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getActiveFlow(phone) {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('conversation_flows')
    .select('*')
    .eq('phone', phone)
    .eq('state', 'waiting_response')
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

export async function resolveFlow(id) {
  await supabase.from('conversation_flows')
    .update({ state: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', id);
}

export async function updateFlow(id, updates) {
  await supabase.from('conversation_flows').update(updates).eq('id', id);
}

// ── VERIFICACIONES PROACTIVAS ───────────────────────────────

export async function scheduleProactiveCheck(phone, checkType, referenceId, scheduledAt) {
  await supabase.from('proactive_checks')
    .insert({ phone, check_type: checkType, reference_id: referenceId, scheduled_at: scheduledAt, sent: false });
}

// Programa la próxima verificación 2-3 días random desde ahora
export async function scheduleNextCheck(phone, checkType, referenceId = null) {
  const days = 2 + Math.floor(Math.random() * 2); // 2 o 3 días
  const nextAt = new Date();
  nextAt.setDate(nextAt.getDate() + days);
  // Hora entre 9am y 11am hora Panamá
  const hour = 9 + Math.floor(Math.random() * 3);
  nextAt.setUTCHours(hour + 5, 0, 0, 0); // +5 para convertir Panamá a UTC
  await scheduleProactiveCheck(phone, checkType, referenceId, nextAt.toISOString());
  return { days, nextAt };
}

export async function getDueProactiveChecks() {
  const now    = new Date().toISOString();
  const window = new Date(Date.now() + 65 * 60 * 1000).toISOString();
  const { data } = await supabase.from('proactive_checks').select('*')
    .eq('sent', false).lte('scheduled_at', window).gte('scheduled_at',
      new Date(Date.now() - 5 * 60 * 1000).toISOString());
  return data || [];
}

export async function markProactiveCheckSent(id) {
  await supabase.from('proactive_checks').update({ sent: true }).eq('id', id);
}

// ── REMINDER LOG ────────────────────────────────────────────

export async function logReminder(phone, type, referenceId = null) {
  await supabase.from('reminder_log').insert({ phone, type, reference_id: referenceId });
}

export async function alreadyRemindedToday(phone, type, referenceId) {
  const ago = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let q = supabase.from('reminder_log').select('id')
    .eq('phone', phone).eq('type', type).gte('sent_at', ago).limit(1);
  if (referenceId) q = q.eq('reference_id', referenceId);
  const { data } = await q;
  return data && data.length > 0;
}
