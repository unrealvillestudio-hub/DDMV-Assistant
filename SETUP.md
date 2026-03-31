# Mi Asistente — Guía de Instalación

## Lo que ya está hecho ✅
- Proyecto Supabase **XMMs** creado en `us-east-1`
- Tablas creadas: `conversations`, `medications`, `appointments`, `reminder_log`
- URL: `https://puoybldykxqvhvtnwrld.supabase.co`

---

## Paso 1 — Obtener la Service Key de Supabase

1. Ve a [supabase.com](https://supabase.com) → entra a tu proyecto **XMMs**
2. Settings → API
3. Copia la **service_role key** (la larga, abajo del todo)
4. Guárdala, la necesitarás en el Paso 4

---

## Paso 2 — Crear cuenta Twilio y activar WhatsApp Sandbox

1. Ve a [twilio.com](https://www.twilio.com) → crea cuenta gratuita
2. En el dashboard anota:
   - **Account SID** (empieza con `AC...`)
   - **Auth Token**
3. En el menú izquierdo: **Messaging → Try it out → Send a WhatsApp message**
4. Sigue las instrucciones para **activar el Sandbox**:
   - Te dará un número de WhatsApp (ej: +1 415 523 8886)
   - Desde el teléfono de Damaris, escribe el código que indica (ej: "join silver-fox") a ese número
5. En **Sandbox Settings**, copia el número del sandbox (formato: `whatsapp:+14155238886`)

---

## Paso 3 — Crear repositorio en GitHub

1. Sube todos estos archivos a un repositorio nuevo en GitHub
   - Nombre sugerido: `damaris-bot`
2. Asegúrate de incluir: `api/`, `lib/`, `package.json`, `vercel.json`
3. **NO subas** el archivo `.env` con las claves reales

---

## Paso 4 — Desplegar en Vercel

1. Ve a [vercel.com](https://vercel.com) → **New Project** → importa el repositorio `damaris-bot`
2. En **Environment Variables**, agrega estas variables:

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | Tu API key de Anthropic |
| `SUPABASE_URL` | `https://puoybldykxqvhvtnwrld.supabase.co` |
| `SUPABASE_SERVICE_KEY` | La key del Paso 1 |
| `TWILIO_ACCOUNT_SID` | Del Paso 2 |
| `TWILIO_AUTH_TOKEN` | Del Paso 2 |
| `TWILIO_WHATSAPP_NUMBER` | El número del sandbox (solo dígitos con +) |
| `CRON_SECRET` | Un texto secreto largo cualquiera |

3. Deploy → espera que termine
4. Copia la URL del deploy, ej: `https://damaris-bot.vercel.app`

---

## Paso 5 — Conectar Twilio con tu Vercel

1. En Twilio → **Messaging → Sandbox Settings**
2. En el campo **"When a message comes in"**, escribe:
   ```
   https://damaris-bot.vercel.app/api/webhook
   ```
3. Método: **HTTP POST**
4. Guarda

---

## Paso 6 — Probar ✅

Desde cualquier teléfono que hayas activado en el Sandbox, escribe al número de Twilio:

- `hola` → debe responder con el menú de ayuda
- Envía una foto de la receta de Damaris → la analiza y guarda los medicamentos
- `mis medicamentos` → lista lo guardado
- `mis citas` → lista las citas

---

## Cómo funciona el bot

### Comandos que entiende Damaris:
| Mensaje | Acción |
|---|---|
| `hola` / `ayuda` | Muestra el menú |
| `mis medicamentos` | Lista sus medicamentos activos |
| `mis citas` | Lista sus próximas citas |
| `tomé` | Confirma que tomó su medicamento |
| 📸 foto de receta | Extrae y guarda medicamentos/citas |
| cualquier pregunta | Claude responde con contexto de su salud |

### Recordatorios automáticos (cron cada hora):
- 💊 A la hora de cada medicamento → recordatorio personalizado
- 📅 24h antes de cada cita → aviso de cita
- 🧠 10am hora Panamá → recordatorio de ejercicios mentales

---

## Cuando Twilio Sandbox expire (para uso real)

El sandbox de Twilio expira cada 72h y requiere que cada número se una manualmente.
Para uso permanente: solicita un **número de WhatsApp Business** en Twilio (~$1/mes).
