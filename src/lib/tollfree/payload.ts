import type { TollfreeDetails } from "./details";
import { confirmationText } from "@/lib/appointment-messages";
import { smsHelpReply, smsOptInReply } from "@/lib/sms-help";
import { toE164 } from "@/lib/sms-number-format";

/** What we send to POST /v1/Tollfree/Verifications (twilio-node param names). */
export interface TollfreeVerificationPayload {
  tollfreePhoneNumberSid: string;
  businessName: string;
  businessWebsite: string;
  notificationEmail: string;
  useCaseCategories: string[];
  useCaseSummary: string;
  productionMessageSample: string;
  optInImageUrls: string[];
  optInType: "VERBAL";
  messageVolume: string;
  businessStreetAddress: string;
  businessCity: string;
  businessStateProvinceRegion: string;
  businessPostalCode: string;
  businessCountry: "US";
  businessContactFirstName: string;
  businessContactLastName: string;
  businessContactEmail: string;
  businessContactPhone: string;
  businessType: "SOLE_PROPRIETOR" | "PRIVATE_PROFIT" | "NON_PROFIT";
  businessRegistrationNumber?: string;
  businessRegistrationAuthority?: "EIN";
  businessRegistrationCountry?: "US";
  externalReferenceId: string;
  additionalInformation: string;
  optInConfirmationMessage: string;
  helpMessageSample: string;
  privacyPolicyUrl: string;
  termsAndConditionsUrl: string;
  ageGatedContent: false;
}

export function buildVerificationPayload(opts: {
  details: TollfreeDetails;
  clientId: string;
  displayName: string;
  phoneNumberSid: string;
  appUrl: string;
  notificationEmail: string;
}): TollfreeVerificationPayload {
  const { details: d } = opts;
  const base = opts.appUrl.replace(/\/$/, "");
  const business = opts.displayName || d.legalName;
  const sample = confirmationText({
    business,
    customerName: "Jamie",
    serviceName: null,
    when: "Tue, Aug 4 at 2:30 PM.",
  });
  const ein = d.ein.replace(/\D/g, "");
  return {
    tollfreePhoneNumberSid: opts.phoneNumberSid,
    businessName: d.legalName,
    businessWebsite: d.website,
    notificationEmail: opts.notificationEmail,
    useCaseCategories: ["ACCOUNT_NOTIFICATIONS", "CUSTOMER_CARE"],
    useCaseSummary:
      `${business} uses an AI phone receptionist (FrontDesk AI). Callers who book an appointment are asked on the call ` +
      `whether they want texts; only those who say yes receive appointment confirmations, reminders, reschedule notices, ` +
      `a follow-up after a missed or dropped call, and one post-visit follow-up about that visit. No marketing or promotions.`,
    productionMessageSample: sample,
    optInImageUrls: [`${base}/sms-consent`],
    optInType: "VERBAL",
    messageVolume: d.monthlyVolume,
    businessStreetAddress: d.street,
    businessCity: d.city,
    businessStateProvinceRegion: d.state.toUpperCase(),
    businessPostalCode: d.postalCode,
    businessCountry: "US",
    businessContactFirstName: d.contactFirstName,
    businessContactLastName: d.contactLastName,
    businessContactEmail: d.contactEmail,
    businessContactPhone: toE164(d.contactPhone) ?? d.contactPhone,
    businessType: d.businessType,
    ...(ein
      ? { businessRegistrationNumber: ein, businessRegistrationAuthority: "EIN" as const, businessRegistrationCountry: "US" as const }
      : {}),
    externalReferenceId: opts.clientId,
    additionalInformation:
      `Verbal opt-in on the phone call the customer placed to the business. The AI asks: "Would you like me to text you the ` +
      `confirmation, a reminder, and a quick follow-up about this visit? Message and data rates may apply, and you can reply ` +
      `STOP at any time to opt out." Full policy and script: ${base}/sms-consent`,
    optInConfirmationMessage: smsOptInReply("en"),
    helpMessageSample: smsHelpReply(),
    privacyPolicyUrl: `${base}/privacy`,
    termsAndConditionsUrl: `${base}/terms`,
    ageGatedContent: false,
  };
}
