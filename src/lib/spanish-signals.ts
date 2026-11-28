/**
 * The safety words, in Spanish.
 *
 * Every rule that decides whether an owner gets an urgent alert — "may be an
 * emergency", "asked for a person and never got one", "wanted to book and hung
 * up", "hand this text thread to a human now" — was a list of English words.
 * The receptionist answers in Spanish (and we sell that), so a caller who said
 * "es una emergencia, hay una fuga de gas" got a clean report and no alert.
 * Same call in English: an alert within a minute.
 *
 * These lists run on `foldEs(text)`: lowercased, accents stripped (á→a, ñ→n,
 * ü→u), so "inundación", "inundacion" and "INUNDACIÓN" are the same word and
 * plain `\b` word boundaries work. Kept as broad as their English twins, for
 * the same reason: a false positive costs one alert; a false negative is the
 * flooded basement nobody heard about.
 *
 * Pure and client-safe.
 */

/** Lowercase and strip accents so one ASCII pattern matches every spelling. */
export function foldEs(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Caller wants a person (call-health HUMAN_REQUEST twin). */
export const ES_HUMAN_REQUEST =
  /\b(persona real|una persona de verdad|quiero una persona|un humano|ser humano|alguien (real|de verdad)|(hablar|comunicarme|platicar) con (alguien|una persona|un humano|el dueno|la duena|el encargado|la encargada|el gerente|la gerente|un agente|un representante|el jefe|la jefa|otra persona)|operador(a)?|representante|gerente|supervisor(a)?|(eres|es|estoy hablando con) (un |una )?(robot|bot|maquina|grabacion|contestadora|inteligencia artificial|persona real))\b/;

/** Caller swore at the line (call-health PROFANITY twin). */
export const ES_PROFANITY =
  /\b(mierda|carajo|chingad\w*|chingue\w*|pendej\w*|cabron\w*|put[oa]s?|hijo de puta|joder|maldit[oa] (robot|maquina|bot)|robot estupido|maquina estupida)\b/;

/** Possible emergency (call-health EMERGENCY twin). */
export const ES_EMERGENCY =
  /\b(emergencias?|urgencias?|urgente|ahora mismo|fuga de gas|huele a gas|olor a gas|sin calefaccion|no (hay|tengo|tenemos) (calefaccion|agua|luz)|sin agua|inundad[oa]s?|inundacion|se (inundo|esta inundando)|se (reviento|rompio) (un|el|la) (tubo|tuberia|cano)|tuberia rota|tubo roto|fuga (de agua )?por todos lados|incendio|fuego|humo|dolor (de|en el) pecho|no puedo respirar|no puede respirar|sangrando|sangra mucho|inconsciente|desmayad[oa]|ambulancia|911|me quede afuera|nos quedamos afuera|encerrad[oa] afuera|(se metieron|entraron) a robar|robaron|accidente|choque|herid[oa]s?|lastimad[oa]s?|me duele mucho|mucho dolor|hinchazon|hinchad[oa])\b/;

/** Caller was trying to book (missed-call BOOKING_WORDS twin). */
export const ES_BOOKING_WORDS =
  /\b(cita|citas|agendar|programar|reservar|reservacion|apartar|hacer una cita|sacar una cita|cambiar (mi|la) cita|disponibilidad|disponible|horario disponible|turno|me pueden atender)\b/;

/** A message reads as urgent: the owner's alert says EMERGENCY (call-recap LEAD_URGENT twin). */
export const ES_LEAD_URGENT =
  /\b(urgente|urgencia|emergencias?|lo antes posible|cuanto antes|de inmediato|inmediatamente|ahora mismo|hoy|fuga\w*|gotea\w*|inunda\w*|se (reviento|rompio) (un|el|la) (tubo|tuberia|cano))\b/;

/** Worth a phone call today: a bold line in the morning briefing (daily-briefing URGENT_RE twin). */
export const ES_URGENT =
  /\b(urgente|urgencia|emergencias?|lo antes posible|cuanto antes|de inmediato|inmediatamente|ahora mismo|hoy|esta noche|fuga\w*|gotea\w*|inunda\w*|reviento|sin calefaccion|sin agua|(fuga|olor|huele) (de |a )?gas|humo|fuego|incendio|dolor|sangr\w*|hinchazon|me quede afuera|rot[oa]|descompuest[oa]|no funciona)\b/;

/** SMS: emergency words that hand the thread to a person before the model sees it. */
export const ES_SMS_EMERGENCY = [
  /\bemergencias?\b/,
  /\bdolor (de|en el) pecho\b/,
  /\bno (puedo|puede) respirar\b|\bdificultad para respirar\b/,
  /\bsangr(a|ando) mucho\b|\bno (deja|para) de sangrar\b/,
  /\binconsciente\b|\bdesmay\w*\b|\bconvulsion\w*\b|\bderrame cerebral\b|\bsobredosis\b/,
  /\b(suicid\w*|matarme|quitarme la vida|hacerme dano)\b/,
  /\bfuga de gas\b|\b(huele|olor) a gas\b|\bmonoxido de carbono\b/,
  /\b(casa|edificio|cocina) (se esta quemando|en llamas)\b|\bincendio\b/,
  /\binund\w*\b|\b(se reviento|se rompio) (un|el|la) (tubo|tuberia|cano)\b|\baguas negras\b/,
  /\b(dolor|hinchazon|alergia) (muy )?(fuerte|severa?)\b|\banafila\w*\b/,
];

/** SMS: "get me a person". */
export const ES_SMS_HUMAN_REQUEST = [
  /\b(persona real|un humano|ser humano)\b/,
  /\b(hablar|comunicarme|platicar) con (una persona|alguien|un humano|el dueno|la duena|el encargado|la encargada|el gerente|la gerente|el doctor|la doctora|el dentista|la dentista)\b/,
  /\b(eres|es) (un )?(robot|bot|maquina|humano|persona real)\b/,
  /\b(llamame|llameme|me puede(n)? llamar|me llaman)\b/,
];

/** SMS: topics a person should handle (billing, legal, complaints, medical, harm). */
export const ES_SMS_SENSITIVE = [
  /\b(reembolso|devolucion de (mi )?dinero|me cobraron de mas|cobro (doble|indebido)|disputa)\b/,
  /\b(abogad[oa]|demandar\w*|poner una demanda|accion legal|tribunal)\b/,
  /\b(queja|quejarme|terrible|pesimo|inaceptable|groser[oa])\b/,
  /\b(reclamo (al|del) seguro|diagnostic\w*|receta medica|medicamento|dosis|efectos secundarios)\b/,
  /\b(acoso|amenaza\w*|abuso|discrimina\w*)\b/,
  /\b(me lastim\w*|me hirieron|danaron mi|rompieron mi)\b/,
];

/** Does this text read as Spanish? Used only to pick the language of a holding text. */
export function looksSpanish(text: string): boolean {
  const t = foldEs(text);
  if (/[¿¡ñ]/.test(text.toLowerCase())) return true;
  const hits = t.match(
    /\b(hola|gracias|por favor|necesito|quiero|tengo|puede|pueden|usted|cita|ayuda|buenos|buenas|esta|estoy|una|para|con|que|mi|el|la|los|las|hay|no funciona)\b/g,
  );
  return (hits?.length ?? 0) >= 2;
}
