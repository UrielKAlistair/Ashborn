import { AtlasEntryLayout } from "../../components/atlas/AtlasEntryLayout";

type ProcrastinationPageProps = {
  eyebrow?: string;
};

export function ProcrastinationPage({
  eyebrow = "Philosophy",
}: ProcrastinationPageProps) {
  return (
    <AtlasEntryLayout eyebrow={eyebrow} title="Procrastination">
      <div className="space-y-5 text-sm tracking-[0.12em] text-white/55">
        <p>
          This page is reserved for notes on procrastination: what triggers it,
          what it is trying to protect against, and how it distorts contact
          with meaningful work.
        </p>

        <p>
          The aim here is to separate simple laziness from avoidance driven by
          friction, shame, overwhelm, or unclear goals, and to build a more
          precise model for how those states should be handled.
        </p>
      </div>
    </AtlasEntryLayout>
  );
}
