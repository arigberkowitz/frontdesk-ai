import { describe, expect, it } from "vitest";
import { offerText, rescheduledText, cancelledText, slotGoneText, parseRebookReply } from "@/lib/rebook";
import { reviewRequestBody } from "@/lib/review-requests";
import { waitlistOfferBody, describeOpening } from "@/lib/waitlist";
import { depositRequestBody } from "@/lib/deposits";
import { callbackText } from "@/lib/missed-call";

/**
 * Spanish versions of the follow-up texts, used when the customer spoke
 * Spanish (same switch as confirmations/reminders). Automated ones keep the
 * opt-out line; STOP stays in English because it's the carrier keyword.
 */
const STOP_ES = "Responda STOP para no recibir más mensajes.";
const tz = "America/Los_Angeles";
const b = "Joe's Plumbing";
const slot = (iso: string) => ({ startAt: new Date(iso) }) as never;

describe("Spanish texts", () => {
  it("rebook offer", () => {
    const t = offerText({
      businessName: b,
      serviceName: null,
      oldStartAt: new Date("2026-11-05T17:00:00Z"),
      slots: [slot("2026-11-06T17:00:00Z"), slot("2026-11-06T21:30:00Z")],
      tz,
      language: "es",
    });
    expect(t).toBe(
      "Joe's Plumbing: Lo sentimos, tenemos que mover su cita del jue, 5 de nov, 9:00 a.m. ¿Le funciona alguno de estos horarios?\n" +
        "1) vie, 6 de nov, 9:00 a.m.\n2) vie, 6 de nov, 1:30 p.m.\n" +
        `Responda 1 o 2 para cambiarla, o NO para cancelar. ${STOP_ES}`,
    );
    expect(t).not.toContain("..");
  });

  it("rebook replies", () => {
    expect(rescheduledText({ businessName: b, startAt: new Date("2026-11-06T17:00:00Z"), tz, language: "es" })).toBe(
      "Joe's Plumbing: ¡Listo! Su cita quedó para el vie, 6 de nov, 9:00 a.m. ¡Gracias por su flexibilidad!",
    );
    expect(cancelledText({ businessName: b, language: "es" })).toBe(
      "Joe's Plumbing: Entendido, su cita quedó cancelada. Llámenos o escríbanos cuando quiera para volver a reservar.",
    );
    expect(slotGoneText({ businessName: b, language: "es" })).toBe(
      "Joe's Plumbing: Lo sentimos, ese horario se acaba de ocupar. Alguien de nuestro equipo le escribirá pronto para buscar otro horario.",
    );
  });

  it("reads Spanish declines as decline, still conservatively", () => {
    for (const r of ["NO", "no gracias", "ninguno", "ninguna", "cancelar"]) {
      expect(parseRebookReply(r, 2).kind).toBe("decline");
    }
    expect(parseRebookReply("no, el viernes mejor", 2).kind).toBe("unclear");
  });

  it("review request", () => {
    expect(reviewRequestBody({ businessName: b, customerName: "María", reviewUrl: "https://g.page/r/x", language: "es" })).toBe(
      `Hola María, ¡gracias por elegir a Joe's Plumbing! Si le atendimos bien, una breve reseña nos ayuda mucho: https://g.page/r/x ${STOP_ES}`,
    );
  });

  it("waitlist offer", () => {
    const when = describeOpening(new Date("2026-11-05T21:00:00Z"), tz, "es");
    expect(when).toBe("jueves, 5 de nov, 1:00 p.m.");
    expect(
      waitlistOfferBody({ businessName: b, customerName: "María", serviceName: null, when, callbackNumber: "+14155550100", language: "es" }),
    ).toBe(
      `Hola María, le escribe Joe's Plumbing: se abrió un espacio el jueves, 5 de nov, 1:00 p.m. Es para quien responda primero. Llame o escriba al +14155550100 para reservarlo. ${STOP_ES}`,
    );
  });

  it("deposit request", () => {
    const when = describeOpening(new Date("2026-11-05T17:00:00Z"), tz, "es");
    expect(depositRequestBody({ businessName: b, customerName: null, amountCents: 2500, when, payUrl: "https://pay.example/x", language: "es" })).toBe(
      `Hola, tiene una cita con Joe's Plumbing el jueves, 5 de nov, 9:00 a.m. Un depósito de $25 asegura su lugar: https://pay.example/x ${STOP_ES}`,
    );
  });

  it("missed-call texts", () => {
    const ask = "Responda aquí con el día y la hora que le convengan y le hacemos la reserva. Si es urgente, vuelva a llamarnos y le atendemos.";
    expect(callbackText({ businessName: b, reason: "hung_up_early", language: "es" })).toBe(
      `Joe's Plumbing: ¡Disculpe que no pudimos contestar su llamada! ${ask} ${STOP_ES}`,
    );
    expect(callbackText({ businessName: b, reason: "dropped", language: "es" })).toBe(
      `Joe's Plumbing: Disculpe, parece que se cortó la llamada. ${ask} ${STOP_ES}`,
    );
    expect(callbackText({ businessName: b, reason: "abandoned_booking", language: "es" })).toBe(
      `Joe's Plumbing: Parece que no terminamos de reservar su cita. ${ask} ${STOP_ES}`,
    );
    expect(callbackText({ businessName: "", reason: "hung_up_early", language: "es" })).toMatch(/^¡Hola! /);
  });

  it("anything else stays English", () => {
    for (const language of [null, undefined, "en", "fr"]) {
      expect(cancelledText({ businessName: b, language })).toContain("No problem");
      expect(reviewRequestBody({ businessName: b, customerName: null, reviewUrl: "u", language })).toContain("Reply STOP to opt out.");
      expect(callbackText({ businessName: b, reason: "dropped", language })).toContain("Reply STOP to opt out.");
    }
    expect(describeOpening(new Date("2026-11-05T21:00:00Z"), tz)).toMatch(/^Thursday/);
  });
});
