import {
  Building2,
  CalendarCheck,
  DollarSign,
  Moon,
  Percent,
  Phone,
  ShieldCheck,
  Smile,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Metric icon registry. Each metric maps to one icon and one accent so the cards
 * read as a deliberate set — money is emerald, people/ops indigo, call activity
 * sky, margin amber. Kept to four accents on purpose; more would look like noise.
 */
const REGISTRY = {
  revenue: { Icon: DollarSign, chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  mrr: { Icon: TrendingUp, chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  margin: { Icon: Percent, chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  clients: { Icon: Building2, chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  leads: { Icon: Users, chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  calls: { Icon: Phone, chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  bookings: { Icon: CalendarCheck, chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  afterHours: { Icon: Moon, chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  containment: { Icon: ShieldCheck, chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  answerRate: { Icon: Percent, chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  sentiment: { Icon: Smile, chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
} satisfies Record<string, { Icon: LucideIcon; chip: string }>;

export type MetricIcon = keyof typeof REGISTRY;

/** Small tinted square holding the metric's icon. Returns null for an unknown key. */
export function MetricIconChip({ icon }: { icon?: MetricIcon }) {
  if (!icon) return null;
  const { Icon, chip } = REGISTRY[icon];
  return (
    <span className={`flex size-8 items-center justify-center rounded-lg ${chip}`}>
      <Icon className="size-4" />
    </span>
  );
}
