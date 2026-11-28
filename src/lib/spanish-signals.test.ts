import { describe, expect, it } from "vitest";
import { analyzeCall } from "./call-health";
import { findMoments, type Turn } from "./call-moment";
import { leadSoundsUrgent } from "./call-recap";
import { isUrgentText } from "./daily-briefing";
import { classifyCall, type CallFacts } from "./missed-call";
import { forcedHandoff, handoffText } from "./sms-ai/rules";
import { foldEs, looksSpanish } from "./spanish-signals";

/**
 * The owner alerts (emergency, asked for a person, wanted to book, urgent
 * message) used to be English word lists. These are the same calls, in Spanish.
 */
const call = (
  caller: string,
  agent = "Gracias por llamar a Plomería Rápida, ¿en qué le puedo ayudar?",
) =>
  analyzeCall({
    transcript: `Agent: ${agent}\nUser: ${caller}\nAgent: Entiendo.`,
    durationSec: 90,
    outcome: "lead",
    hasContact: true,
  });

describe("foldEs", () => {
  it("drops accents and case so one pattern matches every spelling", () => {
    expect(foldEs("INUNDACIÓN en el baño, señor")).toBe("inundacion en el bano, senor");
  });
});

describe("Spanish calls get the same flags as English ones", () => {
  it("emergencies", () => {
    for (const said of [
      "Es una emergencia, hay una fuga de gas",
      "Huele a gas en la cocina",
      "Se reventó un tubo y se está inundando la casa",
      "No tenemos calefacción y hace mucho frío",
      "Mi esposo tiene dolor de pecho",
      "Me quedé afuera de mi casa",
    ]) {
      expect(call(said).problems, said).toContain("possible_emergency");
    }
  });

  it("asking for a person, and staying stuck", () => {
    for (const said of [
      "Quiero hablar con una persona",
      "¿Puedo hablar con el dueño?",
      "¿Estoy hablando con un robot?",
      "Páseme con un representante",
    ]) {
      const h = call(said);
      expect(h.problems, said).toContain("asked_for_human");
      expect(h.problems, said).toContain("stranded_asking_for_human");
    }
  });

  it("swearing", () => {
    expect(call("Esta máquina de mierda no me entiende").problems).toContain("caller_frustrated");
  });

  it("doesn't fire on an ordinary Spanish booking", () => {
    const h = call("Quiero hacer una cita para una limpieza el martes, para una persona");
    expect(h.problems).not.toContain("possible_emergency");
    expect(h.problems).not.toContain("asked_for_human");
    expect(h.problems).not.toContain("caller_frustrated");
  });

  it("counts the AI re-asking in Spanish", () => {
    const ask = "Agent: ¿Me puede dar su nombre?\nUser: Ana\n";
    const h = analyzeCall({
      transcript: ask.repeat(3),
      durationSec: 90,
      outcome: "lead",
      hasContact: true,
    });
    expect(h.problems).toContain("repeated_question");
  });

  it("points at the Spanish line that triggered it", () => {
    const turns: Turn[] = [
      { role: "agent", text: "Gracias por llamar.", startSec: 0 },
      { role: "user", text: "Es una emergencia", startSec: 3 },
    ] as Turn[];
    expect(findMoments(["possible_emergency"], turns)[0]?.turnIndex).toBe(1);
  });
});

describe("urgent messages", () => {
  it("in the alert, the recap and the morning briefing", () => {
    expect(leadSoundsUrgent(null, "Hay una fuga debajo del fregadero, es urgente")).toBe(true);
    expect(leadSoundsUrgent("lo antes posible", null)).toBe(true);
    expect(isUrgentText("Necesita que alguien venga hoy, se inundó el baño")).toBe(true);
    expect(leadSoundsUrgent(null, "Quiere un presupuesto para pintar la cocina")).toBe(false);
    // The Spanish lists must not make English messages louder than before.
    expect(leadSoundsUrgent(null, "Quote for a new gas water heater")).toBe(false);
    expect(leadSoundsUrgent(null, "AC not working, wants a quote")).toBe(false);
  });
});

describe("missed-call text-back sees Spanish booking intent", () => {
  const facts: CallFacts = {
    direction: "inbound",
    outcome: "faq_answered",
    durationSec: 12,
    disconnectionReason: "user_hangup",
    transcript: "Agent: Hola, gracias por llamar.\nUser: Hola, quería hacer una cita para mañana",
    intent: null,
    isSpam: false,
    callerBlocked: false,
    bookedOnCall: false,
    leadOnCall: false,
  };
  it("the same as the English call", () => {
    const en = classifyCall({
      ...facts,
      transcript: "Agent: Hi.\nUser: Hi, I wanted to book an appointment for tomorrow",
    });
    expect(en).toMatchObject({ ok: true });
    expect(classifyCall(facts)).toEqual(en);
  });
});

describe("AI text replies", () => {
  it("hand Spanish emergencies, person requests and sensitive topics to the owner", () => {
    expect(forcedHandoff("¡Emergencia! Se inundó el sótano")).toBe("emergency");
    expect(forcedHandoff("huele a gas en mi casa")).toBe("emergency");
    expect(forcedHandoff("Quiero hablar con una persona por favor")).toBe("human_requested");
    expect(forcedHandoff("¿Me pueden llamar?")).toBe("human_requested");
    expect(forcedHandoff("Me cobraron de más, quiero un reembolso")).toBe("sensitive");
    expect(forcedHandoff("¿Tienen cita el martes para un corte de pelo?")).toBeNull();
  });
  it("answer in Spanish when handing off", () => {
    expect(handoffText("Plomería Rápida", "emergency", "es")).toBe(
      "Plomería Rápida: Si es una emergencia, llame al 911 ahora. También avisé al equipo para que una persona le dé seguimiento.",
    );
    expect(handoffText("Plomería Rápida", "human_requested")).toMatch(/^Plomería Rápida: Thanks/);
  });
  it("looksSpanish is only a tiebreaker for the holding text", () => {
    expect(looksSpanish("Hola, necesito ayuda con mi cita")).toBe(true);
    expect(looksSpanish("¿Tienen algo?")).toBe(true);
    expect(looksSpanish("Can I get a person please")).toBe(false);
  });
});
