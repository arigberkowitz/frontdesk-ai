"use server";

import { revalidatePath } from "next/cache";
import { requireAgencyOperator } from "@/lib/auth-guard";
import { markGradeReviewed } from "@/lib/data/grades";

/** Operator closes a QA finding after coaching / fixing the underlying issue.
 *  requireAgencyOperator matches the /review page's gate (the dashboard layout). */
export async function markGradeReviewedAction(formData: FormData): Promise<void> {
  const gradeId = String(formData.get("gradeId") ?? "");
  const user = await requireAgencyOperator();
  if (gradeId) await markGradeReviewed(user.orgId, gradeId, user.id);
  revalidatePath("/review");
}
