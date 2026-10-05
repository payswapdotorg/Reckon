/**
 * Dual CTA row — the two-track conversion architecture (survey §2.6):
 * self-serve "Start now" + enterprise "Contact sales". Rendered on the
 * hero, every section tail, and the final band.
 */
import { ArrowRight } from "@/components/marketing/icons";
import { primaryCta, secondaryCta } from "@/lib/marketing-content";

interface CtaRowProps {
  compact?: boolean;
}

export function CtaRow({ compact }: CtaRowProps) {
  return (
    <div className={compact ? "rk-cta-row rk-cta-row-compact" : "rk-cta-row"}>
      <a className="rk-btn rk-btn-primary" href={primaryCta.href}>
        {primaryCta.label}
        <ArrowRight size={18} />
      </a>
      <a className="rk-btn rk-btn-secondary" href={secondaryCta.href}>
        {secondaryCta.label}
        <ArrowRight size={18} />
      </a>
    </div>
  );
}
