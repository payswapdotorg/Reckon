/**
 * Shared section heading — eyebrow / title / sub, per the survey's
 * "generous section rhythm" and outcome-phrased copy laws.
 */
interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  sub?: string;
  center?: boolean;
}

export function SectionHeading({ eyebrow, title, sub, center }: SectionHeadingProps) {
  return (
    <div className={center ? "rk-section-head rk-section-head-center" : "rk-section-head"}>
      {eyebrow ? <p className="rk-eyebrow">{eyebrow}</p> : null}
      <h2 className="rk-h2">{title}</h2>
      {sub ? <p className="rk-section-sub">{sub}</p> : null}
    </div>
  );
}
