import { AtlasEntryLayout } from "../AtlasEntryLayout";

type PrimaryStatsPageProps = {
  eyebrow?: string;
};

export function PrimaryStatsPage({
  eyebrow = "Attributes",
}: PrimaryStatsPageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="Primary Stats">
      <div className="space-y-5 text-sm tracking-[0.12em] text-white/55">

        <div className="space-y-3">
          <p>
            <span className="font-medium text-white/78">STR</span>: Strength.
            Raw force, physical power, and the ability to exert yourself
            against resistance.
          </p>

          <p>
            <span className="font-medium text-white/78">DEX</span>: Dexterity.
            Coordination, precision, fine control, and physical responsiveness.
          </p>

          <p>
            <span className="font-medium text-white/78">INT</span>:
            Intelligence. Analytical ability, abstraction, technical
            understanding, and problem-solving.
          </p>

          <p>
            <span className="font-medium text-white/78">WIS</span>: Wisdom.
            Judgment, perspective, emotional understanding, and seeing what
            actually matters.
          </p>

          <p>
            <span className="font-medium text-white/78">CHR</span>: Charisma.
            Social presence, expression, persuasion, and the ability to connect
            with others.
          </p>

          <p>
            <span className="font-medium text-white/78">MND</span>: Mind.
            Awareness, attentional stability, self-regulation, and the ability
            to direct consciousness deliberately.
          </p>
        </div>
      </div>
    </AtlasEntryLayout>
  );
}
