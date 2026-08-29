# CLAUDE.md — DDMV-Assistant
_Contexto persistente para Claude Code. No editar manualmente._

---

## ⚠️ GOBERNANZA CC (leer ANTES de tocar nada)

Antes de cualquier acción en este repositorio, Claude Code DEBE cargar y obedecer el protocolo
central: **`unrlvl-context/protocols/CC_PROTOCOL.md`**.

> **Orden de carga — la fuente canónica es el repo, Vercel es respaldo** (`CC_PROTOCOL.md` §0 bis).
> **(1)** `unrealvillestudio-hub/unrlvl-context` — working tree si está clonado, o `api.github.com` /
> `raw.githubusercontent.com`; **(2)** la URL de Vercel, **sólo si el repo no está disponible**, y
> declarándolo. El estático puede ir por detrás de `main` entre el merge y el deploy (`HRD-R09`, `HRD-R14`).
>
> **Cómo se alcanza esa URL de respaldo [medido 2026-08-29, `CC_PROTOCOL.md` §0 bis.1]:** con la tool
> **`Vercel:web_fetch_vercel_url`**, que devuelve **200**. **Nunca con `curl`**, que devuelve **403 en
> CONNECT** contra `*.vercel.app` — el proxy de egreso de CC lo bloquea. Son dos vías distintas y sólo
> una funciona; declarar Vercel inalcanzable tras probar sólo `curl` es afirmar sin medir.
>
> **Carga obligatoria además de `CC_PROTOCOL.md`:** `protocols/MULTIBRAND_RULE.md` y
> `protocols/DELIVERY_AND_VERIFICATION_RULE.md`. Esta última **se carga en la apertura de sesión**, no
> cuando surja la duda: gobierna **cómo se responde**, y una regla de forma que se consulta al final
> llega tarde porque el texto ya está escrito.

**Este archivo NO duplica reglas: apunta.** Si algo aquí parece contradecir un protocolo, manda el
protocolo. Un `CLAUDE.md` que describe el repo se desactualiza; uno que apunta, no.

Recordatorios operativos (no sustituyen al protocolo):
- Siempre rama, nunca `main`. **CC publica la rama y abre el PR. CC nunca mergea.** Sam revisa,
  mergea y borra la rama por **GitHub Web UI**.
- Context files: se actualizan **preservando historia** —lo nuevo al tope, lo anterior archivado bajo
  guard `⛔ NO OPERATIVO`, nunca borrado— (`CC_PROTOCOL.md` §0).
- No commitear secretos, `node_modules/`, `dist/`, `.next/` ni artefactos de build.

**Protocolos de carga obligatoria:** `protocols/CC_PROTOCOL.md` · `protocols/MULTIBRAND_RULE.md` ·
`protocols/DELIVERY_AND_VERIFICATION_RULE.md`.

---

## ENTREGA Y VERIFICACIÓN — INVIOLABLE

**Destinatario declarado.** Todo lo que se entrega cae dentro de un bloque con
encabezado propio: `PARA SAM — [de qué va]` o `PARA CC — [asunto]`. El bloque termina
donde empieza el siguiente encabezado. Un párrafo fuera de un bloque no es una
instrucción: es contexto.

**El diferenciador visual es para que SAM lea, no para que CC ejecute.** La marca
depende de la superficie: en **chat**, cuadrado emoji (verde Sam / naranja CC) más
encabezado grande, porque el markdown no rinde color arbitrario; en **documento, HTML
o UI con estilos**, el carácter `●` con la línea completa en su hex (`#00FFD1` Sam /
`#FFB300` CC). El hex no se escribe dentro de la línea: es especificación.

**Briefs largos se entregan como archivo**, no pegados: un bloque se trunca al copiarlo
y el truncamiento no falla — CC ejecuta lo que le llegó.

**Idioma.** ES neutro internacional o EN neutro internacional, sin excepción, sin
regionalismos y **sin voseo** (el imperativo voseante y el pretérito son homógrafos:
"decidí" es a la vez una orden y un hecho consumado). Aplica a chat, briefs, PRs,
commits, comentarios de código, context files y plantillas de protocolo.

**Evidencia.** Toda afirmación de estado va etiquetada `medido` / `reportado` /
`deducido`. Sin etiqueta se lee como `medido`. Antes de asumir, se consulta.

**Las cuatro QA son HRD RULES, en este orden:**
`QA-ENCARGO` (confirmar que entendí el encargo) → `QA-OBJETIVO` (confirmar el objetivo
con Sam) → `QA-INFO` (**bloqueo**: sin información completa NO se responde; si no hay
forma de obtenerla, se entrega el plan para conseguirla vía Sam o CC) → `QA-PROP`
(comprobar que lo entregado apunta al objetivo validado; cinco preguntas respondidas
por escrito). Un brief sin `QA-PROP` respondida se devuelve.

Fuente única: `unrlvl-context/protocols/DELIVERY_AND_VERIFICATION_RULE.md`.
**No copiar la regla completa aquí: este bloque es un puntero, no una segunda fuente.**
