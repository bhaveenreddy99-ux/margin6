-- Drop all potentially conflicting 
-- policies before workflow migration 
-- recreates them.
-- All statements safe with IF EXISTS.

DROP POLICY IF EXISTS "Members can update delivery issues"
  ON public.delivery_issues;

DROP POLICY IF EXISTS "Members can delete delivery issues"
  ON public.delivery_issues;

DROP POLICY IF EXISTS "Members can insert delivery issues"
  ON public.delivery_issues;

DROP POLICY IF EXISTS "Members can manage delivery issues"
  ON public.delivery_issues;

DROP POLICY IF EXISTS "Users can manage delivery_issues for their restaurant"
  ON public.delivery_issues;

DROP POLICY IF EXISTS "Users can manage invoice_line_comparisons for their restaurant"
  ON public.invoice_line_comparisons;

DROP POLICY IF EXISTS "Members can view invoice_line_comparisons"
  ON public.invoice_line_comparisons;

DROP POLICY IF EXISTS "Members can insert invoice_line_comparisons"
  ON public.invoice_line_comparisons;

DROP POLICY IF EXISTS "Members can update invoice_line_comparisons"
  ON public.invoice_line_comparisons;

DROP POLICY IF EXISTS "Members can delete invoice_line_comparisons"
  ON public.invoice_line_comparisons;

DROP POLICY IF EXISTS "Members can select delivery issues"
  ON public.delivery_issues;

DROP POLICY IF EXISTS "Members can view delivery issues"
  ON public.delivery_issues;
