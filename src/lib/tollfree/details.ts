import { z } from "zod";

/**
 * The business details Toll-Free Verification needs, as the owner enters them
 * in Settings. These must be the BUSINESS's own details, never ours: Twilio
 * rejects ISV submissions filled in with the platform's information.
 */
export const BUSINESS_TYPES = [
  { value: "SOLE_PROPRIETOR", label: "Sole proprietor (no EIN needed)" },
  { value: "PRIVATE_PROFIT", label: "LLC, corporation or partnership" },
  { value: "NON_PROFIT", label: "Nonprofit" },
] as const;

/** Twilio's accepted estimated monthly volume buckets. */
export const MONTHLY_VOLUMES = ["10", "100", "1,000", "10,000", "100,000"] as const;

const req = (label: string) => z.string().trim().min(1, `${label} is required`);

export const tollfreeDetailsSchema = z
  .object({
    legalName: req("Legal business name").max(120),
    businessType: z.enum(["SOLE_PROPRIETOR", "PRIVATE_PROFIT", "NON_PROFIT"]),
    ein: z.string().trim().default(""),
    street: req("Street address"),
    city: req("City"),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/, "Use the 2-letter state code, e.g. NY"),
    postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP"),
    website: z
      .string()
      .trim()
      .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
      .pipe(z.string().url("Enter your website, e.g. https://acmeplumbing.com")),
    contactFirstName: req("First name"),
    contactLastName: req("Last name"),
    contactEmail: z.string().trim().email("Enter a valid email"),
    contactPhone: z.string().trim().regex(/^\+?1?\D*\d{3}\D*\d{3}\D*\d{4}$/, "Enter a US phone number"),
    monthlyVolume: z.enum(MONTHLY_VOLUMES),
  })
  .superRefine((d, ctx) => {
    const digits = d.ein.replace(/\D/g, "");
    if (d.businessType !== "SOLE_PROPRIETOR" && digits.length !== 9) {
      // Required by Twilio since Feb 17, 2026 for every type except sole proprietors.
      ctx.addIssue({ code: "custom", path: ["ein"], message: "Carriers require a 9-digit EIN for this business type" });
    } else if (d.ein && digits.length !== 9) {
      ctx.addIssue({ code: "custom", path: ["ein"], message: "An EIN has 9 digits, e.g. 12-3456789" });
    }
  });

export type TollfreeDetails = z.infer<typeof tollfreeDetailsSchema>;

export const DETAIL_FIELDS = [
  "legalName", "businessType", "ein", "street", "city", "state", "postalCode", "website",
  "contactFirstName", "contactLastName", "contactEmail", "contactPhone", "monthlyVolume",
] as const;

export function detailsFromForm(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of DETAIL_FIELDS) out[k] = String(form.get(k) ?? "");
  return out;
}
